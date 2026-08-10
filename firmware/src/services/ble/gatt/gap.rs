use esp_idf_svc::bt::ble::gap::{AdvConfiguration, BleGapEvent};
use esp_idf_svc::bt::BtStatus;

pub const ADVERTISING_MAX_ATTEMPTS: u8 = 3;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AdvertisingAction {
    None,
    Configure,
    Start,
    Started,
}

#[derive(Default)]
pub struct Advertising {
    attempts: u8,
}

impl Advertising {
    pub fn begin(&mut self) -> AdvertisingAction {
        self.attempts = 0;
        AdvertisingAction::Configure
    }

    pub fn next_attempt(&mut self) -> Option<u8> {
        if self.attempts >= ADVERTISING_MAX_ATTEMPTS {
            return None;
        }

        self.attempts += 1;
        Some(self.attempts)
    }

    pub fn event(&mut self, event: &BleGapEvent) -> AdvertisingAction {
        match event {
            BleGapEvent::AdvertisingConfigured(BtStatus::Success) => AdvertisingAction::Start,
            BleGapEvent::AdvertisingConfigured(_) => AdvertisingAction::Configure,
            BleGapEvent::AdvertisingStarted(BtStatus::Success) => {
                self.attempts = 0;
                AdvertisingAction::Started
            }
            BleGapEvent::AdvertisingStarted(_) => AdvertisingAction::Configure,
            _ => AdvertisingAction::None,
        }
    }
}

pub fn configuration() -> AdvConfiguration<'static> {
    AdvConfiguration {
        include_name: true,
        include_txpower: true,
        flag: 2,
        service_uuid: None,
        ..Default::default()
    }
}
