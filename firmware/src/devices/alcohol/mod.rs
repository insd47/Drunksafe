use channel::Channel;
use command::Command;
pub use error::{Error, Result};
use esp_idf_svc::hal::gpio::{InputPin, OutputPin};
use esp_idf_svc::hal::uart::Uart;
pub use status::Status;

mod channel;
mod checksum;
mod command;
mod error;
mod protocol;
mod status;

pub struct AlcoholDevice<'d> {
    channel: Channel<'d>,
}

impl<'d> AlcoholDevice<'d> {
    pub fn new<UART: Uart + 'd>(
        uart: UART,
        tx: impl OutputPin + 'd,
        rx: impl InputPin + 'd,
    ) -> Result<Self> {
        let channel = Channel::new(uart, tx, rx)?;
        Ok(Self { channel })
    }

    pub async fn test(&mut self) -> Result<u16> {
        let res = self.channel.request(Command::Result, [0; 5]).await?;
        res.word(0)
    }

    pub async fn status(&mut self) -> Result<Status> {
        let res = self.channel.request(Command::Status, [0; 5]).await?;
        Ok(Status::from(res.payload()[0]))
    }

    pub async fn work(&mut self, wake: bool) -> Result<()> {
        let value = if wake { 0x32 } else { 0x00 };
        self.channel
            .request(Command::Work, [value, 0, 0, 0, 0])
            .await?;

        Ok(())
    }

    pub async fn stop_work(&mut self) -> Result<()> {
        self.channel.drain_pending().await?;

        let first = self.work(false).await;
        let second = self.work(false).await;

        self.channel.drain_pending().await?;

        match (first, second) {
            (_, Ok(())) => Ok(()),
            (Err(error), Err(_)) | (Ok(()), Err(error)) => Err(error),
        }
    }
}
