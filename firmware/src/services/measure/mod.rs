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

    pub async fn run<F, P>(&mut self, on_alcohol_status: F, on_pulse_signal: P) -> Result<Measurement>
    where
        F: FnMut(crate::devices::alcohol::Status),
        P: FnMut(u8),
    {
        let alcohol_res = run::alcohol(&mut self.alcohol, on_alcohol_status).await?;
        
        let pulse_res = match run::pulse(&mut self.pulse, on_pulse_signal).await {
            Ok(bpm) => Some(bpm),
            Err(error) => {
                log::warn!(
                    "pulse measurement unavailable, continuing with alcohol result: {error}"
                );
                None
            }
        };

        Ok(Measurement::new(alcohol_res, pulse_res))
    }

    pub async fn run_until_cancelled<F, P>(
        &mut self,
        cancel: impl Future<Output = ()>,
        on_alcohol_status: F,
        on_pulse_signal: P,
    ) -> Result<MeasureRun>
    where
        F: FnMut(crate::devices::alcohol::Status),
        P: FnMut(u8),
    {
        match select(self.run(on_alcohol_status, on_pulse_signal), cancel).await {
            Either::First(result) => result.map(MeasureRun::Completed),
            Either::Second(()) => {
                self.alcohol.stop_work().await?;
                Ok(MeasureRun::Cancelled)
            }
        }
    }
}
