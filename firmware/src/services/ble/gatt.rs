use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};

use enumset::enum_set;
use esp_idf_svc::bt::ble::gap::{AdvConfiguration, BleGapEvent, EspBleGap};
use esp_idf_svc::bt::ble::gatt::server::{ConnectionId, EspGatts, GattsEvent, TransferId};
use esp_idf_svc::bt::ble::gatt::{
    set_local_mtu, AutoResponse, GattCharacteristic, GattDescriptor, GattId, GattInterface,
    GattResponse, GattServiceId, GattStatus, Handle, Permission, Property,
};
use esp_idf_svc::bt::{BdAddr, Ble, BtDriver, BtStatus, BtUuid};
use esp_idf_svc::hal::modem::Modem;
use esp_idf_svc::nvs::EspDefaultNvsPartition;
use esp_idf_svc::sys::{EspError, ESP_FAIL};
use log::{debug, info, warn};

use super::{
    DeviceEvent, DeviceEventTransport, PhoneCommand, PhoneCommandTransport,
    DEVICE_EVENT_CHARACTERISTIC_UUID, DEVICE_NAME, PHONE_COMMAND_CHARACTERISTIC_UUID, SERVICE_UUID,
};

const APP_ID: u16 = 0;
const LOCAL_MTU: u16 = 185;
const MAX_CHARACTERISTIC_VALUE_LEN: usize = 200;
const CLIENT_CHARACTERISTIC_CONFIGURATION_UUID: u16 = 0x2902;
const NOTIFY_ENABLED: u16 = 0x0001;
const INDICATE_ENABLED: u16 = 0x0002;
const ADVERTISING_MAX_ATTEMPTS: u8 = 3;

type Driver = BtDriver<'static, Ble>;
type Gap = Arc<EspBleGap<'static, Ble, Arc<Driver>>>;
type Gatts = Arc<EspGatts<'static, Ble, Arc<Driver>>>;

pub struct BleService {
    _bt: Arc<Driver>,
    server: GattServer,
    commands: Receiver<PhoneCommand>,
}

impl BleService {
    pub fn new(modem: Modem<'static>) -> Result<Self, EspError> {
        let nvs = EspDefaultNvsPartition::take()?;
        let bt = Arc::new(BtDriver::new(modem, Some(nvs))?);
        set_local_mtu(LOCAL_MTU)?;
        info!("BLE local MTU set to {LOCAL_MTU}");
        let gap = Arc::new(EspBleGap::new(bt.clone())?);
        let gatts = Arc::new(EspGatts::new(bt.clone())?);
        let (command_tx, commands) = mpsc::channel();
        let server = GattServer::new(gap, gatts, command_tx);

        let gap_server = server.clone();
        server.gap.subscribe(move |event| {
            gap_server.check_esp_status(gap_server.on_gap_event(event));
        })?;

        let gatts_server = server.clone();
        server.gatts.subscribe(move |(gatt_if, event)| {
            gatts_server.check_esp_status(gatts_server.on_gatts_event(gatt_if, event));
        })?;

        server.gatts.register_app(APP_ID)?;
        info!("BLE GATT server registered");

        Ok(Self {
            _bt: bt,
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

#[derive(Clone, Debug)]
struct Connection {
    peer: BdAddr,
    conn_id: ConnectionId,
    subscribed: bool,
    mtu: Option<u16>,
}

#[derive(Default)]
struct State {
    gatt_if: Option<GattInterface>,
    service_handle: Option<Handle>,
    event_handle: Option<Handle>,
    command_handle: Option<Handle>,
    event_cccd_handle: Option<Handle>,
    connections: Vec<Connection>,
    response: GattResponse,
    phone_transport: PhoneCommandTransport,
    event_transport: DeviceEventTransport,
    last_status: Option<DeviceEvent>,
    advertising_attempts: u8,
}

#[derive(Clone)]
struct GattServer {
    gap: Gap,
    gatts: Gatts,
    state: Arc<Mutex<State>>,
    command_tx: Sender<PhoneCommand>,
}

impl GattServer {
    fn new(gap: Gap, gatts: Gatts, command_tx: Sender<PhoneCommand>) -> Self {
        Self {
            gap,
            gatts,
            state: Arc::new(Mutex::new(State::default())),
            command_tx,
        }
    }

    fn notify(&self, event: &DeviceEvent) -> Result<(), EspError> {
        let targets = {
            let mut state = self.state.lock().unwrap();

            if let DeviceEvent::Status(_) = event {
                state.last_status = Some(event.clone());
            }

            let Some(gatt_if) = state.gatt_if else {
                return Ok(());
            };
            let Some(event_handle) = state.event_handle else {
                return Ok(());
            };

            let mut targets = Vec::new();

            let connections = state
                .connections
                .iter()
                .filter_map(|conn| {
                    if !conn.subscribed {
                        return None;
                    }

                    let mtu = conn.mtu?;
                    Some((conn.conn_id, mtu.saturating_sub(3) as usize))
                })
                .collect::<Vec<_>>();

            for (conn_id, max_payload_bytes) in connections {
                let frames = state
                    .event_transport
                    .frames_with_max_payload_bytes(event, max_payload_bytes)
                    .map_err(|error| {
                        warn!("failed to serialize BLE event: {error}");
                        EspError::from_infallible::<ESP_FAIL>()
                    })?;

                targets.push((gatt_if, conn_id, event_handle, frames));
            }

            targets
        };

        for (gatt_if, conn_id, event_handle, frames) in targets {
            for frame in frames {
                self.gatts
                    .notify(gatt_if, conn_id, event_handle, frame.as_bytes())?;
            }
        }

        Ok(())
    }

    fn on_gap_event(&self, event: BleGapEvent) -> Result<(), EspError> {
        debug!("BLE GAP event: {event:?}");

        match event {
            BleGapEvent::AdvertisingConfigured(status) => {
                if !matches!(status, BtStatus::Success) {
                    warn!("BLE advertising configuration failed: {status:?}");
                    return self.configure_advertising();
                }

                if let Err(error) = self.gap.start_advertising() {
                    warn!("BLE advertising start request failed: {error:?}");
                    return self.configure_advertising();
                }
            }
            BleGapEvent::AdvertisingStarted(status) => {
                if !matches!(status, BtStatus::Success) {
                    warn!("BLE advertising start failed: {status:?}");
                    return self.configure_advertising();
                }

                self.state.lock().unwrap().advertising_attempts = 0;
                info!("BLE advertising started");
            }
            _ => {}
        }

        Ok(())
    }

    fn on_gatts_event(&self, gatt_if: GattInterface, event: GattsEvent) -> Result<(), EspError> {
        debug!("BLE GATTS event: {event:?}");

        match event {
            GattsEvent::ServiceRegistered { status, app_id } => {
                self.check_gatt_status(status)?;
                if app_id == APP_ID {
                    self.create_service(gatt_if)?;
                }
            }
            GattsEvent::ServiceCreated {
                status,
                service_handle,
                ..
            } => {
                self.check_gatt_status(status)?;
                self.configure_service(service_handle)?;
            }
            GattsEvent::CharacteristicAdded {
                status,
                attr_handle,
                service_handle,
                char_uuid,
            } => {
                self.check_gatt_status(status)?;
                self.register_characteristic(service_handle, attr_handle, char_uuid)?;
            }
            GattsEvent::DescriptorAdded {
                status,
                attr_handle,
                service_handle,
                descr_uuid,
            } => {
                self.check_gatt_status(status)?;
                self.register_descriptor(service_handle, attr_handle, descr_uuid)?;
                self.gatts.add_characteristic(
                    service_handle,
                    &GattCharacteristic {
                        uuid: BtUuid::uuid128(PHONE_COMMAND_CHARACTERISTIC_UUID),
                        permissions: enum_set!(Permission::Write),
                        properties: enum_set!(Property::Write),
                        max_len: MAX_CHARACTERISTIC_VALUE_LEN,
                        auto_rsp: AutoResponse::ByApp,
                    },
                    &[],
                )?;
            }
            GattsEvent::ServiceStarted {
                status,
                service_handle,
            } => {
                self.check_gatt_status(status)?;

                if self.state.lock().unwrap().service_handle == Some(service_handle) {
                    self.begin_advertising()?;
                }
            }
            GattsEvent::Mtu { conn_id, mtu } => {
                if let Some(status) = self.register_mtu(conn_id, mtu) {
                    self.notify(&status)?;
                }
            }
            GattsEvent::PeerConnected { conn_id, addr, .. } => {
                self.add_connection(conn_id, addr)?;
            }
            GattsEvent::PeerDisconnected { addr, .. } => {
                self.remove_connection(addr)?;
            }
            GattsEvent::Write {
                conn_id,
                trans_id,
                handle,
                offset,
                need_rsp,
                is_prep,
                value,
                ..
            } => {
                let (handled, status_replay) = self.handle_write(conn_id, handle, offset, value)?;

                if handled {
                    self.send_write_response(
                        gatt_if, conn_id, trans_id, handle, offset, need_rsp, is_prep, value,
                    )?;
                }

                if let Some(event) = status_replay {
                    self.notify(&event)?;
                }
            }
            _ => {}
        }

        Ok(())
    }

    fn create_service(&self, gatt_if: GattInterface) -> Result<(), EspError> {
        self.state.lock().unwrap().gatt_if = Some(gatt_if);

        self.gap.set_device_name(DEVICE_NAME)?;
        self.gatts.create_service(
            gatt_if,
            &GattServiceId {
                id: GattId {
                    uuid: BtUuid::uuid128(SERVICE_UUID),
                    inst_id: 0,
                },
                is_primary: true,
            },
            8,
        )?;

        Ok(())
    }

    fn configure_service(&self, service_handle: Handle) -> Result<(), EspError> {
        self.state.lock().unwrap().service_handle = Some(service_handle);
        self.add_characteristics(service_handle)
    }

    fn begin_advertising(&self) -> Result<(), EspError> {
        self.state.lock().unwrap().advertising_attempts = 0;
        self.configure_advertising()
    }

    fn configure_advertising(&self) -> Result<(), EspError> {
        loop {
            let attempt = {
                let mut state = self.state.lock().unwrap();

                if state.advertising_attempts >= ADVERTISING_MAX_ATTEMPTS {
                    warn!(
                        "BLE advertising stopped after {ADVERTISING_MAX_ATTEMPTS} failed attempts"
                    );
                    return Err(EspError::from_infallible::<ESP_FAIL>());
                }

                state.advertising_attempts += 1;
                state.advertising_attempts
            };

            let configuration = AdvConfiguration {
                include_name: true,
                include_txpower: true,
                flag: 2,
                service_uuid: None,
                ..Default::default()
            };

            match self.gap.set_adv_conf(&configuration) {
                Ok(()) => {
                    debug!("BLE advertising configuration requested, attempt={attempt}");
                    return Ok(());
                }
                Err(error) => {
                    warn!("BLE advertising configuration request failed, attempt={attempt}: {error:?}");
                }
            }
        }
    }

    fn add_characteristics(&self, service_handle: Handle) -> Result<(), EspError> {
        self.gatts.add_characteristic(
            service_handle,
            &GattCharacteristic {
                uuid: BtUuid::uuid128(DEVICE_EVENT_CHARACTERISTIC_UUID),
                permissions: enum_set!(Permission::Read),
                properties: enum_set!(Property::Notify | Property::Read),
                max_len: MAX_CHARACTERISTIC_VALUE_LEN,
                auto_rsp: AutoResponse::ByGatt,
            },
            &[],
        )?;
        Ok(())
    }

    fn register_characteristic(
        &self,
        service_handle: Handle,
        attr_handle: Handle,
        char_uuid: BtUuid,
    ) -> Result<(), EspError> {
        let add_cccd = {
            let mut state = self.state.lock().unwrap();

            if state.service_handle != Some(service_handle) {
                false
            } else if char_uuid == BtUuid::uuid128(DEVICE_EVENT_CHARACTERISTIC_UUID) {
                state.event_handle = Some(attr_handle);
                true
            } else if char_uuid == BtUuid::uuid128(PHONE_COMMAND_CHARACTERISTIC_UUID) {
                state.command_handle = Some(attr_handle);
                false
            } else {
                false
            }
        };

        if add_cccd {
            self.gatts.add_descriptor(
                service_handle,
                &GattDescriptor {
                    uuid: BtUuid::uuid16(CLIENT_CHARACTERISTIC_CONFIGURATION_UUID),
                    permissions: enum_set!(Permission::Read | Permission::Write),
                },
            )?;
        } else if char_uuid == BtUuid::uuid128(PHONE_COMMAND_CHARACTERISTIC_UUID) {
            self.gatts.start_service(service_handle)?;
        }

        Ok(())
    }

    fn register_descriptor(
        &self,
        service_handle: Handle,
        attr_handle: Handle,
        descr_uuid: BtUuid,
    ) -> Result<(), EspError> {
        let mut state = self.state.lock().unwrap();

        if state.service_handle == Some(service_handle)
            && descr_uuid == BtUuid::uuid16(CLIENT_CHARACTERISTIC_CONFIGURATION_UUID)
        {
            state.event_cccd_handle = Some(attr_handle);
        }

        Ok(())
    }

    fn register_mtu(&self, conn_id: ConnectionId, mtu: u16) -> Option<DeviceEvent> {
        let mut state = self.state.lock().unwrap();

        let subscribed = state
            .connections
            .iter_mut()
            .find(|conn| conn.conn_id == conn_id)
            .map(|conn| {
                conn.mtu = Some(mtu);
                conn.subscribed
            })?;

        info!("BLE negotiated MTU={mtu}, conn_id={conn_id}");

        if subscribed {
            Some(
                state
                    .last_status
                    .clone()
                    .unwrap_or_else(|| super::device_status(super::StatusKind::Connected, None)),
            )
        } else {
            None
        }
    }

    fn add_connection(&self, conn_id: ConnectionId, addr: BdAddr) -> Result<(), EspError> {
        {
            let mut state = self.state.lock().unwrap();

            if !state.connections.iter().any(|conn| conn.peer == addr) {
                state.connections.push(Connection {
                    peer: addr,
                    conn_id,
                    subscribed: false,
                    mtu: None,
                });
            }
        }

        self.gap.stop_advertising()?;
        Ok(())
    }

    fn remove_connection(&self, addr: BdAddr) -> Result<(), EspError> {
        {
            let mut state = self.state.lock().unwrap();

            if let Some(index) = state
                .connections
                .iter()
                .position(|Connection { peer, .. }| *peer == addr)
            {
                state.connections.swap_remove(index);
            }
        }

        self.begin_advertising()
    }

    fn handle_write(
        &self,
        conn_id: ConnectionId,
        handle: Handle,
        offset: u16,
        value: &[u8],
    ) -> Result<(bool, Option<DeviceEvent>), EspError> {
        let mut command = None;
        let mut subscribe_status = None;

        let handled = {
            let mut state = self.state.lock().unwrap();

            if Some(handle) == state.event_cccd_handle {
                if offset == 0 && value.len() == 2 {
                    let value = u16::from_le_bytes([value[0], value[1]]);
                    let subscribed = value == NOTIFY_ENABLED || value == INDICATE_ENABLED;
                    let mut replay_ready = false;

                    if let Some(conn) = state
                        .connections
                        .iter_mut()
                        .find(|conn| conn.conn_id == conn_id)
                    {
                        conn.subscribed = subscribed;
                        replay_ready = subscribed && conn.mtu.is_some();
                        info!("BLE client subscribed={}", conn.subscribed);
                    }

                    if replay_ready {
                        subscribe_status = Some(state.last_status.clone().unwrap_or_else(|| {
                            super::device_status(super::StatusKind::Connected, None)
                        }));
                    }
                }

                true
            } else if Some(handle) == state.command_handle {
                match state.phone_transport.accept(value) {
                    Ok(Some(accepted)) => {
                        command = Some(accepted);
                    }
                    Ok(None) => {}
                    Err(error) => warn!("invalid BLE command payload: {error}"),
                }

                true
            } else {
                false
            }
        };

        if !handled {
            return Ok((false, None));
        }

        if let Some(command) = command {
            if self.command_tx.send(command).is_err() {
                warn!("dropping BLE command because main loop receiver is gone");
            }
        }

        Ok((true, subscribe_status))
    }

    #[allow(clippy::too_many_arguments)]
    fn send_write_response(
        &self,
        gatt_if: GattInterface,
        conn_id: ConnectionId,
        trans_id: TransferId,
        handle: Handle,
        offset: u16,
        need_rsp: bool,
        is_prep: bool,
        value: &[u8],
    ) -> Result<(), EspError> {
        if !need_rsp {
            return Ok(());
        }

        if is_prep {
            let mut state = self.state.lock().unwrap();

            state
                .response
                .attr_handle(handle)
                .auth_req(0)
                .offset(offset)
                .value(value)
                .map_err(|_| EspError::from_infallible::<ESP_FAIL>())?;

            self.gatts.send_response(
                gatt_if,
                conn_id,
                trans_id,
                GattStatus::Ok,
                Some(&state.response),
            )
        } else {
            self.gatts
                .send_response(gatt_if, conn_id, trans_id, GattStatus::Ok, None)
        }
    }

    fn check_esp_status(&self, status: Result<(), EspError>) {
        if let Err(error) = status {
            warn!("BLE callback failed: {error:?}");
        }
    }

    fn check_gatt_status(&self, status: GattStatus) -> Result<(), EspError> {
        if matches!(status, GattStatus::Ok) {
            Ok(())
        } else {
            warn!("GATT status is not ok: {status:?}");
            Err(EspError::from_infallible::<ESP_FAIL>())
        }
    }
}
