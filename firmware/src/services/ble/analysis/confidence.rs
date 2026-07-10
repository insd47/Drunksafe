use crate::services::ble::model::PhoneContext;

use super::{alcohol, sober};

pub fn overall(context: Option<&PhoneContext>, pulse: Option<u16>) -> u8 {
    let mut confidence = 55_u8;

    if let Some(context) = context {
        if alcohol::baseline(context).is_some() {
            confidence = confidence.saturating_add(10);
        }

        if alcohol::mad(context).is_some() {
            confidence = confidence.saturating_add(5);
        }

        if sober::rate(context).is_some() {
            confidence = confidence.saturating_add(10);
        }

        if !context.recent.is_empty() {
            confidence = confidence.saturating_add(5);
        }

        if let (Some(resting), Some(pulse)) = (context.resting_bpm, pulse) {
            if pulse.abs_diff(resting) <= 20 {
                confidence = confidence.saturating_add(5);
            } else {
                confidence = confidence.saturating_sub(10);
            }
        } else if context.resting_bpm.is_some() {
            confidence = confidence.saturating_sub(5);
        }
    }

    confidence.min(90)
}

pub fn pulse(context: Option<&PhoneContext>, pulse: u16) -> u8 {
    let Some(resting) = context.and_then(|value| value.resting_bpm) else {
        return 65;
    };

    match pulse.abs_diff(resting) {
        0..=15 => 85,
        16..=30 => 70,
        _ => 45,
    }
}
