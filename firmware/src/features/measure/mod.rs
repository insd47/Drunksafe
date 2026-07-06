use crate::devices;
use crate::devices::{AlcoholDevice, PulseDevice};
use crate::error::Result;
use embassy_futures::join::join;

mod alcohol;
mod pulse;

pub async fn run(
    pulse: &mut PulseDevice<'static>,
    alcohol: &mut AlcoholDevice<'static>,
) -> Result<(Option<devices::pulse::Analysis>, u16)> {
    pulse.reset();

    let (pulse, alcohol) = join(pulse::read(pulse), alcohol::read(alcohol)).await;
    Ok((pulse?, alcohol?))
}
