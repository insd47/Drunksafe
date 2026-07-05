use super::command::Command;
use super::protocol::{ResponseFrame, FRAME_LEN};
use super::{protocol, Error};
use esp_idf_svc::hal::delay::TickType;
use esp_idf_svc::hal::uart::UartDriver;
use std::time::Duration;

const READ_TIMEOUT: Duration = Duration::from_millis(100);

pub struct Channel<'d> {
    uart: UartDriver<'d>,
}

impl<'d> Channel<'d> {
    pub const fn new(uart: UartDriver<'d>) -> Self {
        Self { uart }
    }

    pub fn request(
        &mut self,
        command: Command,
        payload: [u8; 5],
    ) -> crate::devices::alcohol::Result<ResponseFrame> {
        let frame = protocol::RequestFrame::new(command, payload);
        self.write(frame.bytes())?;
        Ok(self.read(command)?)
    }

    fn write(&mut self, bytes: &[u8]) -> crate::devices::alcohol::Result<()> {
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

    fn read(&mut self, command: Command) -> crate::devices::alcohol::Result<ResponseFrame> {
        let mut bytes = [0; FRAME_LEN];
        let mut offset = 0;
        let timeout = TickType::from(READ_TIMEOUT).ticks();

        while offset < FRAME_LEN {
            let read = self.uart.read(&mut bytes[offset..], timeout)?;
            if read == 0 {
                return Err(Error::Timeout);
            }

            offset += read;
        }

        ResponseFrame::parse(command, bytes)
    }
}
