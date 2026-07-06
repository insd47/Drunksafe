mod analysis;
mod gatt;
mod model;
#[allow(dead_code)]
mod transport;

pub use analysis::measurement_result;
pub use gatt::BleService;
#[allow(unused_imports)]
pub use model::{
    Alcohol, DeviceError, DeviceEvent, DeviceStatus, ErrorCode, HistoryEntry, MeasurementProgress,
    MeasurementResult, MeasurementStarted, MeasurementStep, PhoneCommand, PhoneContext, Pulse,
    Risk, Source, StatusKind,
};
#[allow(unused_imports)]
pub use transport::{
    DeviceEventTransport, PhoneCommandTransport, TransportError, DEVICE_EVENT_CHARACTERISTIC_UUID,
    DEVICE_NAME, MAX_BLE_JSON_PAYLOAD_BYTES, PHONE_COMMAND_CHARACTERISTIC_UUID, SERVICE_UUID,
};

/// 새 측정 세션 이벤트를 만든다.
#[allow(dead_code)]
pub fn measurement_started(session_id: String, source: Source) -> DeviceEvent {
    DeviceEvent::MeasurementStarted(MeasurementStarted {
        v: model::PROTOCOL_VERSION,
        session_id,
        source,
        history_limit: 8,
        needs_context: true,
        sync_time: true,
    })
}

#[allow(dead_code)]
pub fn measurement_progress(session_id: String, step: MeasurementStep, percent: u8) -> DeviceEvent {
    DeviceEvent::MeasurementProgress(MeasurementProgress {
        v: model::PROTOCOL_VERSION,
        session_id,
        step,
        percent: percent.min(100),
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
