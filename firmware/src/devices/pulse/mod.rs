use esp_idf_svc::hal::delay::TickType;
use esp_idf_svc::hal::i2c::I2cDriver;
use model::Sample;
use state::State;

pub use error::{Error, Result};
pub use model::Analysis;

mod algorithm;
mod error;
mod filter;
mod model;
mod params;
mod state;

/// MAX30102 pulse 센서와 pulse 분석 상태를 함께 소유하는 device handle이다.
///
/// I2C driver는 `devices::init()`에서 보드 배선에 맞게 구성해 전달한다.
/// 이 타입은 FIFO sample 읽기와 분석 상태 갱신을 하나의 흐름으로 묶는다.
pub struct PulseDevice<'d> {
    bus: I2cDriver<'d>,
    state: State,
}

impl<'d> PulseDevice<'d> {
    /// 구성된 I2C driver로 pulse device handle을 만든다.
    pub fn new(bus: I2cDriver<'d>) -> Self {
        Self {
            bus,
            state: State::default(),
        }
    }

    /// 새 측정 세션을 시작하기 전에 pulse 분석 상태를 초기화한다.
    pub fn reset(&mut self) {
        self.state.reset();
    }

    /// MAX30102 FIFO에서 sample을 읽고 pulse 분석 상태에 반영한다.
    ///
    /// `elapsed_ms`는 현재 측정 세션 시작 이후 흐른 시간이다. 분석 주기가
    /// 되지 않았거나 안정적인 pulse가 아직 확인되지 않으면 `Ok(None)`을
    /// 반환한다.
    #[allow(dead_code)]
    pub fn sample(&mut self, elapsed_ms: u32) -> Result<Option<Analysis>> {
        let raw_12bit = self.read_ir_sample()?;
        self.push(elapsed_ms, raw_12bit)
    }

    /// 마지막으로 계산된 pulse 분석 결과를 반환한다.
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
