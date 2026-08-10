use crate::devices::alcohol::Status;
use crate::devices::{AlcoholDevice, PulseDevice};
use crate::error::{Result, TimeoutKind};
use crate::services::measure::PulseMeasurement;
use embassy_time::{Duration, Instant, Timer};

const PULSE_SAMPLE: Duration = Duration::from_millis(10);
const ALCOHOL_POLL: Duration = Duration::from_millis(200);
const PULSE_TIMEOUT: Duration = Duration::from_secs(30);
const ALCOHOL_RESULT_TIMEOUT: Duration = Duration::from_secs(30);

pub async fn pulse(device: &mut PulseDevice<'_>) -> Result<PulseMeasurement> {
    device.reset();
    let started = Instant::now();

    loop {
        let elapsed_ms = started.elapsed().as_millis().min(u64::from(u32::MAX)) as u32;

        if let Some(analysis) = device.sample(elapsed_ms)? {
            let bpm = analysis.bpm.round().clamp(0.0, u16::MAX as f32) as u16;
            return Ok(PulseMeasurement::new(bpm, analysis.stable));
        }

        if started.elapsed() >= PULSE_TIMEOUT {
            return Err(TimeoutKind::PulseMeasurement.into());
        }

        Timer::after(PULSE_SAMPLE).await;
    }
}

pub async fn alcohol(device: &mut AlcoholDevice<'_>) -> Result<u16> {
    device.start().await?;
    let result = alcohol_result(device).await;

    if let Err(error) = device.stop().await {
        log::warn!("failed to stop alcohol sensor work mode after measurement: {error}");
    }

    result
}

async fn alcohol_result(device: &mut AlcoholDevice<'_>) -> Result<u16> {
    let started = Instant::now();

    loop {
        if device.status().await? == Status::ReadResult {
            return Ok(device.test().await?);
        }

        if started.elapsed() >= ALCOHOL_RESULT_TIMEOUT {
            return Err(TimeoutKind::AlcoholResult.into());
        }

        Timer::after(ALCOHOL_POLL).await;
    }
}
