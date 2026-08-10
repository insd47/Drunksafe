#[allow(unused_imports)]
pub use model::{
    DeviceError, DeviceEvent, DeviceStatus, ErrorCode, MeasurementKind, MeasurementResult,
    MeasurementStarted, PhoneCommand, Pulse, Source, StatusKind,
};
pub use service::BleService;
#[allow(unused_imports)]
pub use transport::{
    DeviceEventTransport, PhoneCommandTransport, TransportError, DEVICE_EVENT_CHARACTERISTIC_UUID,
    DEVICE_NAME, MAX_BLE_JSON_PAYLOAD_BYTES, PHONE_COMMAND_CHARACTERISTIC_UUID, SERVICE_UUID,
};
mod gatt;
mod model;
mod service;
#[allow(dead_code)]
mod transport;

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
    })
}

#[allow(dead_code)]
pub fn measurement_result(
    session_id: String,
    kind: MeasurementKind,
    measurement: crate::services::measure::Measurement,
) -> DeviceEvent {
    DeviceEvent::MeasurementResult(MeasurementResult {
        v: model::PROTOCOL_VERSION,
        session_id,
        kind,
        alcohol_mg_l_x1000: measurement.alcohol_mg_l_x1000(),
        pulse: measurement.pulse().map(|pulse| Pulse {
            bpm: pulse.bpm(),
            stable: pulse.stable(),
        }),
    })
}

#[allow(dead_code)]
pub fn device_status(status: StatusKind, active_session_id: Option<String>) -> DeviceEvent {
    DeviceEvent::Status(DeviceStatus {
        v: model::PROTOCOL_VERSION,
        status,
        active_session_id,
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
