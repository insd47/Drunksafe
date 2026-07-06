use crate::devices::{PulseAnalysis, PulseDevice};
use embassy_time::{Duration, Instant, Timer};

const SAMPLE: Duration = Duration::from_millis(10);
const TIMEOUT: Duration = Duration::from_secs(16);

pub async fn read(
    pulse: &mut PulseDevice<'static>,
) -> crate::features::measure::Result<Option<PulseAnalysis>> {
    let started = Instant::now();

    loop {
        let elapsed_ms = elapsed_ms(started);
        if let Some(analysis) = pulse.sample(elapsed_ms)? {
            return Ok(Some(analysis));
        }

        if started.elapsed() >= TIMEOUT {
            return Ok(pulse.analyze());
        }

        Timer::after(SAMPLE).await;
    }
}

fn elapsed_ms(started: Instant) -> u32 {
    started.elapsed().as_millis().min(u64::from(u32::MAX)) as u32
}
