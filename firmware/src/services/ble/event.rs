use super::model::{
    DeviceError, DeviceEvent, DeviceStatus, ErrorCode, MeasurementKind, MeasurementProgress,
    MeasurementStarted, MeasurementStep, Source, StatusKind, PROTOCOL_VERSION,
};

pub const PROGRESS: [(MeasurementStep, u8); 7] = [
    (MeasurementStep::Preparing, 5),
    (MeasurementStep::WarmingSensor, 15),
    (MeasurementStep::WaitingBreath, 25),
    (MeasurementStep::SamplingBreath, 50),
    (MeasurementStep::SamplingPulse, 75),
    (MeasurementStep::Analyzing, 90),
    (MeasurementStep::Done, 100),
];

pub fn started(session: String, source: Source, kind: MeasurementKind) -> DeviceEvent {
    DeviceEvent::MeasurementStarted(MeasurementStarted {
        v: PROTOCOL_VERSION,
        session_id: session,
        source,
        kind,
        history_limit: 8,
        needs_context: true,
        sync_time: true,
    })
}

pub fn progress(session: String, step: MeasurementStep) -> DeviceEvent {
    let percent = PROGRESS
        .iter()
        .find_map(|(candidate, percent)| (*candidate == step).then_some(*percent))
        .unwrap_or_default();

    DeviceEvent::MeasurementProgress(MeasurementProgress {
        v: PROTOCOL_VERSION,
        session_id: session,
        step,
        percent,
    })
}

pub fn status(status: StatusKind, session: Option<String>) -> DeviceEvent {
    DeviceEvent::Status(DeviceStatus {
        v: PROTOCOL_VERSION,
        status,
        active_session_id: session,
        battery_percent: None,
        firmware_version: Some(env!("CARGO_PKG_VERSION").to_owned()),
    })
}

pub fn error(session: Option<String>, code: ErrorCode) -> DeviceEvent {
    DeviceEvent::DeviceError(DeviceError {
        v: PROTOCOL_VERSION,
        session_id: session,
        code,
    })
}

pub fn code(error: &crate::error::Error) -> ErrorCode {
    match error {
        crate::error::Error::AlcoholDevice(_) => ErrorCode::AlcoholSensor,
        crate::error::Error::PulseDevice(_) => ErrorCode::PulseSensor,
        crate::error::Error::Timeout(_) => ErrorCode::MeasurementTimeout,
        crate::error::Error::Esp(_) => ErrorCode::Protocol,
    }
}
