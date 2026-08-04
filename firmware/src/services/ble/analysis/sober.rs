use crate::services::ble::model::PhoneContext;

use super::risk;

const DEFAULT_BAC_RATE: u16 = 15;
const MIN_RATE: u16 = 20;
const MAX_RATE: u16 = 120;

pub fn time(alcohol: u16, bac: u16, context: Option<&PhoneContext>) -> Option<u16> {
    if alcohol == 0 || bac < risk::CAUTION {
        return Some(0);
    }

    if let Some(rate) = context.and_then(rate) {
        return Some(minutes(alcohol, rate));
    }

    Some(minutes(bac, DEFAULT_BAC_RATE))
}

pub fn rate(context: &PhoneContext) -> Option<u16> {
    context
        .elimination_mg_l_per_hour_x1000
        .filter(|rate| (MIN_RATE..=MAX_RATE).contains(rate))
}

fn minutes(amount: u16, rate: u16) -> u16 {
    if rate == 0 {
        return u16::MAX;
    }

    (u32::from(amount) * 60)
        .div_ceil(u32::from(rate))
        .min(u32::from(u16::MAX)) as u16
}
