use std::sync::{Arc, Mutex};

use enumset::enum_set;
use esp_idf_svc::bt::ble::gatt::server::{ConnectionId, EspGatts, GattsEvent};
use esp_idf_svc::bt::ble::gatt::{
    AutoResponse, GattCharacteristic, GattDescriptor, GattId, GattInterface, GattResponse,
    GattServiceId, GattStatus, Handle, Permission, Property,
};
use esp_idf_svc::bt::{Ble, BtDriver, BtUuid};
use esp_idf_svc::sys::{EspError, ESP_FAIL};

use crate::services::ble::transport::{
    DEVICE_EVENT_CHARACTERISTIC_UUID, PHONE_COMMAND_CHARACTERISTIC_UUID, SERVICE_UUID,
};

const MAX_VALUE_LEN: usize = 200;
const CLIENT_CONFIGURATION_UUID: u16 = 0x2902;

pub struct Attributes {
    driver: Arc<EspGatts<'static, Ble, Arc<BtDriver<'static, Ble>>>>,
    interface: Mutex<Option<GattInterface>>,
    service: Mutex<Option<Handle>>,
    event: Mutex<Option<Handle>>,
    command: Mutex<Option<Handle>>,
    configuration: Mutex<Option<Handle>>,
    response: Mutex<GattResponse>,
}

impl Attributes {
    pub fn new(driver: Arc<BtDriver<'static, Ble>>) -> Result<Self, EspError> {
        Ok(Self {
            driver: Arc::new(EspGatts::new(driver)?),
            interface: Mutex::new(None),
            service: Mutex::new(None),
            event: Mutex::new(None),
            command: Mutex::new(None),
            configuration: Mutex::new(None),
            response: Mutex::new(GattResponse::default()),
        })
    }

    pub fn subscribe(
        &self,
        callback: impl FnMut((GattInterface, GattsEvent)) + Send + 'static,
    ) -> Result<(), EspError> {
        self.driver.subscribe(callback)
    }

    pub fn register(&self, app_id: u16) -> Result<(), EspError> {
        self.driver.register_app(app_id)
    }

    pub fn create(&self, interface: GattInterface) -> Result<(), EspError> {
        *self.interface.lock().unwrap() = Some(interface);
        self.driver.create_service(
            interface,
            &GattServiceId {
                id: GattId {
                    uuid: BtUuid::uuid128(SERVICE_UUID),
                    inst_id: 0,
                },
                is_primary: true,
            },
            8,
        )
    }

    pub fn start(&self, handle: Handle) -> Result<(), EspError> {
        *self.service.lock().unwrap() = Some(handle);
        self.driver.start_service(handle)?;

        self.driver.add_characteristic(
            handle,
            &GattCharacteristic {
                uuid: BtUuid::uuid128(DEVICE_EVENT_CHARACTERISTIC_UUID),
                permissions: enum_set!(Permission::Read),
                properties: enum_set!(Property::Notify | Property::Read),
                max_len: MAX_VALUE_LEN,
                auto_rsp: AutoResponse::ByGatt,
            },
            &[],
        )?;

        self.driver.add_characteristic(
            handle,
            &GattCharacteristic {
                uuid: BtUuid::uuid128(PHONE_COMMAND_CHARACTERISTIC_UUID),
                permissions: enum_set!(Permission::Write),
                properties: enum_set!(Property::Write),
                max_len: MAX_VALUE_LEN,
                auto_rsp: AutoResponse::ByApp,
            },
            &[],
        )
    }

    pub fn characteristic(
        &self,
        service: Handle,
        attribute: Handle,
        uuid: BtUuid,
    ) -> Result<(), EspError> {
        if *self.service.lock().unwrap() != Some(service) {
            return Ok(());
        }

        if uuid == BtUuid::uuid128(DEVICE_EVENT_CHARACTERISTIC_UUID) {
            *self.event.lock().unwrap() = Some(attribute);
            self.driver.add_descriptor(
                service,
                &GattDescriptor {
                    uuid: BtUuid::uuid16(CLIENT_CONFIGURATION_UUID),
                    permissions: enum_set!(Permission::Read | Permission::Write),
                },
            )?;
        } else if uuid == BtUuid::uuid128(PHONE_COMMAND_CHARACTERISTIC_UUID) {
            *self.command.lock().unwrap() = Some(attribute);
        }

        Ok(())
    }

    pub fn descriptor(&self, service: Handle, attribute: Handle, uuid: BtUuid) {
        if *self.service.lock().unwrap() == Some(service)
            && uuid == BtUuid::uuid16(CLIENT_CONFIGURATION_UUID)
        {
            *self.configuration.lock().unwrap() = Some(attribute);
        }
    }

    pub fn interface(&self) -> Option<GattInterface> {
        *self.interface.lock().unwrap()
    }

    pub fn event(&self) -> Option<Handle> {
        *self.event.lock().unwrap()
    }

    pub fn command(&self) -> Option<Handle> {
        *self.command.lock().unwrap()
    }

    pub fn configuration(&self) -> Option<Handle> {
        *self.configuration.lock().unwrap()
    }

    pub fn notify(
        &self,
        interface: GattInterface,
        connection: ConnectionId,
        handle: Handle,
        value: &[u8],
    ) -> Result<(), EspError> {
        self.driver.notify(interface, connection, handle, value)
    }

    pub fn respond(
        &self,
        interface: GattInterface,
        event: &GattsEvent<'_>,
    ) -> Result<(), EspError> {
        let GattsEvent::Write {
            conn_id,
            trans_id,
            handle,
            offset,
            need_rsp,
            is_prep,
            value,
            ..
        } = event
        else {
            return Ok(());
        };

        if !need_rsp {
            return Ok(());
        }

        if *is_prep {
            let mut response = self.response.lock().unwrap();
            response
                .attr_handle(*handle)
                .auth_req(0)
                .offset(*offset)
                .value(value)
                .map_err(|_| EspError::from_infallible::<ESP_FAIL>())?;

            self.driver.send_response(
                interface,
                *conn_id,
                *trans_id,
                GattStatus::Ok,
                Some(&response),
            )
        } else {
            self.driver
                .send_response(interface, *conn_id, *trans_id, GattStatus::Ok, None)
        }
    }
}
