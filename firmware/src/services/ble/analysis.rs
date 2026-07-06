use crate::services::measure::Measurement;

use super::model::PROTOCOL_VERSION;
use super::{Alcohol, DeviceEvent, MeasurementResult, PhoneContext, Pulse, Risk};

const LEGAL_LIMIT_MILLI_PERCENT: u16 = 30;
const CAUTION_MILLI_PERCENT: u16 = 15;
const DEFAULT_BAC_ELIMINATION_MILLI_PERCENT_PER_HOUR: u16 = 15;
const DEFAULT_BRAC_NOISE_MG_L_X1000: u16 = 10;
const MIN_CONTEXT_ELIMINATION_MG_L_PER_HOUR_X1000: u16 = 20;
const MAX_CONTEXT_ELIMINATION_MG_L_PER_HOUR_X1000: u16 = 120;
const MAX_SOBER_BASELINE_MG_L_X1000: u16 = 50;
const MAX_SOBER_BASELINE_MAD_MG_L_X1000: u16 = 50;

pub fn measurement_result(
    session_id: String,
    measurement: Measurement,
    context: Option<&PhoneContext>,
) -> DeviceEvent {
    let alcohol_mg_l_x1000 = measurement.alcohol_mg_l_x1000();
    let pulse_bpm = measurement.pulse_bpm();
    let corrected_alcohol = corrected_alcohol_mg_l_x1000(alcohol_mg_l_x1000, context);
    let upper_alcohol = upper_alcohol_mg_l_x1000(alcohol_mg_l_x1000, context);
    let raw_bac_milli_percent = brac_to_bac_milli_percent(alcohol_mg_l_x1000);
    let bac_milli_percent = brac_to_bac_milli_percent(corrected_alcohol);
    let bac_upper_milli_percent =
        brac_to_bac_milli_percent(upper_alcohol).max(raw_bac_milli_percent);
    let risk = risk_from_upper_bac(bac_upper_milli_percent);
    let confidence_percent = confidence_percent(context, pulse_bpm);

    DeviceEvent::MeasurementResult(MeasurementResult {
        v: PROTOCOL_VERSION,
        session_id,
        measured_at_unix_ms: context.and_then(|context| context.phone_time_unix_ms),
        alcohol: Alcohol {
            mg_l_x1000: alcohol_mg_l_x1000,
        },
        pulse: Some(Pulse {
            bpm: pulse_bpm as f32,
            stable: true,
            confidence_percent: pulse_confidence_percent(context, pulse_bpm),
        }),
        bac_milli_percent: Some(bac_milli_percent),
        bac_upper_milli_percent: Some(bac_upper_milli_percent),
        sober_time_minutes: estimate_sober_time_minutes(
            upper_alcohol,
            bac_upper_milli_percent,
            context,
        ),
        risk,
        confidence_percent,
    })
}

fn corrected_alcohol_mg_l_x1000(alcohol_mg_l_x1000: u16, context: Option<&PhoneContext>) -> u16 {
    let baseline = context.and_then(sober_baseline_mg_l_x1000).unwrap_or(0);

    alcohol_mg_l_x1000.saturating_sub(baseline)
}

fn upper_alcohol_mg_l_x1000(alcohol_mg_l_x1000: u16, context: Option<&PhoneContext>) -> u16 {
    let Some(context) = context else {
        return alcohol_mg_l_x1000.saturating_add(DEFAULT_BRAC_NOISE_MG_L_X1000);
    };

    let baseline = sober_baseline_mg_l_x1000(context).unwrap_or(0);
    let baseline_noise = sober_baseline_mad_mg_l_x1000(context)
        .map(|mad| mad.saturating_mul(3))
        .unwrap_or(DEFAULT_BRAC_NOISE_MG_L_X1000)
        .max(DEFAULT_BRAC_NOISE_MG_L_X1000);

    alcohol_mg_l_x1000.saturating_sub(baseline.saturating_sub(baseline_noise))
}

fn sober_baseline_mg_l_x1000(context: &PhoneContext) -> Option<u16> {
    context
        .sober_alcohol_mg_l_x1000
        .filter(|baseline| *baseline <= MAX_SOBER_BASELINE_MG_L_X1000)
}

fn sober_baseline_mad_mg_l_x1000(context: &PhoneContext) -> Option<u16> {
    context
        .sober_alcohol_mad_mg_l_x1000
        .map(|mad| mad.min(MAX_SOBER_BASELINE_MAD_MG_L_X1000))
}

fn brac_to_bac_milli_percent(alcohol_mg_l_x1000: u16) -> u16 {
    ((u32::from(alcohol_mg_l_x1000) * 21 + 50) / 100).min(u32::from(u16::MAX)) as u16
}

fn estimate_sober_time_minutes(
    upper_alcohol_mg_l_x1000: u16,
    bac_upper_milli_percent: u16,
    context: Option<&PhoneContext>,
) -> Option<u16> {
    if upper_alcohol_mg_l_x1000 == 0 || bac_upper_milli_percent < CAUTION_MILLI_PERCENT {
        return Some(0);
    }

    if let Some(rate) = context.and_then(|context| context.elimination_mg_l_per_hour_x1000) {
        if (MIN_CONTEXT_ELIMINATION_MG_L_PER_HOUR_X1000
            ..=MAX_CONTEXT_ELIMINATION_MG_L_PER_HOUR_X1000)
            .contains(&rate)
        {
            return Some(minutes_for_rate(upper_alcohol_mg_l_x1000, rate));
        }
    }

    Some(minutes_for_rate(
        bac_upper_milli_percent,
        DEFAULT_BAC_ELIMINATION_MILLI_PERCENT_PER_HOUR,
    ))
}

fn minutes_for_rate(amount: u16, rate_per_hour: u16) -> u16 {
    if rate_per_hour == 0 {
        return u16::MAX;
    }

    ((u32::from(amount) * 60 + u32::from(rate_per_hour) - 1) / u32::from(rate_per_hour))
        .min(u32::from(u16::MAX)) as u16
}

fn risk_from_upper_bac(bac_upper_milli_percent: u16) -> Risk {
    if bac_upper_milli_percent >= LEGAL_LIMIT_MILLI_PERCENT {
        Risk::Danger
    } else if bac_upper_milli_percent >= CAUTION_MILLI_PERCENT {
        Risk::Caution
    } else {
        Risk::Safe
    }
}

fn confidence_percent(context: Option<&PhoneContext>, pulse_bpm: u16) -> u8 {
    let mut confidence = 55_u8;

    if let Some(context) = context {
        if sober_baseline_mg_l_x1000(context).is_some() {
            confidence = confidence.saturating_add(10);
        }

        if sober_baseline_mad_mg_l_x1000(context).is_some() {
            confidence = confidence.saturating_add(5);
        }

        if context.elimination_mg_l_per_hour_x1000.is_some() {
            confidence = confidence.saturating_add(10);
        }

        if !context.recent.is_empty() {
            confidence = confidence.saturating_add(5);
        }

        if let Some(resting_bpm) = context.resting_bpm {
            let delta = pulse_bpm.abs_diff(resting_bpm);

            if delta <= 20 {
                confidence = confidence.saturating_add(5);
            } else {
                confidence = confidence.saturating_sub(10);
            }
        }
    }

    confidence.min(90)
}

fn pulse_confidence_percent(context: Option<&PhoneContext>, pulse_bpm: u16) -> u8 {
    let Some(resting_bpm) = context.and_then(|context| context.resting_bpm) else {
        return 65;
    };

    let delta = pulse_bpm.abs_diff(resting_bpm);

    if delta <= 15 {
        85
    } else if delta <= 30 {
        70
    } else {
        45
    }
}
