#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Measurement {
    alcohol_mg_l_x1000: u16,
    pulse: Option<PulseMeasurement>,
}

impl Measurement {
    pub fn new(alcohol_mg_l_x1000: u16, pulse: Option<PulseMeasurement>) -> Self {
        Self {
            alcohol_mg_l_x1000,
            pulse,
        }
    }

    pub const fn alcohol_mg_l_x1000(&self) -> u16 {
        self.alcohol_mg_l_x1000
    }

    pub const fn pulse(&self) -> Option<PulseMeasurement> {
        self.pulse
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PulseMeasurement {
    bpm: u16,
    stable: bool,
}

impl PulseMeasurement {
    pub const fn new(bpm: u16, stable: bool) -> Self {
        Self { bpm, stable }
    }

    pub const fn bpm(self) -> u16 {
        self.bpm
    }

    pub const fn stable(self) -> bool {
        self.stable
    }
}
