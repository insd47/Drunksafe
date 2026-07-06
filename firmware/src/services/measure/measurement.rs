#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Measurement {
    alcohol_mg_l_x1000: u16,
    pulse_bpm: u16,
}

impl Measurement {
    pub fn new(alcohol_mg_l_x1000: u16, pulse_bpm: u16) -> Self {
        Self {
            alcohol_mg_l_x1000,
            pulse_bpm,
        }
    }

    pub const fn alcohol_mg_l_x1000(&self) -> u16 {
        self.alcohol_mg_l_x1000
    }

    pub const fn pulse_bpm(&self) -> u16 {
        self.pulse_bpm
    }
}
