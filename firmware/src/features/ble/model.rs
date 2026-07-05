use crate::devices::{AlcoholSample, PulseAnalysis};
use serde::{Deserialize, Serialize};

/// BLE payload schema version이다.
pub const PROTOCOL_VERSION: u8 = 5;

/// 측정 세션을 시작한 입력 출처다.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    /// 보드의 물리 버튼으로 측정이 시작됐다.
    BoardButton,
}

/// 측정 세션의 진행 상태다.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum State {
    /// 측정 세션이 열리지 않은 대기 상태다.
    Idle,
    /// 휴대폰에서 측정 context를 받는 상태다.
    Context,
    /// 센서 측정과 보정이 진행 중인 상태다.
    Measuring,
    /// 측정 결과가 만들어진 상태다.
    Done,
    /// 측정 흐름을 계속할 수 없는 오류 상태다.
    Error,
}

/// 최종 측정 결과의 위험 단계다.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Risk {
    /// 안전 범위로 판단된 결과다.
    Safe,
    /// 주의가 필요한 범위로 판단된 결과다.
    Caution,
    /// 위험 범위로 판단된 결과다.
    Danger,
}

/// 장치가 앱에 현재 runtime 상태를 알리는 DTO다.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Status {
    /// BLE payload schema version이다.
    pub v: u8,
    /// 현재 측정 흐름 상태다.
    pub state: State,
    /// 활성 측정 세션 ID다. 대기 상태에서는 없을 수 있다.
    pub session_id: Option<String>,
    /// 장치 배터리 잔량이다. 아직 측정하지 못하면 없다.
    pub battery_percent: Option<u8>,
}

/// 장치가 앱에 새 측정 세션 context를 요청하는 DTO다.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Session {
    /// BLE payload schema version이다.
    pub v: u8,
    /// 장치가 생성한 측정 세션 ID다.
    pub session_id: String,
    /// 측정 세션 시작 출처다.
    pub source: Source,
    /// 앱이 보내야 할 최근 측정 히스토리 최대 개수다.
    pub history_limit: u8,
    /// 앱 시간 동기화를 요청하는지 여부다.
    pub sync_time: bool,
}

/// 앱이 장치에 전달하는 최근 측정 히스토리 항목이다.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct History {
    /// 측정 시각을 Unix epoch ms로 표현한 값이다.
    pub measured_at_unix_ms: u64,
    /// 알코올 농도를 mg/L x1000 정수로 표현한 값이다.
    pub alcohol_mg_l_x1000: u16,
    /// 해당 히스토리 결과의 위험 단계다.
    pub risk: Risk,
    /// 해당 히스토리 결과의 신뢰도다.
    pub confidence_percent: u8,
}

/// 앱이 측정 전에 장치로 보내는 개인화 context다.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Context {
    /// BLE payload schema version이다.
    pub v: u8,
    /// context가 적용될 측정 세션 ID다.
    pub session_id: String,
    /// 앱 기준 현재 시각이다.
    pub phone_time_unix_ms: Option<u64>,
    /// 앱이 보유한 최근 측정 히스토리다.
    pub recent: Vec<History>,
    /// 사용자 baseline으로 판단되는 sober 알코올 농도다.
    pub sober_alcohol_mg_l_x1000: Option<u16>,
    /// 시간당 알코올 제거량 추정값이다.
    pub elimination_mg_l_per_hour_x1000: Option<u16>,
}

/// 장치가 앱에 측정 진행률을 알리는 DTO다.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Progress {
    /// BLE payload schema version이다.
    pub v: u8,
    /// 진행률이 적용될 측정 세션 ID다.
    pub session_id: String,
    /// 현재 측정 흐름 상태다.
    pub state: State,
    /// 진행률을 0-100 정수로 표현한 값이다.
    pub percent: u8,
}

/// BLE report에 포함되는 알코올 측정 요약이다.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Alcohol {
    /// 알코올 농도를 mg/L x1000 정수로 표현한 값이다.
    pub mg_l_x1000: u16,
}

impl From<AlcoholSample> for Alcohol {
    fn from(sample: AlcoholSample) -> Self {
        Self {
            mg_l_x1000: sample.concentration.mg_l_x1000,
        }
    }
}

/// BLE report에 포함되는 pulse 분석 요약이다.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Pulse {
    /// 분당 심박수다.
    pub bpm: f32,
    /// pulse 분석이 안정적으로 판단됐는지 여부다.
    pub stable: bool,
    /// pulse 분석 신뢰도다.
    pub confidence_percent: u8,
}

impl From<PulseAnalysis> for Pulse {
    fn from(analysis: PulseAnalysis) -> Self {
        Self {
            bpm: analysis.bpm,
            stable: analysis.stable,
            confidence_percent: analysis.confidence_percent,
        }
    }
}

/// 장치가 앱에 보내는 최종 측정 결과 DTO다.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Report {
    /// BLE payload schema version이다.
    pub v: u8,
    /// 결과가 속한 측정 세션 ID다.
    pub session_id: String,
    /// 측정 완료 시각을 Unix epoch ms로 표현한 값이다.
    pub measured_at_unix_ms: Option<u64>,
    /// 알코올 측정 요약이다.
    pub alcohol: Alcohol,
    /// pulse 분석 요약이다. pulse가 안정화되지 않았으면 없을 수 있다.
    pub pulse: Option<Pulse>,
    /// BAC 추정값을 milli-percent 단위로 표현한 값이다.
    pub bac_milli_percent: Option<u16>,
    /// sober 상태까지 남은 시간 추정값이다.
    pub sober_time_minutes: Option<u16>,
    /// 최종 위험 단계다.
    pub risk: Risk,
    /// 최종 결과 신뢰도다.
    pub confidence_percent: u8,
}

/// 앱에서 장치로 보내는 BLE command envelope이다.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "cmd")]
pub enum PhoneToDevice {
    /// 측정 세션에 사용할 앱 context다.
    Context(Context),
    /// 측정 세션 취소 요청이다.
    Cancel {
        /// 취소할 측정 세션 ID다.
        session_id: String,
    },
    /// 장치에 앱 시간을 전달한다.
    Time {
        /// 앱 기준 현재 시각이다.
        unix_time_ms: u64,
    },
    /// 장치 이벤트를 앱이 처리했음을 알린다.
    Ack {
        /// 처리 완료한 측정 세션 ID다.
        session_id: String,
    },
}

/// 장치에서 앱으로 보내는 BLE event envelope이다.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "event")]
pub enum DeviceToPhone {
    /// 현재 장치 상태 이벤트다.
    Status(Status),
    /// 새 측정 세션 context 요청 이벤트다.
    Session(Session),
    /// 측정 진행률 이벤트다.
    Progress(Progress),
    /// 최종 측정 결과 이벤트다.
    Result(Report),
}
