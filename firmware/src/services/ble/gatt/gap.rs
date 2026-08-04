use super::status;
use crate::services::ble::transport::{DEVICE_NAME, SERVICE_UUID};
use esp_idf_svc::bt::ble::gap::{AdvConfiguration, BleGapEvent, EspBleGap};
use esp_idf_svc::bt::{Ble, BtDriver, BtUuid};
use esp_idf_svc::sys::EspError;
use std::sync::Arc;

pub struct Gap {
    driver: Arc<EspBleGap<'static, Ble, Arc<BtDriver<'static, Ble>>>>,
}

impl Gap {
    pub fn new(driver: Arc<BtDriver<'static, Ble>>) -> Result<Self, EspError> {
        Ok(Self {
            driver: Arc::new(EspBleGap::new(driver)?),
        })
    }

    pub fn subscribe(
        &self,
        callback: impl FnMut(BleGapEvent) + Send + 'static,
    ) -> Result<(), EspError> {
        self.driver.subscribe(callback)
    }

    pub fn prepare(&self) -> Result<(), EspError> {
        self.driver.set_device_name(DEVICE_NAME)?;
        self.configure()
    }

    pub fn configure(&self) -> Result<(), EspError> {
        self.driver.set_adv_conf(&AdvConfiguration {
            include_name: true,
            include_txpower: true,
            flag: 2,
            service_uuid: Some(BtUuid::uuid128(SERVICE_UUID)),
            ..Default::default()
        })
    }

    pub fn handle(&self, event: BleGapEvent) -> Result<(), EspError> {
        log::debug!("BLE GAP event: {event:?}");

        if let BleGapEvent::AdvertisingConfigured(result) = event {
            status::bt(result)?;
            self.driver.start_advertising()?;
            log::info!("BLE advertising started");
        }

        Ok(())
    }
}
