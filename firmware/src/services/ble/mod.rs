mod model;

#[allow(unused_imports)]
pub use model::{
    Alcohol, DeviceError, DeviceEvent, DeviceStatus, ErrorCode, HistoryEntry, MeasurementProgress,
    MeasurementResult, MeasurementStarted, MeasurementStep, PhoneCommand, PhoneContext, Pulse,
    Risk, Source, StatusKind,
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
