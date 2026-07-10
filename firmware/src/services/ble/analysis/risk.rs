use crate::services::ble::model::Risk;

pub const CAUTION: u16 = 15;
const DANGER: u16 = 30;

pub fn from(bac: u16) -> Risk {
    if bac >= DANGER {
        Risk::Danger
    } else if bac >= CAUTION {
        Risk::Caution
    } else {
        Risk::Safe
    }
}
