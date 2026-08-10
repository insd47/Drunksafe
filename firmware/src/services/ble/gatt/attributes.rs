use crate::services::ble::{
    DEVICE_EVENT_CHARACTERISTIC_UUID, PHONE_COMMAND_CHARACTERISTIC_UUID, SERVICE_UUID,
};
use enumset::enum_set;
use esp_idf_svc::bt::ble::gatt::{
    AutoResponse, GattCharacteristic, GattDescriptor, GattId, GattInterface, GattServiceId,
    GattStatus, Handle, Permission, Property,
};
use esp_idf_svc::bt::BtUuid;

const CLIENT_CHARACTERISTIC_CONFIGURATION_UUID: u16 = 0x2902;
const MAX_CHARACTERISTIC_VALUE_LEN: usize = 200;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RegistrationAction {
    None,
    CreateService { gatt_if: GattInterface },
    AddEventCharacteristic { service_handle: Handle },
    AddEventConfiguration { service_handle: Handle },
    AddCommandCharacteristic { service_handle: Handle },
    StartService { service_handle: Handle },
    BeginAdvertising,
}

#[derive(Default)]
pub struct Attributes {
    gatt_if: Option<GattInterface>,
    service_handle: Option<Handle>,
    event_handle: Option<Handle>,
    command_handle: Option<Handle>,
    event_cccd_handle: Option<Handle>,
}

impl Attributes {
    pub fn registered(&mut self, gatt_if: GattInterface) -> RegistrationAction {
        self.gatt_if = Some(gatt_if);
        RegistrationAction::CreateService { gatt_if }
    }

    pub fn service_created(&mut self, service_handle: Handle) -> RegistrationAction {
        self.service_handle = Some(service_handle);
        RegistrationAction::AddEventCharacteristic { service_handle }
    }

    pub fn characteristic_added(
        &mut self,
        service_handle: Handle,
        attr_handle: Handle,
        char_uuid: BtUuid,
    ) -> RegistrationAction {
        if self.service_handle != Some(service_handle) {
            return RegistrationAction::None;
        }

        if char_uuid == BtUuid::uuid128(DEVICE_EVENT_CHARACTERISTIC_UUID) {
            self.event_handle = Some(attr_handle);
            RegistrationAction::AddEventConfiguration { service_handle }
        } else if char_uuid == BtUuid::uuid128(PHONE_COMMAND_CHARACTERISTIC_UUID) {
            self.command_handle = Some(attr_handle);
            RegistrationAction::StartService { service_handle }
        } else {
            RegistrationAction::None
        }
    }

    pub fn descriptor_added(
        &mut self,
        service_handle: Handle,
        attr_handle: Handle,
        descr_uuid: BtUuid,
    ) -> RegistrationAction {
        if self.service_handle != Some(service_handle)
            || descr_uuid != BtUuid::uuid16(CLIENT_CHARACTERISTIC_CONFIGURATION_UUID)
        {
            return RegistrationAction::None;
        }

        self.event_cccd_handle = Some(attr_handle);
        RegistrationAction::AddCommandCharacteristic { service_handle }
    }

    pub fn service_started(&self, service_handle: Handle) -> RegistrationAction {
        if self.service_handle == Some(service_handle) {
            RegistrationAction::BeginAdvertising
        } else {
            RegistrationAction::None
        }
    }

    pub const fn gatt_if(&self) -> Option<GattInterface> {
        self.gatt_if
    }

    pub const fn event_handle(&self) -> Option<Handle> {
        self.event_handle
    }

    pub const fn command_handle(&self) -> Option<Handle> {
        self.command_handle
    }

    pub const fn event_cccd_handle(&self) -> Option<Handle> {
        self.event_cccd_handle
    }
}

pub fn service_id() -> GattServiceId {
    GattServiceId {
        id: GattId {
            uuid: BtUuid::uuid128(SERVICE_UUID),
            inst_id: 0,
        },
        is_primary: true,
    }
}

pub fn event_characteristic() -> GattCharacteristic {
    GattCharacteristic {
        uuid: BtUuid::uuid128(DEVICE_EVENT_CHARACTERISTIC_UUID),
        permissions: enum_set!(Permission::Read),
        properties: enum_set!(Property::Notify | Property::Read),
        max_len: MAX_CHARACTERISTIC_VALUE_LEN,
        auto_rsp: AutoResponse::ByGatt,
    }
}

pub fn event_configuration() -> GattDescriptor {
    GattDescriptor {
        uuid: BtUuid::uuid16(CLIENT_CHARACTERISTIC_CONFIGURATION_UUID),
        permissions: enum_set!(Permission::Read | Permission::Write),
    }
}

pub fn command_characteristic() -> GattCharacteristic {
    GattCharacteristic {
        uuid: BtUuid::uuid128(PHONE_COMMAND_CHARACTERISTIC_UUID),
        permissions: enum_set!(Permission::Write),
        properties: enum_set!(Property::Write),
        max_len: MAX_CHARACTERISTIC_VALUE_LEN,
        auto_rsp: AutoResponse::ByApp,
    }
}

pub fn rejected_write_status(is_prepared: bool, offset: u16) -> Option<GattStatus> {
    if is_prepared {
        Some(GattStatus::ReqNotSupported)
    } else if offset != 0 {
        Some(GattStatus::InvalidOffset)
    } else {
        None
    }
}
