use crate::devices::alcohol::Status;
use crate::devices::{AlcoholDevice, PulseDevice};
use crate::error::{Result, TimeoutKind};
use embassy_time::{Duration, Instant, Timer};

const PULSE_SAMPLE: Duration = Duration::from_millis(10);
const ALCOHOL_POLL: Duration = Duration::from_millis(200);
const TIMEOUT: Duration = Duration::from_secs(30);

pub async fn pulse<F>(device: &mut PulseDevice<'_>, mut on_signal: F) -> Result<u16>
where
    F: FnMut(u8),
{
    device.reset();
    let started = Instant::now();
    let mut last_percent = 0_u8;

    loop {
        let elapsed_ms = started.elapsed().as_millis().min(u64::from(u32::MAX)) as u32;

        if let Some(analysis) = device.sample(elapsed_ms)? {
            let signal_percent = analysis.confidence_percent;
            if (signal_percent as i16 - last_percent as i16).abs() >= 5 {
                on_signal(signal_percent);
                last_percent = signal_percent;
            }
            let pulse_bpm = analysis.bpm.round().clamp(0.0, u16::MAX as f32) as u16;
            return Ok(pulse_bpm);
        }

        let signal_percent = device.analyze().map_or(15, |a| a.confidence_percent);
        if (signal_percent as i16 - last_percent as i16).abs() >= 5 {
            on_signal(signal_percent);
            last_percent = signal_percent;
        }

        if started.elapsed() >= TIMEOUT {
            return Err(TimeoutKind::PulseMeasurement.into());
        }

        Timer::after(PULSE_SAMPLE).await;
    }
}

pub async fn alcohol<F>(device: &mut AlcoholDevice<'_>, mut on_progress: F) -> Result<u16>
where
    F: FnMut(Status),
{
    log::info!("[ZE29A] sending work(true) command to sensor...");
    if let Err(error) = device.work(true).await {
        log::error!("[ZE29A] failed to send work(true) command: {error}");
    }
    let result = alcohol_result(device, &mut on_progress).await;

    if let Err(error) = device.stop_work().await {
        log::warn!("failed to stop alcohol sensor work mode after measurement: {error}");
    }

    result
}

async fn alcohol_result<F>(device: &mut AlcoholDevice<'_>, on_progress: &mut F) -> Result<u16>
where
    F: FnMut(Status),
{
    let started = Instant::now();
    let mut last_status: Option<Status> = None;
    let mut idle_retries = 0_u8;

    loop {
        match device.status().await {
            Ok(current_status) => {
                if last_status != Some(current_status) {
                    log::info!("[ZE29A Status Change] status={:?}", current_status);
                    on_progress(current_status);
                    last_status = Some(current_status);
                }

                if current_status == Status::Idle && started.elapsed() >= Duration::from_secs(2) && idle_retries < 3 {
                    idle_retries += 1;
                    log::warn!("[ZE29A] still in Idle status after 2s, retrying work(true)... (attempt {idle_retries})");
                    let _ = device.work(true).await;
                }

                if current_status == Status::ReadResult {
                    let result = device.test().await?;
                    log::info!("[ZE29A Measurement Result] alcohol_mg_l={result}");
                    return Ok(result);
                }
            }
            Err(error) => {
                log::warn!("[ZE29A Status Error] failed to query status: {error}");
            }
        }

        if started.elapsed() >= TIMEOUT {
            log::error!("[ZE29A Timeout] alcohol result wait timed out after 30s");
            return Err(TimeoutKind::AlcoholResult.into());
        }

        Timer::after(ALCOHOL_POLL).await;
    }
}
