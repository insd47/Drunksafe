use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
pub struct Sample {
    pub elapsed_ms: u32,
    pub raw_12bit: u16,
    pub filtered: f32,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
pub struct Analysis {
    pub bpm: f32,
    pub ibi_stddev_ms: f32,
    pub peak_amplitude: f32,
    pub stable: bool,
    pub confidence_percent: u8,
    pub trend_20s: Trend,
    pub trend_1m: Trend,
    pub trend_5m: Trend,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct Trend {
    pub bpm: Option<f32>,
    pub delta: Option<f32>,
}
