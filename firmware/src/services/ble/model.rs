use serde::{Deserialize, Serialize};

/// BLE payload schema version이다.
pub const PROTOCOL_VERSION: u8 = 7;

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

/// 측정 진행 단계다. 표시 문구는 screen/app 계층이 고른다.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MeasurementStep {
    Preparing,
    WarmingSensor,
    WaitingBreath,
    SamplingBreath,
    SamplingPulse,
    Analyzing,
    Done,
}

/// 장치와 앱이 함께 쓰는 보수적 위험 단계다.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Risk {
    Safe,
    Caution,
    Danger,
}

/// 앱이 조치할 수 있는 장치 또는 측정 오류다.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    ContextTimeout,
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
    pub battery_percent: Option<u8>,
    pub firmware_version: Option<String>,
}

/// 보드 또는 앱에서 열린 새 측정 세션이다.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct MeasurementStarted {
    pub v: u8,
    pub session_id: String,
    pub source: Source,
    pub kind: MeasurementKind,
    pub history_limit: u8,
    pub needs_context: bool,
    pub sync_time: bool,
}

/// 앱이 알고 있는 이전 측정 결과 한 건이다.
#[allow(dead_code)]
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct HistoryEntry {
    pub measured_at_unix_ms: u64,
    pub alcohol_mg_l_x1000: u16,
    pub bac_milli_percent: Option<u16>,
    pub risk: Risk,
    pub confidence_percent: u8,
}

/// 측정 전 앱이 장치에 보내는 context다. 원본 프로필 필드는 앱에 남긴다.
#[allow(dead_code)]
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct PhoneContext {
    pub v: u8,
    pub session_id: String,
    pub phone_time_unix_ms: Option<u64>,
    pub recent: Vec<HistoryEntry>,
    pub sober_alcohol_mg_l_x1000: Option<u16>,
    pub sober_alcohol_mad_mg_l_x1000: Option<u16>,
    pub elimination_mg_l_per_hour_x1000: Option<u16>,
    pub resting_bpm: Option<u16>,
}

/// 측정 진행률 알림이다.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct MeasurementProgress {
    pub v: u8,
    pub session_id: String,
    pub step: MeasurementStep,
    pub percent: u8,
}

/// 알코올 측정 요약이다. ZE29 raw frame은 alcohol device 밖으로 내보내지 않는다.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Alcohol {
    pub mg_l_x1000: u16,
}

/// Pulse 측정 요약이다. PPG raw sample은 pulse device 내부에 둔다.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
pub struct Pulse {
    pub bpm: f32,
    pub stable: bool,
    pub confidence_percent: u8,
}

/// 최종 측정 결과다. BAC 값은 milli-percent 단위이며 30은 0.030% BAC를 뜻한다.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct MeasurementResult {
    pub v: u8,
    pub session_id: String,
    pub kind: MeasurementKind,
    pub measured_at_unix_ms: Option<u64>,
    pub alcohol: Alcohol,
    pub pulse: Option<Pulse>,
    pub bac_milli_percent: Option<u16>,
    pub bac_upper_milli_percent: Option<u16>,
    pub sober_time_minutes: Option<u16>,
    pub risk: Risk,
    pub confidence_percent: u8,
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
    Context(PhoneContext),
    Cancel { session_id: String },
    Time { unix_time_ms: u64 },
    Ack { session_id: String },
}

/// 장치에서 앱으로 notify하는 BLE payload다.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "event")]
pub enum DeviceEvent {
    Status(DeviceStatus),
    MeasurementStarted(MeasurementStarted),
    MeasurementProgress(MeasurementProgress),
    MeasurementResult(MeasurementResult),
    DeviceError(DeviceError),
}
