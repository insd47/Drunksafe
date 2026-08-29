pub use algorithm::{ClosedSlot, Diagnosis};
pub use error::{Error, Result};
use esp_idf_svc::hal::adc::{
    attenuation::DB_12,
    oneshot::{config::AdcChannelConfig, AdcChannelDriver, AdcDriver},
    ADC1, ADCCH0, ADCU1,
};
use esp_idf_svc::hal::gpio::Gpio36;
use esp_idf_svc::sys::EspError;
pub use model::PulseUnavailableReason;

mod algorithm;
mod error;
mod filter;
mod model;
mod params;

type PpgChannel<'d> = AdcChannelDriver<'d, ADCCH0<ADCU1>, AdcDriver<'d, ADCU1>>;

/// One estimator, shared by baseline, normal, developer and session measurement.
pub struct PulseDevice<'d> {
    channel: PpgChannel<'d>,
    engine: algorithm::PulseEngine,
    previous_ms: Option<u32>,
}

impl<'d> PulseDevice<'d> {
    pub fn new(adc: ADC1<'d>, pin: Gpio36<'d>) -> core::result::Result<Self, EspError> {
        let config = AdcChannelConfig {
            attenuation: DB_12,
            ..Default::default()
        };
        let adc = AdcDriver::new(adc)?;
        Ok(Self {
            channel: AdcChannelDriver::new(adc, pin, &config)?,
            engine: algorithm::PulseEngine::default(),
            previous_ms: None,
        })
    }

    pub fn reset(&mut self) {
        self.engine = algorithm::PulseEngine::default();
        self.previous_ms = None;
    }

    pub fn sample_raw(&mut self, elapsed_ms: u32) -> Result<u16> {
        if let Some(previous_ms) = self.previous_ms {
            if elapsed_ms < previous_ms {
                return Err(Error::NonMonotonic {
                    previous_ms,
                    current_ms: elapsed_ms,
                });
            }
        }
        let mut sum = 0_u32;
        for _ in 0..params::SAMPLE_AVERAGE_READS {
            sum += u32::from(self.channel.read_raw()?);
        }
        let raw = (sum / params::SAMPLE_AVERAGE_READS) as u16;
        self.engine.push(elapsed_ms, raw);
        self.previous_ms = Some(elapsed_ms);
        Ok(raw)
    }

    pub fn diagnose(&self) -> Diagnosis {
        self.engine.diagnose()
    }
    pub fn take_closed_slot(&mut self) -> Option<ClosedSlot> {
        self.engine.take_closed_slot()
    }
}
