use crate::devices::{pulse, PulseDevice};
use crate::error::Result;
use embassy_time::{Duration, Instant, Timer};

const SAMPLE: Duration = Duration::from_millis(10);
const TIMEOUT: Duration = Duration::from_secs(16);

pub async fn read(pulse: &mut PulseDevice<'static>) -> Result<Option<pulse::Analysis>> {
    let started = Instant::now();

    loop {
        let elapsed_ms = started.elapsed().as_millis().min(u64::from(u32::MAX)) as u32;

        if let Some(analysis) = pulse.sample(elapsed_ms)? {
            return Ok(Some(analysis));
        }

        if started.elapsed() >= TIMEOUT {
            return Ok(pulse.analyze());
        }

        Timer::after(SAMPLE).await;
    }
}
