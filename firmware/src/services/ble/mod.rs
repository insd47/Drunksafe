mod model;
#[allow(dead_code)]
mod transport;

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

/// 보드 버튼에서 시작된 새 측정 세션 이벤트를 만든다.
#[allow(dead_code)]
pub fn measurement_started(session_id: String) -> DeviceEvent {
    DeviceEvent::MeasurementStarted(MeasurementStarted {
        v: model::PROTOCOL_VERSION,
        session_id,
        source: Source::BoardButton,
        history_limit: 8,
        needs_context: true,
        sync_time: true,
    })
}
