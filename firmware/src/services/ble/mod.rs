mod analysis;
mod gatt;
mod model;
mod session;
#[allow(dead_code)]
mod transport;

pub use analysis::measurement_result;
pub use gatt::BleService;
#[allow(unused_imports)]
pub use model::{
    Alcohol, DeviceError, DeviceEvent, DeviceStatus, ErrorCode, HistoryEntry, MeasurementKind,
    MeasurementProgress, MeasurementResult, MeasurementStarted, MeasurementStep, PhoneCommand,
    PhoneContext, Pulse, Risk, Source, StatusKind,
};
pub(crate) use session::SessionContext;
#[allow(unused_imports)]
pub use transport::{
    DeviceEventTransport, PhoneCommandTransport, TransportError, DEVICE_EVENT_CHARACTERISTIC_UUID,
    DEVICE_NAME, MAX_BLE_JSON_PAYLOAD_BYTES, PHONE_COMMAND_CHARACTERISTIC_UUID, SERVICE_UUID,
};

pub const MEASUREMENT_PROGRESS_PLAN: [(MeasurementStep, u8); 7] = [
    (MeasurementStep::Preparing, 5),
    (MeasurementStep::WarmingSensor, 15),
    (MeasurementStep::WaitingBreath, 25),
    (MeasurementStep::SamplingBreath, 50),
    (MeasurementStep::SamplingPulse, 75),
    (MeasurementStep::Analyzing, 90),
    (MeasurementStep::Done, 100),
];

/// 새 측정 세션 이벤트를 만든다.
#[allow(dead_code)]
pub fn measurement_started(
    session_id: String,
    source: Source,
    kind: MeasurementKind,
) -> DeviceEvent {
    DeviceEvent::MeasurementStarted(MeasurementStarted {
        v: model::PROTOCOL_VERSION,
        session_id,
        source,
        kind,
        history_limit: 8,
        needs_context: true,
        sync_time: true,
    })
}

#[allow(dead_code)]
pub fn measurement_progress(session_id: String, step: MeasurementStep) -> DeviceEvent {
    DeviceEvent::MeasurementProgress(MeasurementProgress {
        v: model::PROTOCOL_VERSION,
        session_id,
        step,
        percent: progress_percent(step),
    })
}

#[allow(dead_code)]
pub fn device_status(status: StatusKind, active_session_id: Option<String>) -> DeviceEvent {
    DeviceEvent::Status(DeviceStatus {
        v: model::PROTOCOL_VERSION,
        status,
        active_session_id,
        battery_percent: None,
        firmware_version: Some(env!("CARGO_PKG_VERSION").to_owned()),
    })
}

#[allow(dead_code)]
pub fn device_error(session_id: Option<String>, code: ErrorCode) -> DeviceEvent {
    DeviceEvent::DeviceError(DeviceError {
        v: model::PROTOCOL_VERSION,
        session_id,
        code,
    })
}

pub fn error_code(error: &crate::error::Error) -> ErrorCode {
    match error {
        crate::error::Error::AlcoholDevice(_) => ErrorCode::AlcoholSensor,
        crate::error::Error::PulseDevice(_) => ErrorCode::PulseSensor,
        crate::error::Error::Timeout(_) => ErrorCode::MeasurementTimeout,
        crate::error::Error::Esp(_) => ErrorCode::Protocol,
    }
}

fn progress_percent(step: MeasurementStep) -> u8 {
    MEASUREMENT_PROGRESS_PLAN
        .iter()
        .find_map(|(candidate, percent)| (*candidate == step).then_some(*percent))
        .unwrap_or_default()
}
