use std::sync::mpsc::{self, Receiver};
use std::sync::Arc;

use esp_idf_svc::bt::{Ble, BtDriver};
use esp_idf_svc::hal::modem::Modem;
use esp_idf_svc::nvs::EspDefaultNvsPartition;
use esp_idf_svc::sys::EspError;

use super::gatt::Server;
use super::model::{DeviceEvent, PhoneCommand};

pub struct BleService {
    _driver: Arc<BtDriver<'static, Ble>>,
    server: Arc<Server>,
    commands: Receiver<PhoneCommand>,
}

impl BleService {
    pub fn new(modem: Modem<'static>) -> Result<Self, EspError> {
        let nvs = EspDefaultNvsPartition::take()?;
        let driver = Arc::new(BtDriver::new(modem, Some(nvs))?);
        let (commands, receiver) = mpsc::channel();
        let server = Arc::new(Server::new(driver.clone(), commands)?);
        server.start()?;

        Ok(Self {
            _driver: driver,
            server,
            commands: receiver,
        })
    }

    pub fn receive(&self) -> Option<PhoneCommand> {
        self.commands.try_recv().ok()
    }

    pub fn send(&self, event: DeviceEvent) {
        if let Err(error) = self.server.send(&event) {
            log::warn!("BLE notify failed: {error}");
        }
    }
}
