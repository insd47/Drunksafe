use crate::services::ble::model::PhoneContext;

const DEFAULT_NOISE: u16 = 10;
const MAX_BASELINE: u16 = 50;
const MAX_MAD: u16 = 50;

pub fn corrected(raw: u16, context: Option<&PhoneContext>) -> u16 {
    raw.saturating_sub(context.and_then(baseline).unwrap_or(0))
}

pub fn upper(raw: u16, context: Option<&PhoneContext>) -> u16 {
    let Some(context) = context else {
        return raw.saturating_add(DEFAULT_NOISE);
    };

    let baseline = baseline(context).unwrap_or(0);
    let noise = mad(context)
        .map(|value| value.saturating_mul(3))
        .unwrap_or(DEFAULT_NOISE)
        .max(DEFAULT_NOISE);

    raw.saturating_sub(baseline.saturating_sub(noise))
}

pub fn bac(alcohol: u16) -> u16 {
    ((u32::from(alcohol) * 21 + 50) / 100).min(u32::from(u16::MAX)) as u16
}

pub fn baseline(context: &PhoneContext) -> Option<u16> {
    context
        .sober_alcohol_mg_l_x1000
        .filter(|value| *value <= MAX_BASELINE)
}

pub fn mad(context: &PhoneContext) -> Option<u16> {
    context
        .sober_alcohol_mad_mg_l_x1000
        .map(|value| value.min(MAX_MAD))
}
