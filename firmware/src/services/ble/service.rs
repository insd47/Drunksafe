use super::gatt::GattServer;
use super::{DeviceEvent, PhoneCommand};
use esp_idf_svc::bt::ble::gatt::set_local_mtu;
use esp_idf_svc::bt::{Ble, BtDriver};
use esp_idf_svc::hal::modem::Modem;
use esp_idf_svc::nvs::EspDefaultNvsPartition;
use esp_idf_svc::sys::EspError;
use std::sync::mpsc::{self, Receiver};
use std::sync::Arc;

const LOCAL_MTU: u16 = 185;

type Driver = BtDriver<'static, Ble>;

pub struct BleService {
    _driver: Arc<Driver>,
    server: GattServer,
    commands: Receiver<PhoneCommand>,
}

impl BleService {
    pub fn new(modem: Modem<'static>) -> Result<Self, EspError> {
        let nvs = EspDefaultNvsPartition::take()?;
        let driver = Arc::new(BtDriver::new(modem, Some(nvs))?);
        set_local_mtu(LOCAL_MTU)?;
        log::info!("BLE local MTU set to {LOCAL_MTU}");
        let (commands_tx, commands) = mpsc::channel();
        let server = GattServer::new(driver.clone(), commands_tx)?;
        server.start()?;

        Ok(Self {
            _driver: driver,
            server,
            commands,
        })
    }

    pub fn try_recv_command(&self) -> Option<PhoneCommand> {
        self.commands.try_recv().ok()
    }

    pub fn notify(&self, event: &DeviceEvent) -> Result<(), EspError> {
        self.server.notify(event)
    }
}
