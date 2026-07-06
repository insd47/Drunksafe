use channel::Channel;
use command::Command;
pub use error::{Error, Result};
use esp_idf_svc::hal::uart::{AsyncUartDriver, UartDriver};
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
    pub const fn new(uart: AsyncUartDriver<'d, UartDriver<'d>>) -> Self {
        let channel = Channel::new(uart);
        Self { channel }
    }

    #[allow(dead_code)]
    pub async fn test(&mut self) -> Result<u16> {
        let res = self.channel.request(Command::Result, [0; 5]).await?;
        res.word(0)
    }

    #[allow(dead_code)]
    pub async fn status(&mut self) -> Result<Status> {
        let res = self.channel.request(Command::Status, [0; 5]).await?;
        Ok(Status::from(res.payload()[0]))
    }

    #[allow(dead_code)]
    pub async fn work(&mut self, wake: bool) -> Result<()> {
        let value = wake as u8;
        self.channel
            .request(Command::Work, [value, 0, 0, 0, 0])
            .await?;

        Ok(())
    }
}
