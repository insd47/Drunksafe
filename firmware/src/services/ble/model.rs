use serde::{Deserialize, Serialize};

/// BLE payload schema version이다.
pub const PROTOCOL_VERSION: u8 = 8;

/// 측정 세션을 시작한 입력 출처다.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    BoardButton,
    Phone,
}

/// 측정 결과가 일반 측정인지 sober baseline 측정인지 구분한다.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MeasurementKind {
    Measurement,
    Baseline,
}

/// BLE로 노출하는 장치 상태 label이다. Runtime state machine의 원천은 아니다.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StatusKind {
    Idle,
    Connected,
    Measuring,
    ResultReady,
    Error,
}

/// 앱이 조치할 수 있는 장치 또는 측정 오류다.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    AlcoholSensor,
    MeasurementTimeout,
    Cancelled,
}

/// 연결 직후와 상태 변경 시 앱에 보내는 장치 상태다.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct DeviceStatus {
    pub v: u8,
    pub status: StatusKind,
    pub active_session_id: Option<String>,
}

/// 보드 또는 앱에서 열린 새 측정 세션이다.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct MeasurementStarted {
    pub v: u8,
    pub session_id: String,
    pub source: Source,
    pub kind: MeasurementKind,
}

/// Pulse 측정 요약이다. PPG raw sample은 pulse device 내부에 둔다.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
pub struct Pulse {
    pub bpm: u16,
    pub stable: bool,
}

/// 앱이 로컬 분석할 원시 측정 결과다.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct MeasurementResult {
    pub v: u8,
    pub session_id: String,
    pub kind: MeasurementKind,
    pub alcohol_mg_l_x1000: u16,
    pub pulse: Option<Pulse>,
}

/// 오류 알림이다.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct DeviceError {
    pub v: u8,
    pub session_id: Option<String>,
    pub code: ErrorCode,
}

/// 앱에서 장치로 쓰는 BLE payload다.
#[allow(dead_code)]
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "cmd")]
pub enum PhoneCommand {
    Start { kind: MeasurementKind },
    Cancel { session_id: String },
}

/// 장치에서 앱으로 notify하는 BLE payload다.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "event")]
pub enum DeviceEvent {
    Status(DeviceStatus),
    MeasurementStarted(MeasurementStarted),
    MeasurementResult(MeasurementResult),
    DeviceError(DeviceError),
}
