use super::model::{Analysis, Sample};
use super::state::State;
use super::{algorithm, params, Error, Result};
use esp_idf_svc::hal::delay::TickType;
use esp_idf_svc::hal::i2c::I2cDriver;

pub struct Device<'d> {
    bus: I2cDriver<'d>,
    state: State,
}

impl<'d> Device<'d> {
    pub fn new(bus: I2cDriver<'d>) -> Self {
        Self {
            bus,
            state: State::default(),
        }
    }

    pub fn reset(&mut self) {
        self.state.reset();
    }

    #[allow(dead_code)]
    pub fn sample(&mut self, elapsed_ms: u32) -> Result<Option<Analysis>> {
        let raw_12bit = self.read_ir_sample()?;
        self.push(elapsed_ms, raw_12bit)
    }

    #[allow(dead_code)]
    pub fn analyze(&self) -> Option<Analysis> {
        self.state.last_analysis()
    }

    fn push(&mut self, elapsed_ms: u32, raw_12bit: u16) -> Result<Option<Analysis>> {
        if let Some(previous) = self.state.window().back() {
            validate_timestamp(previous.elapsed_ms, elapsed_ms)?;
        }

        let filtered = self.state.filter(raw_12bit);
        self.state.push(Sample {
            elapsed_ms,
            raw_12bit,
            filtered,
        });

        if self.state.total_samples() < params::START_DELAY_SAMPLES {
            return Ok(None);
        }

        if self.state.total_samples() == params::START_DELAY_SAMPLES {
            self.state.mark_analyzed();
            return Ok(None);
        }

        if self.state.samples_since_analysis() < params::ANALYSIS_INTERVAL_SAMPLES {
            return Ok(None);
        }

        self.state.mark_analyzed();
        Ok(algorithm::calculate(&mut self.state))
    }

    fn read_ir_sample(&mut self) -> Result<u16> {
        let mut bytes = [0; 6];
        let timeout = TickType::from(params::READ_TIMEOUT).ticks();
        self.bus.write_read(
            params::MAX30102_ADDRESS,
            &[params::FIFO_DATA],
            &mut bytes,
            timeout,
        )?;

        let ir = u32::from_be_bytes([0, bytes[3], bytes[4], bytes[5]]) & 0x03_ffff;
        Ok((ir >> 2) as u16)
    }
}

fn validate_timestamp(previous_ms: u32, current_ms: u32) -> Result<()> {
    let Some(actual_ms) = current_ms.checked_sub(previous_ms) else {
        return Err(Error::NonMonotonic {
            previous_ms,
            current_ms,
        });
    };

    let min_ms = params::SAMPLE_PERIOD_MS.saturating_sub(params::SAMPLE_PERIOD_TOLERANCE_MS);
    let max_ms = params::SAMPLE_PERIOD_MS.saturating_add(params::SAMPLE_PERIOD_TOLERANCE_MS);
    if actual_ms < min_ms || actual_ms > max_ms {
        log::warn!(
            "unexpected pulse sample cadence: expected about {}ms, got {}ms",
            params::SAMPLE_PERIOD_MS,
            actual_ms
        );
    }

    Ok(())
}
