use core::future::Future;

use crate::devices::{AlcoholDevice, PulseDevice};
use crate::error::Result;
use embassy_futures::{
    join::join,
    select::{select, Either},
};
pub use measurement::Measurement;

mod measurement;
mod run;

pub struct MeasureService<'d> {
    pulse: PulseDevice<'d>,
    alcohol: AlcoholDevice<'d>,
}

pub enum MeasureRun {
    Completed(Measurement),
    Cancelled,
}

impl<'d> MeasureService<'d> {
    pub fn new(pulse: PulseDevice<'d>, alcohol: AlcoholDevice<'d>) -> Self {
        Self { pulse, alcohol }
    }

    pub async fn run(&mut self) -> Result<Measurement> {
        let pulse = &mut self.pulse;
        let alcohol = &mut self.alcohol;
        let (pulse, alcohol) = join(run::pulse(pulse), run::alcohol(alcohol)).await;
        let alcohol = alcohol?;
        let pulse = match pulse {
            Ok(pulse) => Some(pulse),
            Err(error) => {
                log::warn!(
                    "pulse measurement unavailable, continuing with alcohol result: {error}"
                );
                None
            }
        };

        Ok(Measurement::new(alcohol, pulse))
    }

    pub async fn run_until_cancelled(
        &mut self,
        cancel: impl Future<Output = ()>,
    ) -> Result<MeasureRun> {
        match select(self.run(), cancel).await {
            Either::First(result) => result.map(MeasureRun::Completed),
            Either::Second(()) => {
                self.alcohol.stop().await?;
                Ok(MeasureRun::Cancelled)
            }
        }
    }
}
