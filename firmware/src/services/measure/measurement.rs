use crate::devices::pulse::PulseUnavailableReason;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Measurement {
    alcohol_mg_l_x1000: u16,
    pulse: PulseOutcome,
}

impl Measurement {
    pub fn new(alcohol_mg_l_x1000: u16, pulse: PulseOutcome) -> Self {
        Self {
            alcohol_mg_l_x1000,
            pulse,
        }
    }

    pub const fn alcohol_mg_l_x1000(&self) -> u16 {
        self.alcohol_mg_l_x1000
    }

    pub const fn pulse(&self) -> PulseOutcome {
        self.pulse
    }
}

/// pulse 측정의 최종 결과다. 실제 하드웨어 오류(ADC/타임스탬프 오류)가 아닌 이상
/// 항상 `Ok`로 귀결되며, 신호를 못 찾았거나 불안정했던 경우도 값으로 표현한다.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PulseOutcome {
    Measured { bpm: u16, stable: bool },
    Unavailable { reason: PulseUnavailableReason },
}
