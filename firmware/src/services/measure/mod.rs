use core::future::Future;

use crate::devices::alcohol::Status;
use crate::devices::pulse::Diagnosis;
use crate::devices::{AlcoholDevice, PulseDevice};
use crate::error::Result;
use embassy_futures::select::{select, Either};
pub use measurement::{Measurement, PulseOutcome};

mod measurement;
mod run;

pub struct MeasureService<'d> {
    pulse: PulseDevice<'d>,
    alcohol: AlcoholDevice<'d>,
}

/// 한 측정 단계(알코올 또는 pulse)의 종료 사유다.
pub enum PhaseRun<T> {
    Completed(T),
    Cancelled,
}

impl<'d> MeasureService<'d> {
    pub fn new(pulse: PulseDevice<'d>, alcohol: AlcoholDevice<'d>) -> Self {
        Self { pulse, alcohol }
    }

    /// 1단계: 알코올만 측정한다 (pulse 센서는 착용만 하고 측정하지 않는다). 30초 안에
    /// 결과가 없으면 타임아웃 `Err`로 끝나 호출부가 실패 화면으로 넘어간다.
    pub async fn run_alcohol_until_cancelled(
        &mut self,
        cancel: impl Future<Output = ()>,
        on_state: impl FnMut(Status),
    ) -> Result<PhaseRun<u16>> {
        match select(run::alcohol(&mut self.alcohol, on_state), cancel).await {
            Either::First(result) => result.map(PhaseRun::Completed),
            Either::Second(()) => {
                self.alcohol.stop().await?;
                Ok(PhaseRun::Cancelled)
            }
        }
    }

    /// 2단계: pulse만 측정한다 (1분 타임아웃). 안정적인 pulse를 못 찾아도 하드웨어 오류가
    /// 아닌 이상 `PulseOutcome::Unavailable`로 귀결돼 알코올 결과와 함께 표시할 수 있다.
    pub async fn run_pulse_until_cancelled(
        &mut self,
        cancel: impl Future<Output = ()>,
    ) -> Result<PhaseRun<PulseOutcome>> {
        match select(
            run::pulse(&mut self.pulse, run::PULSE_PHASE_TIMEOUT, |_elapsed_ms, _raw| {}),
            cancel,
        )
        .await
        {
            Either::First(result) => result.map(PhaseRun::Completed),
            Either::Second(()) => Ok(PhaseRun::Cancelled),
        }
    }

    /// 세션 중 HR 1건을 추정한다 (pulse를 `duration`만큼 샘플링 후 즉석 진단).
    pub async fn sample_hr(&mut self, duration: embassy_time::Duration) -> Result<Diagnosis> {
        run::hr_burst(&mut self.pulse, duration).await
    }

    /// 세션 중 알코올 1건을 측정한다 (30초 타임아웃). 상태 알림은 필요 없어 무시한다.
    pub async fn measure_alcohol(&mut self) -> Result<u16> {
        run::alcohol(&mut self.alcohol, |_status| {}).await
    }

    /// 알코올을 빼고 pulse만 연속 스트리밍한다 (개발자 도구 실시간 진단용).
    /// `cancel`(정지 명령/연결 해제)로만 끝난다.
    pub async fn run_pulse_stream(
        &mut self,
        cancel: impl Future<Output = ()>,
        on_ppg_sample: impl FnMut(u32, u16),
        on_reading: impl FnMut(u32, Diagnosis),
    ) -> Result<()> {
        match select(
            run::pulse_stream(&mut self.pulse, on_ppg_sample, on_reading),
            cancel,
        )
        .await
        {
            Either::First(result) => result,
            Either::Second(()) => Ok(()),
        }
    }
}
