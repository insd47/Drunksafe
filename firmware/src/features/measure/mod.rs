use crate::devices::{AlcoholDevice, PulseAnalysis, PulseDevice};
use embassy_futures::join::join;
pub use error::{Error, Result};

mod alcohol;
mod error;
mod pulse;

pub async fn run(
    pulse: &mut PulseDevice<'static>,
    alcohol: &mut AlcoholDevice<'static>,
) -> Result<(Option<PulseAnalysis>, u16)> {
    pulse.reset();

    let (pulse, alcohol) = join(pulse::read(pulse), alcohol::read(alcohol)).await;
    Ok((pulse?, alcohol?))
}
