use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
pub struct Sample {
    pub elapsed_ms: u32,
    pub raw_12bit: u16,
    pub filtered: f32,
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
