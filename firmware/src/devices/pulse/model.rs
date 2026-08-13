use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
pub struct Sample {
    pub elapsed_ms: u32,
    pub raw_12bit: u16,
    pub filtered: f32,
}

/// pulse 측정이 `first_stable_found` 없이 타임아웃됐을 때 왜 실패했는지 나타낸다.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PulseUnavailableReason {
    /// bandpass 필터링된 신호가 `PEAK_THRESHOLD`를 한 번도 넘지 못했다 — 신호가 없거나
    /// 매우 약함 (센서 접촉 불량 가능성).
    NoSignal,
    /// peak는 감지됐지만 IBI가 허용 범위 안에서 안정되지 못했다 — 노이즈나 움직임.
    Unstable,
}

/// 실시간 스트리밍 진단용 즉석 분석 값이다. `Analysis`와 달리 `first_stable` gate가
/// 없어서, 아직 안정적으로 확정되지 않은 상태의 BPM/peak 수도 그대로 보고한다.
/// 개발자 도구에서 "왜 BPM이 안 잡히는가"를 실시간으로 관찰하는 용도다.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Diagnosis {
    /// window에서 계산한 분당 심박수다. peak가 2개 미만이면 0.0이다.
    pub bpm: f32,
    /// IBI(inter-beat interval) 표준편차를 ms 단위로 표현한 값이다.
    pub ibi_stddev_ms: f32,
    /// 현재 window에서 threshold를 넘어 유지된 peak 개수다.
    pub peak_count: u16,
    /// IBI 변동성이 허용 범위 안에 들어 안정적이라고 판단됐는지 여부다.
    pub stable: bool,
}

/// pulse window에서 계산한 분석 결과다.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
pub struct Analysis {
    /// 분당 심박수다.
    pub bpm: f32,
    /// IBI(inter-beat interval) 표준편차를 ms 단위로 표현한 값이다.
    pub ibi_stddev_ms: f32,
    /// 분석 window에서 유지된 peak들의 평균 amplitude다.
    pub peak_amplitude: f32,
    /// IBI 변동성이 허용 범위 안에 있어 안정적이라고 판단됐는지 여부다.
    pub stable: bool,
    /// 분석 결과 신뢰도를 0-100 정수로 표현한 값이다.
    pub confidence_percent: u8,
}
