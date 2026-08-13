use super::attributes::{self, Attributes, RegistrationAction};
use super::connection::{ConnectionAction, ConnectionState};
use super::gap::{self, Advertising, AdvertisingAction};
use super::status;
use crate::services::ble::{
    self, DeviceEvent, DeviceEventTransport, PhoneCommand, PhoneCommandTransport, StatusKind,
    DEVICE_NAME,
};
use esp_idf_svc::bt::ble::gap::{BleGapEvent, EspBleGap};
use esp_idf_svc::bt::ble::gatt::server::{ConnectionId, EspGatts, GattsEvent, TransferId};
use esp_idf_svc::bt::ble::gatt::{GattInterface, GattStatus, Handle};
use esp_idf_svc::bt::{Ble, BtDriver};
use esp_idf_svc::sys::{EspError, ESP_FAIL};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

const APP_ID: u16 = 0;
const NOTIFY_ENABLED: u16 = 0x0001;
const INDICATE_ENABLED: u16 = 0x0002;

type Driver = BtDriver<'static, Ble>;
type Gap = Arc<EspBleGap<'static, Ble, Arc<Driver>>>;
type Gatts = Arc<EspGatts<'static, Ble, Arc<Driver>>>;

#[derive(Default)]
struct State {
    attributes: Attributes,
    connections: ConnectionState,
    phone_transport: PhoneCommandTransport,
    event_transport: DeviceEventTransport,
    last_status: Option<DeviceEvent>,
    advertising: Advertising,
}

#[derive(Clone)]
pub struct GattServer {
    gap: Gap,
    gatts: Gatts,
    state: Arc<Mutex<State>>,
    commands: Sender<PhoneCommand>,
}

impl GattServer {
    pub fn new(driver: Arc<Driver>, commands: Sender<PhoneCommand>) -> Result<Self, EspError> {
        Ok(Self {
            gap: Arc::new(EspBleGap::new(driver.clone())?),
            gatts: Arc::new(EspGatts::new(driver)?),
            state: Arc::new(Mutex::new(State::default())),
            commands,
        })
    }

    pub fn start(&self) -> Result<(), EspError> {
        let server = self.clone();
        self.gap.subscribe(move |event| {
            status::callback(server.on_gap_event(event));
        })?;

        let server = self.clone();
        self.gatts.subscribe(move |(gatt_if, event)| {
            status::callback(server.on_gatts_event(gatt_if, event));
        })?;

        self.gatts.register_app(APP_ID)?;
        log::info!("BLE GATT server registered");
        Ok(())
    }

    /// 현재 휴대폰이 연결돼 있는지 여부다.
    pub fn is_connected(&self) -> bool {
        self.state.lock().unwrap().connections.is_connected()
    }

    /// advertising 재시도 횟수를 리셋하고 다시 시작을 트리거한다. 결과 화면에서
    /// 버튼 길게 누르기로 대기 화면에 복귀할 때, 연결이 없으면 호출한다.
    pub fn ensure_advertising(&self) -> Result<(), EspError> {
        log::info!("BLE advertising restart requested");
        self.begin_advertising()
    }

    pub fn notify(&self, event: &DeviceEvent) -> Result<(), EspError> {
        let target = {
            let mut state = self.state.lock().unwrap();

            if let DeviceEvent::Status(_) = event {
                state.last_status = Some(event.clone());
            }

            let Some(gatt_if) = state.attributes.gatt_if() else {
                return Ok(());
            };
            let Some(event_handle) = state.attributes.event_handle() else {
                return Ok(());
            };
            let Some(target) = state.connections.notification_target() else {
                return Ok(());
            };

            let frames = state
                .event_transport
                .frames_with_max_payload_bytes(event, target.max_payload_bytes)
                .map_err(|error| {
                    log::warn!("failed to serialize BLE event: {error}");
                    EspError::from_infallible::<ESP_FAIL>()
                })?;

            (gatt_if, target.conn_id, event_handle, frames)
        };

        let (gatt_if, conn_id, event_handle, frames) = target;
        for frame in frames {
            self.gatts
                .notify(gatt_if, conn_id, event_handle, frame.as_bytes())?;
        }

        Ok(())
    }

    fn on_gap_event(&self, event: BleGapEvent) -> Result<(), EspError> {
        log::debug!("BLE GAP event: {event:?}");
        let action = self.state.lock().unwrap().advertising.event(&event);

        match action {
            AdvertisingAction::None => Ok(()),
            AdvertisingAction::Configure => self.configure_advertising(),
            AdvertisingAction::Start => {
                if let Err(error) = self.gap.start_advertising() {
                    log::warn!("BLE advertising start request failed: {error:?}");
                    return self.configure_advertising();
                }

                Ok(())
            }
            AdvertisingAction::Started => {
                log::info!("BLE advertising started");
                Ok(())
            }
        }
    }

    fn on_gatts_event(&self, gatt_if: GattInterface, event: GattsEvent) -> Result<(), EspError> {
        log::debug!("BLE GATTS event: {event:?}");

        match event {
            GattsEvent::ServiceRegistered {
                status: result,
                app_id,
            } => {
                status::gatt(result)?;

                if app_id == APP_ID {
                    let action = self.state.lock().unwrap().attributes.registered(gatt_if);
                    self.execute_registration(action)?;
                }
            }
            GattsEvent::ServiceCreated {
                status: result,
                service_handle,
                ..
            } => {
                status::gatt(result)?;
                let action = self
                    .state
                    .lock()
                    .unwrap()
                    .attributes
                    .service_created(service_handle);
                self.execute_registration(action)?;
            }
            GattsEvent::CharacteristicAdded {
                status: result,
                attr_handle,
                service_handle,
                char_uuid,
            } => {
                status::gatt(result)?;
                let action = self.state.lock().unwrap().attributes.characteristic_added(
                    service_handle,
                    attr_handle,
                    char_uuid,
                );
                self.execute_registration(action)?;
            }
            GattsEvent::DescriptorAdded {
                status: result,
                attr_handle,
                service_handle,
                descr_uuid,
            } => {
                status::gatt(result)?;
                let action = self.state.lock().unwrap().attributes.descriptor_added(
                    service_handle,
                    attr_handle,
                    descr_uuid,
                );
                self.execute_registration(action)?;
            }
            GattsEvent::ServiceStarted {
                status: result,
                service_handle,
            } => {
                status::gatt(result)?;
                let action = self
                    .state
                    .lock()
                    .unwrap()
                    .attributes
                    .service_started(service_handle);
                self.execute_registration(action)?;
            }
            GattsEvent::Mtu { conn_id, mtu } => {
                if let Some(replay) = self.register_mtu(conn_id, mtu) {
                    self.notify(&replay)?;
                }
            }
            GattsEvent::PeerConnected { conn_id, addr, .. } => {
                let action = self
                    .state
                    .lock()
                    .unwrap()
                    .connections
                    .connected(conn_id, addr);
                self.execute_connection(action)?;
            }
            GattsEvent::PeerDisconnected { addr, .. } => {
                let action = self.state.lock().unwrap().connections.disconnected(addr);
                self.execute_connection(action)?;
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
                if let Some(response_status) = attributes::rejected_write_status(is_prep, offset) {
                    self.send_write_response(
                        gatt_if,
                        conn_id,
                        trans_id,
                        need_rsp,
                        response_status,
                    )?;
                    return Ok(());
                }

                let outcome = self.accept_write(conn_id, handle, value);

                if outcome.handled {
                    self.send_write_response(gatt_if, conn_id, trans_id, need_rsp, GattStatus::Ok)?;
                }

                if let Some(command) = outcome.command {
                    if self.commands.send(command).is_err() {
                        log::warn!("dropping BLE command because main loop receiver is gone");
                    }
                }

                if let Some(replay) = outcome.replay {
                    self.notify(&replay)?;
                }
            }
            _ => {}
        }

        Ok(())
    }

    fn execute_registration(&self, action: RegistrationAction) -> Result<(), EspError> {
        match action {
            RegistrationAction::None => Ok(()),
            RegistrationAction::CreateService { gatt_if } => {
                self.gap.set_device_name(DEVICE_NAME)?;
                self.gatts
                    .create_service(gatt_if, &attributes::service_id(), 8)
            }
            RegistrationAction::AddEventCharacteristic { service_handle } => self
                .gatts
                .add_characteristic(service_handle, &attributes::event_characteristic(), &[]),
            RegistrationAction::AddEventConfiguration { service_handle } => self
                .gatts
                .add_descriptor(service_handle, &attributes::event_configuration()),
            RegistrationAction::AddCommandCharacteristic { service_handle } => self
                .gatts
                .add_characteristic(service_handle, &attributes::command_characteristic(), &[]),
            RegistrationAction::StartService { service_handle } => {
                self.gatts.start_service(service_handle)
            }
            RegistrationAction::BeginAdvertising => self.begin_advertising(),
        }
    }

    fn execute_connection(&self, action: ConnectionAction) -> Result<(), EspError> {
        match action {
            ConnectionAction::None => Ok(()),
            ConnectionAction::StopAdvertising => self.gap.stop_advertising(),
            ConnectionAction::BeginAdvertising => self.begin_advertising(),
        }
    }

    fn begin_advertising(&self) -> Result<(), EspError> {
        self.state.lock().unwrap().advertising.begin();
        self.configure_advertising()
    }

    fn configure_advertising(&self) -> Result<(), EspError> {
        loop {
            let attempt = self.state.lock().unwrap().advertising.next_attempt();
            let Some(attempt) = attempt else {
                log::warn!(
                    "BLE advertising stopped after {} failed attempts",
                    gap::ADVERTISING_MAX_ATTEMPTS
                );
                return Err(EspError::from_infallible::<ESP_FAIL>());
            };

            match self.gap.set_adv_conf(&gap::configuration()) {
                Ok(()) => {
                    log::debug!("BLE advertising configuration requested, attempt={attempt}");
                    return Ok(());
                }
                Err(error) => {
                    log::warn!(
                        "BLE advertising configuration request failed, attempt={attempt}: {error:?}"
                    );
                }
            }
        }
    }

    fn register_mtu(&self, conn_id: ConnectionId, mtu: u16) -> Option<DeviceEvent> {
        let mut state = self.state.lock().unwrap();
        let subscribed = state.connections.mtu(conn_id, mtu)?;
        log::info!("BLE negotiated MTU={mtu}, conn_id={conn_id}");

        subscribed.then(|| current_status(&state))
    }

    fn accept_write(&self, conn_id: ConnectionId, handle: Handle, value: &[u8]) -> WriteOutcome {
        let mut state = self.state.lock().unwrap();

        if Some(handle) == state.attributes.event_cccd_handle() {
            if value.len() != 2 {
                return WriteOutcome::handled();
            }

            let configuration = u16::from_le_bytes([value[0], value[1]]);
            let enabled = configuration == NOTIFY_ENABLED || configuration == INDICATE_ENABLED;
            let replay = state
                .connections
                .subscribed(conn_id, enabled)
                .is_some_and(|ready| ready)
                .then(|| current_status(&state));
            log::info!("BLE client subscribed={enabled}");

            return WriteOutcome {
                handled: true,
                command: None,
                replay,
            };
        }

        if Some(handle) != state.attributes.command_handle() {
            return WriteOutcome::default();
        }

        let command = match state.phone_transport.accept(value) {
            Ok(command) => command,
            Err(error) => {
                log::warn!("invalid BLE command payload: {error}");
                None
            }
        };

        WriteOutcome {
            handled: true,
            command,
            replay: None,
        }
    }

    fn send_write_response(
        &self,
        gatt_if: GattInterface,
        conn_id: ConnectionId,
        trans_id: TransferId,
        need_rsp: bool,
        response_status: GattStatus,
    ) -> Result<(), EspError> {
        if !need_rsp {
            return Ok(());
        }

        self.gatts
            .send_response(gatt_if, conn_id, trans_id, response_status, None)
    }
}

#[derive(Default)]
struct WriteOutcome {
    handled: bool,
    command: Option<PhoneCommand>,
    replay: Option<DeviceEvent>,
}

impl WriteOutcome {
    const fn handled() -> Self {
        Self {
            handled: true,
            command: None,
            replay: None,
        }
    }
}

fn current_status(state: &State) -> DeviceEvent {
    state
        .last_status
        .clone()
        .unwrap_or_else(|| ble::device_status(StatusKind::Connected, None))
}
