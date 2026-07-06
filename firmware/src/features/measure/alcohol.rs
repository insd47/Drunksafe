use super::Error;
use crate::devices::{AlcoholDevice, AlcoholStatus};
use embassy_time::{Duration, Instant, Timer};

const POLL: Duration = Duration::from_millis(200);
const TIMEOUT: Duration = Duration::from_secs(16);

pub async fn read(alcohol: &mut AlcoholDevice<'static>) -> crate::features::measure::Result<u16> {
    alcohol.work(true).await?;
    let started = Instant::now();

    loop {
        if alcohol.status().await? == AlcoholStatus::ReadResult {
            return Ok(alcohol.test().await?);
        }

        if started.elapsed() >= TIMEOUT {
            return Err(Error::AlcoholTimeout);
        }

        Timer::after(POLL).await;
    }
}
