pub use error::{Error, Result};
use esp_idf_svc::hal::adc::{
    attenuation::DB_12,
    oneshot::{config::AdcChannelConfig, AdcChannelDriver, AdcDriver},
    ADC1, ADCCH0, ADCU1,
};
use esp_idf_svc::hal::gpio::Gpio36;
use esp_idf_svc::sys::EspError;
pub use model::{Analysis, Diagnosis, PulseUnavailableReason};
use model::Sample;
use state::State;

mod algorithm;
mod error;
mod filter;
mod model;
mod params;
mod state;

/// 아날로그 PPG 센서와 pulse 분석 상태를 함께 소유하는 device handle이다.
///
/// ADC channel은 `devices::init()`에서 보드 배선에 맞게 구성해 전달한다.
/// 이 타입은 PPG raw sample 읽기와 분석 상태 갱신을 하나의 흐름으로 묶는다.
type PpgChannel<'d> = AdcChannelDriver<'d, ADCCH0<ADCU1>, AdcDriver<'d, ADCU1>>;

pub struct PulseDevice<'d> {
    channel: PpgChannel<'d>,
    state: State,
}

impl<'d> PulseDevice<'d> {
    /// 구성된 ADC channel로 pulse device handle을 만든다.
    pub fn new(adc: ADC1<'d>, pin: Gpio36<'d>) -> core::result::Result<Self, EspError> {
        let config = AdcChannelConfig {
            attenuation: DB_12,
            ..Default::default()
        };
        let adc = AdcDriver::new(adc)?;
        let channel = AdcChannelDriver::new(adc, pin, &config)?;

        Ok(Self {
            channel,
            state: State::default(),
        })
    }

    /// 새 측정 세션을 시작하기 전에 pulse 분석 상태를 초기화한다.
    pub fn reset(&mut self) {
        self.state.reset();
    }

    /// PPG ADC sample을 읽고 pulse 분석 상태에 반영한다.
    ///
    /// `elapsed_ms`는 현재 측정 세션 시작 이후 흐른 시간이다. 반환하는 `u16`은
    /// 이번에 읽은 raw 12bit ADC 값이다(BLE로 raw waveform을 스트리밍하는 데 쓰인다).
    /// 분석 주기가 되지 않았거나 안정적인 pulse가 아직 확인되지 않으면
    /// `Analysis`는 `None`이다.
    pub fn sample(&mut self, elapsed_ms: u32) -> Result<(u16, Option<Analysis>)> {
        let raw_12bit = self.read_ppg_sample()?;
        let analysis = self.push(elapsed_ms, raw_12bit)?;
        Ok((raw_12bit, analysis))
    }

    /// 타임아웃 등으로 안정적인 pulse를 찾지 못했을 때, 신호가 아예 없었는지
    /// 아니면 불안정했는지 구분하는 데 쓰인다.
    pub const fn any_peak_found(&self) -> bool {
        self.state.any_peak_found()
    }

    /// PPG raw sample만 읽어 분석 window에 넣는다 (interval 분석은 하지 않는다).
    /// 실시간 스트리밍 진단 모드에서 caller가 원하는 주기로 `diagnose()`를 호출하기
    /// 위한 저수준 경로다. 반환값은 이번에 읽은 raw 12bit ADC 값이다.
    pub fn sample_raw(&mut self, elapsed_ms: u32) -> Result<u16> {
        let raw_12bit = self.read_ppg_sample()?;
        self.push_sample(elapsed_ms, raw_12bit)?;
        Ok(raw_12bit)
    }

    /// 현재 window를 기준으로 즉석 진단(peak 수/BPM/안정도)을 계산한다.
    /// first_stable gate가 없어 확정 전이라도 관찰값을 그대로 돌려준다.
    pub fn diagnose(&self) -> Diagnosis {
        algorithm::diagnose(self.state.window())
    }

    fn push_sample(&mut self, elapsed_ms: u32, raw_12bit: u16) -> Result<()> {
        if let Some(previous) = self.state.window().back() {
            validate_timestamp(previous.elapsed_ms, elapsed_ms)?;
        }

        let filtered = self.state.filter(raw_12bit);
        self.state.push(Sample {
            elapsed_ms,
            raw_12bit,
            filtered,
        });

        Ok(())
    }

    fn push(&mut self, elapsed_ms: u32, raw_12bit: u16) -> Result<Option<Analysis>> {
        self.push_sample(elapsed_ms, raw_12bit)?;

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

    fn read_ppg_sample(&mut self) -> Result<u16> {
        let mut sum = 0_u32;

        for _ in 0..params::SAMPLE_AVERAGE_READS {
            sum += u32::from(self.channel.read_raw()?);
        }

        Ok((sum / params::SAMPLE_AVERAGE_READS) as u16)
    }
}

fn validate_timestamp(previous_ms: u32, current_ms: u32) -> Result<()> {
    let Some(actual_ms) = current_ms.checked_sub(previous_ms) else {
        return Err(Error::NonMonotonic {
            previous_ms,
            current_ms,
        });
    };

    // sample 주기가 흔들려도 BPM 정확도에는 큰 영향이 없어 오류로 보지 않는다. 다만 매
    // sample마다 serial로 warn을 찍으면 그 I/O가 오히려 sample 루프를 지연시켜 지터를
    // 키운다. 그래서 기본 로그 레벨에서는 출력되지 않는 trace로만 남긴다.
    let min_ms = params::SAMPLE_PERIOD_MS.saturating_sub(params::SAMPLE_PERIOD_TOLERANCE_MS);
    let max_ms = params::SAMPLE_PERIOD_MS.saturating_add(params::SAMPLE_PERIOD_TOLERANCE_MS);
    if actual_ms < min_ms || actual_ms > max_ms {
        log::trace!(
            "pulse sample cadence off: expected about {}ms, got {}ms",
            params::SAMPLE_PERIOD_MS,
            actual_ms
        );
    }

    Ok(())
}
