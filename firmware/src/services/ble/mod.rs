#[allow(unused_imports)]
pub use model::{
    AlcoholState, AlcoholStateLabel, DeviceError, DeviceEvent, DeviceStatus, ErrorCode,
    MeasurementKind, MeasurementResult, MeasurementStarted, PhoneCommand, PpgSampleBatch,
    PulseReading, PulseResult, SessionComplete, SessionRecord, SessionRecordKind, SessionStateLabel,
    SessionStatus, Source, StatusKind,
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
    use crate::services::measure::PulseOutcome;

    let pulse = match measurement.pulse() {
        PulseOutcome::Measured { bpm, stable } => PulseResult::Measured { bpm, stable },
        PulseOutcome::Unavailable { reason } => PulseResult::Unavailable { reason },
    };

    DeviceEvent::MeasurementResult(MeasurementResult {
        v: model::PROTOCOL_VERSION,
        session_id,
        kind,
        alcohol_mg_l_x1000: measurement.alcohol_mg_l_x1000(),
        pulse,
    })
}

/// 측정 중 수집한 PPG raw sample 배치 이벤트를 만든다.
#[allow(dead_code)]
pub fn ppg_sample_batch(
    session_id: String,
    t0_ms: u32,
    dt_ms: u16,
    samples: Vec<u16>,
) -> DeviceEvent {
    DeviceEvent::PpgSample(PpgSampleBatch {
        v: model::PROTOCOL_VERSION,
        session_id,
        t0_ms,
        dt_ms,
        samples,
    })
}

/// 실시간 pulse 진단 스트리밍 중 즉석 분석 값을 담은 이벤트를 만든다.
#[allow(dead_code)]
pub fn pulse_reading(
    session_id: String,
    elapsed_ms: u32,
    diagnosis: crate::devices::pulse::Diagnosis,
) -> DeviceEvent {
    DeviceEvent::PulseReading(PulseReading {
        v: model::PROTOCOL_VERSION,
        session_id,
        elapsed_ms,
        bpm: diagnosis.bpm,
        ibi_stddev_ms: diagnosis.ibi_stddev_ms,
        peak_count: diagnosis.peak_count,
        stable: diagnosis.stable,
    })
}

/// ZE29A 상태 변화 이벤트를 만든다 (알코올 측정 중 "지금 부세요" 안내용).
#[allow(dead_code)]
pub fn alcohol_state(
    session_id: String,
    status: crate::devices::alcohol::Status,
) -> DeviceEvent {
    use crate::devices::alcohol::Status;

    let state = match status {
        Status::Idle => AlcoholStateLabel::Idle,
        Status::Preheating => AlcoholStateLabel::Preheating,
        Status::WaitBlow => AlcoholStateLabel::WaitBlow,
        Status::Blowing => AlcoholStateLabel::Blowing,
        Status::BlowInterrupted => AlcoholStateLabel::BlowInterrupted,
        Status::Calculating => AlcoholStateLabel::Calculating,
        Status::ReadResult => AlcoholStateLabel::ReadResult,
        Status::Unknown(_) => AlcoholStateLabel::Unknown,
    };

    DeviceEvent::AlcoholState(AlcoholState {
        v: model::PROTOCOL_VERSION,
        session_id,
        state,
    })
}

/// 세션 진행 상태 이벤트를 만든다.
#[allow(dead_code)]
pub fn session_status(
    session_id: String,
    state: SessionStateLabel,
    elapsed_ms: u32,
    records: u16,
    r0_bpm: Option<u16>,
    last_bpm: Option<u16>,
) -> DeviceEvent {
    DeviceEvent::SessionStatus(SessionStatus {
        v: model::PROTOCOL_VERSION,
        session_id,
        state,
        elapsed_ms,
        records,
        r0_bpm,
        last_bpm,
    })
}

/// 세션 로그 한 건을 다운로드용으로 만든다.
#[allow(dead_code)]
pub fn session_record(
    session_id: String,
    index: u16,
    total: u16,
    t_ms: u32,
    kind: SessionRecordKind,
    state: Option<SessionStateLabel>,
    mg_l_x1000: Option<u16>,
    bpm: Option<u16>,
) -> DeviceEvent {
    DeviceEvent::SessionRecord(SessionRecord {
        v: model::PROTOCOL_VERSION,
        session_id,
        index,
        total,
        t_ms,
        kind,
        state,
        mg_l_x1000,
        bpm,
    })
}

/// 세션 로그 스트리밍 종료 이벤트를 만든다.
#[allow(dead_code)]
pub fn session_complete(session_id: String, total: u16) -> DeviceEvent {
    DeviceEvent::SessionComplete(SessionComplete {
        v: model::PROTOCOL_VERSION,
        session_id,
        total,
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
