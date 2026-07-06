use crate::devices::{AlcoholDevice, PulseDevice};
use crate::error::Result;
use embassy_futures::join::join;
pub use measurement::Measurement;

mod measurement;
mod run;

pub struct MeasureService<'d> {
    pulse: PulseDevice<'d>,
    alcohol: AlcoholDevice<'d>,
}

impl<'d> MeasureService<'d> {
    pub fn new(pulse: PulseDevice<'d>, alcohol: AlcoholDevice<'d>) -> Self {
        Self { pulse, alcohol }
    }

    pub async fn run(&mut self) -> Result<Measurement> {
        let pulse = &mut self.pulse;
        let alcohol = &mut self.alcohol;
        let (pulse, alcohol) = join(run::pulse(pulse), run::alcohol(alcohol)).await;

        Ok(Measurement::new(alcohol?, pulse?))
    }
}
