use crate::devices::pulse::PulseUnavailableReason;
use serde::{Deserialize, Serialize};

/// BLE payload schema version이다.
pub const PROTOCOL_VERSION: u8 = 13;

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
    /// 알코올 측정을 마치고 사용자의 심박 측정 시작 지시를 기다리는 중이다.
    AwaitingPulse,
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

/// Pulse 측정 결과다. 측정 실패도 값으로 표현해 앱이 사유를 보여줄 수 있게 한다.
/// PPG raw sample은 별도로 `PpgSampleBatch`로 스트리밍된다.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "status")]
pub enum PulseResult {
    Measured { bpm: u16, stable: bool },
    Unavailable { reason: PulseUnavailableReason },
}

/// 앱이 로컬 분석할 원시 측정 결과다.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct MeasurementResult {
    pub v: u8,
    pub session_id: String,
    pub kind: MeasurementKind,
    pub alcohol_mg_l_x1000: u16,
    pub pulse: PulseResult,
}

/// ZE29A 알코올 센서의 실시간 상태다. 앱이 "지금 부세요" 타이밍을 안내하는 데 쓴다.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AlcoholStateLabel {
    Idle,
    Preheating,
    WaitBlow,
    Blowing,
    BlowInterrupted,
    Calculating,
    ReadResult,
    Unknown,
}

/// 알코올 측정 단계 중 ZE29A 상태 변화를 앱에 알린다.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct AlcoholState {
    pub v: u8,
    pub session_id: String,
    pub state: AlcoholStateLabel,
}

/// 오류 알림이다.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct DeviceError {
    pub v: u8,
    pub session_id: Option<String>,
    pub code: ErrorCode,
}

/// 실시간 pulse 진단 스트리밍(개발자 도구) 중 주기적으로 보내는 즉석 분석 값이다.
/// 확정된 결과가 아니라 관찰값이므로 측정 결과(`MeasurementResult`)와는 별개다.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct PulseReading {
    pub v: u8,
    pub session_id: String,
    /// pulse 스트림 세션 시작 이후 흐른 시간(ms)이다.
    pub elapsed_ms: u32,
    /// 현재 window에서 계산한 BPM이다. peak가 2개 미만이면 0.0이다.
    pub bpm: f32,
    pub ibi_stddev_ms: f32,
    pub peak_count: u16,
    pub stable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accepted_intervals: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_failure: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contact_good: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slot_index: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slot_elapsed_ms: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attempt_elapsed_ms: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consecutive_misses: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failed_attempts: Option<u16>,
}

/// PPG raw sample batch streamed during active measurement.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct PpgSampleBatch {
    pub v: u8,
    pub session_id: String,
    /// Elapsed ms of the first sample in this batch
    pub t0_ms: u32,
    /// Approximate ms interval between consecutive samples
    pub dt_ms: u16,
    /// Raw 12-bit ADC values (one per sample period)
    pub samples: Vec<u16>,
}

/// 세션(3단계 적응형 스케줄) 상태 label이다.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStateLabel {
    Dormant,
    Probe,
    Track,
}

/// 세션 로그 한 건의 종류다.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionRecordKind {
    State,
    Alcohol,
    AlcoholMissed,
    Heart,
    DrinkConfirmed,
}

/// 세션 진행 상태를 주기적으로 앱에 알린다 (연결돼 있을 때).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct SessionStatus {
    pub v: u8,
    pub session_id: String,
    pub state: SessionStateLabel,
    pub elapsed_ms: u32,
    pub records: u16,
    pub r0_bpm: Option<u16>,
    pub last_bpm: Option<u16>,
    pub valid_minutes: Option<u8>,
    pub high_minutes: Option<u8>,
    pub next_threshold_percent: Option<u16>,
    pub alerted_percent: Option<u16>,
}

/// 세션 종료 시 저장된 로그를 한 건씩 스트리밍한다. 값은 kind에 따라 채워진다.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct SessionRecord {
    pub v: u8,
    pub session_id: String,
    pub index: u16,
    pub total: u16,
    /// 세션 시작 이후 경과 시간(ms)이다. 절대시각은 앱이 수신 시 역산한다.
    pub t_ms: u32,
    pub kind: SessionRecordKind,
    pub state: Option<SessionStateLabel>,
    pub mg_l_x1000: Option<u16>,
    pub bpm: Option<u16>,
}

/// 세션 로그 스트리밍이 끝났음을 알린다.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct SessionComplete {
    pub v: u8,
    pub session_id: String,
    pub total: u16,
}

/// 음주 세션 중 자동(+10/+15/+20%) 또는 사용자 요청으로 수행한 알코올 측정 결과다.
/// `alcohol_mg_l_x1000 == None`이면 해당 시도가 실패했으며 앱에서 다시 요청할 수 있다.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct SessionAlcoholResult {
    pub v: u8,
    pub session_id: String,
    pub elapsed_ms: u32,
    pub trigger_percent: Option<u16>,
    pub alcohol_mg_l_x1000: Option<u16>,
}

/// 앱에서 장치로 쓰는 BLE payload다.
#[allow(dead_code)]
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "cmd")]
pub enum PhoneCommand {
    Start {
        kind: MeasurementKind,
    },
    Cancel {
        session_id: String,
    },
    /// 알코올 측정이 끝난 뒤(AwaitingPulse), 이어서 심박 측정 단계를 시작하도록 요청한다.
    StartPulsePhase {
        session_id: String,
    },
    /// 알코올을 빼고 pulse 진단(BPM)을 실시간 스트리밍하도록 요청한다 (개발자 도구).
    /// `stream_raw`가 true일 때만 PPG raw 파형까지 함께 전송한다 (전송량이 많아진다).
    StartPulseStream {
        stream_raw: bool,
    },
    /// 진행 중인 pulse 스트리밍을 멈추고 대기 화면으로 돌아가도록 요청한다.
    StopPulseStream,
    /// Observe resting-HR elevation and recommend alcohol checks at +10/+15/+20% thresholds.
    StartHrWatch {
        resting_bpm: u16,
    },
    /// 음주 세션(3단계 적응형 스케줄)을 시작한다. `resting_bpm`이 있으면 세션의 resting
    /// HR baseline 초기값으로 쓴다(앱 기준값 측정에서 얻은 값). 이후 폰은 꺼져 있어도 된다.
    StartSession {
        #[serde(default)]
        resting_bpm: Option<u16>,
    },
    /// 개발자 도구: 심박/스케줄(DORMANT/PROBE) 없이 알코올 값만 추적한다(분해 곡선 fitting용).
    /// 값이 임계(10)를 넘으면 기존 TRACK처럼 15분 간격으로 측정한다. EndSession으로 종료·다운로드.
    StartAlcoholTrack,
    /// 진행 중인 HR 관찰 세션에서 사용자가 원하는 시점에 알코올을 측정한다.
    MeasureSessionAlcohol,
    /// 진행 중인 세션을 종료하고 저장된 로그 다운로드를 시작한다.
    EndSession,
}

/// 장치에서 앱으로 notify하는 BLE payload다.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "event")]
pub enum DeviceEvent {
    Status(DeviceStatus),
    MeasurementStarted(MeasurementStarted),
    MeasurementResult(MeasurementResult),
    DeviceError(DeviceError),
    AlcoholState(AlcoholState),
    PpgSample(PpgSampleBatch),
    PulseReading(PulseReading),
    SessionStatus(SessionStatus),
    SessionRecord(SessionRecord),
    SessionComplete(SessionComplete),
    SessionAlcoholResult(SessionAlcoholResult),
}
