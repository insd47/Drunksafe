use crate::devices::{alcohol, AlcoholDevice};
use crate::error::{Result, TimeoutKind};
use embassy_time::{Duration, Instant, Timer};

const POLL: Duration = Duration::from_millis(200);
const TIMEOUT: Duration = Duration::from_secs(16);

pub async fn read(alcohol: &mut AlcoholDevice<'static>) -> Result<u16> {
    alcohol.work(true).await?;
    let started = Instant::now();

    loop {
        if alcohol.status().await? == alcohol::Status::ReadResult {
            return Ok(alcohol.test().await?);
        }

        if started.elapsed() >= TIMEOUT {
            return Err(TimeoutKind::AlcoholResult.into());
        }

        Timer::after(POLL).await;
    }
}
