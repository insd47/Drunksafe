pub use error::{Error, Result};
pub use model::{Sample, Status};
use protocol::FRAME_LEN;
use std::time::Duration;
pub use transport::Transport;

mod command;
mod error;
mod model;
mod protocol;
mod transport;

const DEFAULT_READ_TIMEOUT: Duration = Duration::from_millis(100);

pub struct Device<T> {
    transport: T,
    read_timeout: Duration,
}

impl<T: Transport> Device<T> {
    pub fn attach(transport: T) -> Result<Self> {
        let mut device = Self::new(transport);
        device.status()?;
        Ok(device)
    }

    pub const fn new(transport: T) -> Self {
        Self {
            transport,
            read_timeout: DEFAULT_READ_TIMEOUT,
        }
    }

    pub const fn with_timeout(transport: T, read_timeout: Duration) -> Self {
        Self {
            transport,
            read_timeout,
        }
    }

    pub fn sample(&mut self) -> Result<Sample> {
        self.query(command::Command::Result, [0; 5])?.try_into()
    }

    pub fn status(&mut self) -> Result<Status> {
        self.query(command::Command::Status, [0; 5])?.try_into()
    }

    fn query(
        &mut self,
        command: command::Command,
        payload: [u8; 5],
    ) -> Result<protocol::ResponseFrame> {
        let request = protocol::RequestFrame::new(command, payload);
        self.transport.write(request.bytes())?;
        self.read()
    }

    fn read(&mut self) -> Result<protocol::ResponseFrame> {
        let mut bytes = [0; FRAME_LEN];
        let mut offset = 0;

        while offset < FRAME_LEN {
            let read = self
                .transport
                .read(&mut bytes[offset..], self.read_timeout)?;
            if read == 0 {
                return Err(Error::Timeout);
            }

            offset += read;
        }

        protocol::ResponseFrame::parse(bytes)
    }
}
