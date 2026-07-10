use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

use esp_idf_svc::bt::ble::gap::BleGapEvent;
use esp_idf_svc::bt::ble::gatt::server::{ConnectionId, GattsEvent};
use esp_idf_svc::bt::ble::gatt::{GattInterface, Handle};
use esp_idf_svc::bt::{BdAddr, Ble, BtDriver};
use esp_idf_svc::sys::{EspError, ESP_FAIL};

use super::attributes::Attributes;
use super::connections::Connections;
use super::gap::Gap;
use super::status;
use crate::services::ble::event;
use crate::services::ble::model::{DeviceEvent, PhoneCommand, StatusKind};
use crate::services::ble::transport::{DeviceEventTransport, PhoneCommandTransport};

const APP_ID: u16 = 0;
const NOTIFY_ENABLED: u16 = 0x0001;
const INDICATE_ENABLED: u16 = 0x0002;

pub struct Server {
    gap: Gap,
    attributes: Attributes,
    connections: Connections,
    commands: Sender<PhoneCommand>,
    phone: Mutex<PhoneCommandTransport>,
    events: Mutex<DeviceEventTransport>,
    status: Mutex<Option<DeviceEvent>>,
}

impl Server {
    pub fn new(
        driver: Arc<BtDriver<'static, Ble>>,
        commands: Sender<PhoneCommand>,
    ) -> Result<Self, EspError> {
        Ok(Self {
            gap: Gap::new(driver.clone())?,
            attributes: Attributes::new(driver)?,
            connections: Connections::new(),
            commands,
            phone: Mutex::new(PhoneCommandTransport::new()),
            events: Mutex::new(DeviceEventTransport::new()),
            status: Mutex::new(None),
        })
    }

    pub fn start(self: &Arc<Self>) -> Result<(), EspError> {
        let server = Arc::clone(self);
        self.gap.subscribe(move |event| {
            status::log(server.gap(event));
        })?;

        let server = Arc::clone(self);
        self.attributes.subscribe(move |(interface, event)| {
            status::log(server.gatt(interface, event));
        })?;

        self.attributes.register(APP_ID)?;
        log::info!("BLE GATT server registered");
        Ok(())
    }

    pub fn send(&self, event: &DeviceEvent) -> Result<(), EspError> {
        if let DeviceEvent::Status(_) = event {
            *self.status.lock().unwrap() = Some(event.clone());
        }

        let Some(interface) = self.attributes.interface() else {
            return Ok(());
        };
        let Some(handle) = self.attributes.event() else {
            return Ok(());
        };

        for (connection, payload) in self.connections.targets() {
            let frames = self
                .events
                .lock()
                .unwrap()
                .frames(event, payload)
                .map_err(|error| {
                    log::warn!("failed to serialize BLE event: {error}");
                    EspError::from_infallible::<ESP_FAIL>()
                })?;

            for frame in frames {
                self.attributes
                    .notify(interface, connection, handle, frame.as_bytes())?;
            }
        }

        Ok(())
    }

    fn gap(&self, event: BleGapEvent) -> Result<(), EspError> {
        self.gap.handle(event)
    }

    fn gatt(&self, interface: GattInterface, event: GattsEvent<'_>) -> Result<(), EspError> {
        log::debug!("BLE GATTS event: {event:?}");

        match &event {
            GattsEvent::ServiceRegistered {
                status: result,
                app_id,
            } => {
                status::gatt(*result)?;
                if *app_id == APP_ID {
                    self.gap.prepare()?;
                    self.attributes.create(interface)?;
                }
            }
            GattsEvent::ServiceCreated {
                status: result,
                service_handle,
                ..
            } => {
                status::gatt(*result)?;
                self.attributes.start(*service_handle)?;
            }
            GattsEvent::CharacteristicAdded {
                status: result,
                attr_handle,
                service_handle,
                char_uuid,
            } => {
                status::gatt(*result)?;
                self.attributes
                    .characteristic(*service_handle, *attr_handle, char_uuid.clone())?;
            }
            GattsEvent::DescriptorAdded {
                status: result,
                attr_handle,
                service_handle,
                descr_uuid,
            } => {
                status::gatt(*result)?;
                self.attributes
                    .descriptor(*service_handle, *attr_handle, descr_uuid.clone());
            }
            GattsEvent::Mtu { conn_id, mtu } => self.connections.mtu(*conn_id, *mtu),
            GattsEvent::PeerConnected { conn_id, addr, .. } => {
                self.connect(*conn_id, *addr)?;
            }
            GattsEvent::PeerDisconnected { addr, .. } => self.disconnect(*addr)?,
            GattsEvent::Write { .. } => self.write(interface, &event)?,
            _ => {}
        }

        Ok(())
    }

    fn connect(&self, id: ConnectionId, peer: BdAddr) -> Result<(), EspError> {
        if self.connections.add(id, peer) {
            self.phone.lock().unwrap().reset();
        }

        self.gap.configure()
    }

    fn disconnect(&self, peer: BdAddr) -> Result<(), EspError> {
        if self.connections.remove(peer) {
            self.phone.lock().unwrap().reset();
        }

        self.gap.configure()
    }

    fn write(&self, interface: GattInterface, event: &GattsEvent<'_>) -> Result<(), EspError> {
        let GattsEvent::Write {
            conn_id,
            handle,
            offset,
            value,
            ..
        } = event
        else {
            return Ok(());
        };

        let (handled, replay) = self.accept(*conn_id, *handle, *offset, value);

        if handled {
            self.attributes.respond(interface, event)?;
        }

        if let Some(event) = replay {
            self.send(&event)?;
        }

        Ok(())
    }

    fn accept(
        &self,
        connection: ConnectionId,
        handle: Handle,
        offset: u16,
        value: &[u8],
    ) -> (bool, Option<DeviceEvent>) {
        if self.attributes.configuration() == Some(handle) {
            return (true, self.subscribe(connection, offset, value));
        }

        if self.attributes.command() != Some(handle) {
            return (false, None);
        }

        match self.phone.lock().unwrap().accept(value) {
            Ok(Some(command)) => {
                if self.commands.send(command).is_err() {
                    log::warn!("dropping BLE command because main loop receiver is gone");
                }
            }
            Ok(None) => {}
            Err(error) => log::warn!("invalid BLE command payload: {error}"),
        }

        (true, None)
    }

    fn subscribe(
        &self,
        connection: ConnectionId,
        offset: u16,
        value: &[u8],
    ) -> Option<DeviceEvent> {
        if offset != 0 || value.len() != 2 {
            return None;
        }

        let value = u16::from_le_bytes([value[0], value[1]]);
        let enabled = value == NOTIFY_ENABLED || value == INDICATE_ENABLED;

        if !self.connections.subscribe(connection, enabled) || !enabled {
            return None;
        }

        Some(
            self.status
                .lock()
                .unwrap()
                .clone()
                .unwrap_or_else(|| event::status(StatusKind::Connected, None)),
        )
    }
}
