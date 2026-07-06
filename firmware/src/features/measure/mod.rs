use crate::devices;
use crate::devices::{AlcoholDevice, PulseDevice};
use crate::error::Result;
use embassy_futures::join::join;

mod alcohol;
mod pulse;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Measurement {
    alcohol_mg_l_x1000: u16,
    pulse_bpm: Option<u16>,
}

impl Measurement {
    fn new(alcohol_mg_l_x1000: u16, pulse: Option<devices::pulse::Analysis>) -> Self {
        Self {
            alcohol_mg_l_x1000,
            pulse_bpm: pulse
                .map(|analysis| analysis.bpm.round().clamp(0.0, u16::MAX as f32) as u16),
        }
    }

    pub const fn alcohol_mg_l_x1000(&self) -> u16 {
        self.alcohol_mg_l_x1000
    }

    pub const fn pulse_bpm(&self) -> Option<u16> {
        self.pulse_bpm
    }
}

pub async fn run(
    pulse: &mut PulseDevice<'static>,
    alcohol: &mut AlcoholDevice<'static>,
) -> Result<Measurement> {
    pulse.reset();

    let (pulse, alcohol) = join(pulse::read(pulse), alcohol::read(alcohol)).await;
    Ok(Measurement::new(alcohol?, pulse?))
}
