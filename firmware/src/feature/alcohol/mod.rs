pub use error::{Error, Result};
use esp_idf_svc::hal::delay::TickType;
use esp_idf_svc::hal::uart::UartDriver;
pub use model::{Sample, Status};
use protocol::FRAME_LEN;
use std::time::Duration;

mod command;
mod error;
mod model;
mod protocol;

const DEFAULT_READ_TIMEOUT: Duration = Duration::from_millis(100);

pub struct Device<'d> {
    uart: UartDriver<'d>,
}

impl<'d> Device<'d> {
    pub const fn new(uart: UartDriver<'d>) -> Self {
        Self { uart }
    }

    #[allow(dead_code)]
    pub fn sample(&mut self) -> Result<Sample> {
        self.query(command::Command::Result, [0; 5])?.try_into()
    }

    #[allow(dead_code)]
    pub fn status(&mut self) -> Result<Status> {
        self.query(command::Command::Status, [0; 5])?.try_into()
    }

    fn query(
        &mut self,
        command: command::Command,
        payload: [u8; 5],
    ) -> Result<protocol::ResponseFrame> {
        let request = protocol::RequestFrame::new(command, payload);
        self.write_all(request.bytes())?;
        self.read()
    }

    fn write_all(&mut self, bytes: &[u8]) -> Result<()> {
        let mut offset = 0;

        while offset < bytes.len() {
            let written = self.uart.write(&bytes[offset..])?;
            if written == 0 {
                return Err(Error::WriteZero);
            }

            offset += written;
        }

        Ok(())
    }

    fn read(&mut self) -> Result<protocol::ResponseFrame> {
        let mut bytes = [0; FRAME_LEN];
        let mut offset = 0;
        let timeout = TickType::from(DEFAULT_READ_TIMEOUT).ticks();

        while offset < FRAME_LEN {
            let read = self.uart.read(&mut bytes[offset..], timeout)?;
            if read == 0 {
                return Err(Error::Timeout);
            }

            offset += read;
        }

        protocol::ResponseFrame::parse(bytes)
    }
}
