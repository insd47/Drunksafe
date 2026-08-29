use crate::devices::alcohol::Status;
use crate::devices::pulse::{Diagnosis, PulseUnavailableReason};
use crate::devices::{AlcoholDevice, BuzzerDevice, PulseDevice};
use crate::error::{Result, TimeoutKind};
use crate::services::measure::PulseOutcome;
use embassy_time::{Duration, Instant, Timer};

const PULSE_SAMPLE: Duration = Duration::from_millis(10);
const PULSE_MAX_SCHEDULE_LAG: Duration = Duration::from_millis(100);
const ALCOHOL_POLL: Duration = Duration::from_millis(200);
const ALCOHOL_RESULT_TIMEOUT: Duration = Duration::from_secs(30);
/// 이만큼 연속으로 status read가 실패하면 통신 오류로 보고 측정을 실패 처리한다.
const MAX_STATUS_ERRORS: u8 = 5;

/// pulse 측정 단계(2단계)의 타임아웃이다.
pub const PULSE_PHASE_TIMEOUT: Duration = Duration::from_secs(60);

/// 스트리밍 진단에서 필터가 자리 잡을 때까지 첫 reading을 미루는 warmup 시간이다.
const PULSE_STREAM_WARMUP_MS: u32 = 2000;
/// 스트리밍 진단에서 diagnosis reading을 내보내는 주기다.
const PULSE_STREAM_READING_INTERVAL_MS: u32 = 1000;
/// Developer stream serial diagnostics are deliberately much slower than the
/// BLE/raw sample stream so logging cannot become part of the 100 Hz loop load.
const PULSE_STREAM_LOG_INTERVAL_MS: u32 = 5000;
const PULSE_MEASUREMENT_DIAG_INTERVAL_MS: u32 = 500;
const PULSE_MEASUREMENT_REPORT_INTERVAL_MS: u32 = 5000;

/// pulse를 측정한다. 안정적인 pulse를 `timeout` 안에 못 찾아도 하드웨어 오류가 아닌 이상
/// `Err`가 아니라 `PulseOutcome::Unavailable`로 귀결된다 — 호출부가 이유를 앱에
/// 전달할 수 있도록 하기 위함이다. `on_sample`은 매 raw ADC 샘플마다 호출된다.
pub async fn pulse(
    device: &mut PulseDevice<'_>,
    timeout: Duration,
    mut on_sample: impl FnMut(u32, u16),
    mut on_reading: impl FnMut(u32, Diagnosis),
) -> Result<PulseOutcome> {
    device.reset();
    let started = Instant::now();
    let mut last_reading_ms = u32::MAX;
    let mut last_emitted_ms = u32::MAX;
    let mut last_reported_phase: Option<&'static str> = None;
    let mut last_reported_failure: Option<&'static str> = None;
    let mut any_peak_found = false;
    let mut next_sample = Instant::now();
    let mut sample_count = 0_u32;

    loop {
        let elapsed_ms = started.elapsed().as_millis().min(u64::from(u32::MAX)) as u32;

        let raw = device.sample_raw(elapsed_ms)?;
        sample_count = sample_count.saturating_add(1);
        on_sample(elapsed_ms, raw);

        // Same estimator/report cadence as the developer stream, but only a
        // stable reading can become a saved measurement or resting baseline.
        if last_reading_ms == u32::MAX
            || elapsed_ms.saturating_sub(last_reading_ms) >= PULSE_MEASUREMENT_DIAG_INTERVAL_MS
        {
            last_reading_ms = elapsed_ms;
            let diagnosis = device.diagnose();
            any_peak_found |= diagnosis.peak_count > 0;
            let stable_bpm = diagnosis.stable.then_some(diagnosis.bpm);
            let acquiring = matches!(diagnosis.phase, "warmup" | "collecting");
            let entered_acquisition =
                acquiring && !matches!(last_reported_phase, Some("warmup" | "collecting"));
            let state_changed = last_reported_phase != Some(diagnosis.phase)
                || last_reported_failure != diagnosis.last_failure;
            let report_due = last_emitted_ms == u32::MAX
                || elapsed_ms.saturating_sub(last_emitted_ms)
                    >= PULSE_MEASUREMENT_REPORT_INTERVAL_MS;
            if state_changed || entered_acquisition || report_due {
                on_reading(elapsed_ms, diagnosis);
                last_emitted_ms = elapsed_ms;
                last_reported_phase = Some(diagnosis.phase);
                last_reported_failure = diagnosis.last_failure;
            }
            if let Some(bpm) = stable_bpm {
                if last_reported_phase != Some(diagnosis.phase) {
                    on_reading(elapsed_ms, diagnosis);
                }
                log::info!(
                    "pulse accepted: bpm={:.1}, intervals={}, ibi_stddev_ms={:.1}, sample_hz={:.1}",
                    diagnosis.bpm,
                    diagnosis.accepted_intervals,
                    diagnosis.ibi_stddev_ms,
                    sample_count as f32 * 1000.0 / elapsed_ms.max(1) as f32
                );
                return Ok(PulseOutcome::Measured {
                    bpm: bpm.round().clamp(0.0, u16::MAX as f32) as u16,
                    stable: true,
                });
            }
        }

        if started.elapsed() >= timeout {
            let reason = if any_peak_found {
                PulseUnavailableReason::Unstable
            } else {
                PulseUnavailableReason::NoSignal
            };
            let diagnosis = device.diagnose();
            log::warn!(
                "pulse unavailable: reason={reason:?}, phase={}, intervals={}, last_failure={:?}, sample_hz={:.1}",
                diagnosis.phase,
                diagnosis.accepted_intervals,
                diagnosis.last_failure,
                sample_count as f32 * 1000.0 / elapsed_ms.max(1) as f32
            );
            return Ok(PulseOutcome::Unavailable { reason });
        }

        wait_for_sample_deadline(&mut next_sample).await;
    }
}

/// pulse만 연속으로 측정하며 raw sample과 즉석 진단을 스트리밍한다 (알코올 미포함).
/// 스스로 끝나지 않고 caller의 cancel(정지 명령/연결 해제)로만 종료된다.
/// `on_sample`은 매 raw sample마다, `on_reading`은 warmup 후 주기마다 호출된다.
pub async fn pulse_stream(
    device: &mut PulseDevice<'_>,
    mut on_sample: impl FnMut(u32, u16),
    mut on_reading: impl FnMut(u32, Diagnosis),
) -> Result<()> {
    device.reset();
    let started = Instant::now();
    let mut last_reading_ms: u32 = 0;
    let mut last_log_ms: u32 = 0;
    let mut next_sample = Instant::now();
    let mut sample_count = 0_u32;

    loop {
        let elapsed_ms = started.elapsed().as_millis().min(u64::from(u32::MAX)) as u32;

        let raw = device.sample_raw(elapsed_ms)?;
        sample_count = sample_count.saturating_add(1);
        on_sample(elapsed_ms, raw);

        if elapsed_ms >= PULSE_STREAM_WARMUP_MS
            && elapsed_ms.saturating_sub(last_reading_ms) >= PULSE_STREAM_READING_INTERVAL_MS
        {
            last_reading_ms = elapsed_ms;
            let diagnosis = device.diagnose();
            on_reading(elapsed_ms, diagnosis);
            if elapsed_ms.saturating_sub(last_log_ms) >= PULSE_STREAM_LOG_INTERVAL_MS {
                last_log_ms = elapsed_ms;
                log::info!(
                    "[PULSE_STREAM] phase={}, bpm={:.1}, stable={}, peaks={}, intervals={}, ibi_stddev_ms={:.1}, contact={:?}, reason={:?}, last_failure={:?}, sample_hz={:.1}",
                    diagnosis.phase,
                    diagnosis.bpm,
                    diagnosis.stable,
                    diagnosis.peak_count,
                    diagnosis.accepted_intervals,
                    diagnosis.ibi_stddev_ms,
                    diagnosis.contact_good,
                    diagnosis.reason,
                    diagnosis.last_failure,
                    sample_count as f32 * 1000.0 / elapsed_ms.max(1) as f32,
                );
            }
        }

        wait_for_sample_deadline(&mut next_sample).await;
    }
}

/// 세션 중 HR 1건을 추정하기 위해 pulse를 `duration`만큼 샘플링하고 즉석 진단을 반환한다.
pub async fn hr_burst(device: &mut PulseDevice<'_>, duration: Duration) -> Result<Diagnosis> {
    device.reset();
    let started = Instant::now();
    let mut next_sample = Instant::now();

    loop {
        let elapsed_ms = started.elapsed().as_millis().min(u64::from(u32::MAX)) as u32;
        device.sample_raw(elapsed_ms)?;

        if started.elapsed() >= duration {
            return Ok(device.diagnose());
        }

        wait_for_sample_deadline(&mut next_sample).await;
    }
}

/// Match the Arduino sketch's `next += 10 ms` scheduler. Processing time does
/// not get added to every sample period; only a lag over 100 ms resets cadence.
async fn wait_for_sample_deadline(next: &mut Instant) {
    *next += PULSE_SAMPLE;
    let now = Instant::now();
    if now > *next && now - *next > PULSE_MAX_SCHEDULE_LAG {
        *next = now + PULSE_SAMPLE;
    }
    Timer::at(*next).await;
}

/// 알코올을 측정한다. `on_state`는 ZE29A 상태가 바뀔 때마다 호출돼(예: Preheating→
/// WaitBlow) 앱이 "지금 부세요" 타이밍을 안내할 수 있게 한다.
pub async fn alcohol(
    device: &mut AlcoholDevice<'_>,
    buzzer: &mut BuzzerDevice,
    on_state: impl FnMut(Status),
) -> Result<u16> {
    device.start().await?;
    let result = alcohol_result(device, buzzer, on_state).await;

    if let Err(error) = device.stop().await {
        log::warn!("failed to stop alcohol sensor work mode after measurement: {error}");
    }

    result
}

async fn alcohol_result(
    device: &mut AlcoholDevice<'_>,
    buzzer: &mut BuzzerDevice,
    mut on_state: impl FnMut(Status),
) -> Result<u16> {
    let started = Instant::now();
    let mut last_status: Option<Status> = None;
    let mut reached_wait_blow = false;
    let mut consecutive_errors: u8 = 0;

    loop {
        // 산발적인 status read 실패로 측정 전체가 죽지 않도록 몇 번은 재시도한다.
        let status = match device.status().await {
            Ok(status) => {
                consecutive_errors = 0;
                status
            }
            Err(error) => {
                consecutive_errors += 1;
                log::warn!("[ALCOHOL] status read failed ({consecutive_errors}): {error}");

                if consecutive_errors >= MAX_STATUS_ERRORS {
                    return Err(error.into());
                }
                if started.elapsed() >= ALCOHOL_RESULT_TIMEOUT {
                    return Err(TimeoutKind::AlcoholResult.into());
                }

                Timer::after(ALCOHOL_POLL).await;
                continue;
            }
        };

        // 매 측정마다 상태 전환을 로그로 남기고 앱에도 알린다: Idle→Preheating→WaitBlow
        // →Blowing→Calculating→ReadResult 순서를 실제로 거치는지 확인할 수 있다.
        if last_status != Some(status) {
            log::info!("[ALCOHOL] status: {status:?}");
            on_state(status);
            if status == Status::WaitBlow {
                reached_wait_blow = true;
                // 상태 전환 때만 실행되므로 WaitBlow를 반복 조회해도 한 번만 울린다.
                if let Err(error) = buzzer.beep_pattern(2, 120, 120) {
                    log::warn!("failed to signal WaitBlow with buzzer: {error}");
                }
            }
            last_status = Some(status);
        }

        match status {
            Status::ReadResult => return Ok(device.test().await?),
            // WaitBlow까지 갔다가 다시 Idle로 돌아왔다면 센서가 입김을 유효한 것으로
            // 인정하지 못한 것이다(너무 약하거나 짧음, 또는 WaitBlow 창을 놓침). 30초를
            // 기다리지 않고 바로 실패로 끝내 사용자가 즉시 다시 시도하게 한다.
            Status::Idle if reached_wait_blow => {
                log::warn!("[ALCOHOL] returned to Idle after WaitBlow — blow not accepted");
                return Err(TimeoutKind::AlcoholResult.into());
            }
            _ => {}
        }

        if started.elapsed() >= ALCOHOL_RESULT_TIMEOUT {
            log::warn!("[ALCOHOL] result timeout, last status: {last_status:?}");
            return Err(TimeoutKind::AlcoholResult.into());
        }

        Timer::after(ALCOHOL_POLL).await;
    }
}
