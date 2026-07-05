#![allow(dead_code, unused_imports)]

pub mod command;
pub mod error;
pub mod model;
pub mod protocol;
pub mod transport;

pub use command::Command;
pub use error::{Error, Result};
pub use model::{Concentration, Raw, Sample, Status};
pub use protocol::{RequestFrame, ResponseFrame};
pub use transport::Transport;

use protocol::FRAME_LEN;

pub struct Device<T> {
    transport: T,
}

impl<T: Transport> Device<T> {
    pub const fn new(transport: T) -> Self {
        Self { transport }
    }

    pub fn init(&mut self) -> Result<Status> {
        self.status()
    }

    pub fn sample(&mut self) -> Result<Sample> {
        self.query(Command::Result, [0; 5])?.try_into()
    }

    pub fn status(&mut self) -> Result<Status> {
        self.query(Command::Status, [0; 5])?.try_into()
    }

    fn query(&mut self, command: Command, payload: [u8; 5]) -> Result<ResponseFrame> {
        let request = RequestFrame::new(command, payload);
        self.transport.write(request.bytes())?;
        self.read()
    }

    fn read(&mut self) -> Result<ResponseFrame> {
        let mut bytes = [0; FRAME_LEN];
        let mut offset = 0;

        while offset < FRAME_LEN {
            let read = self.transport.read(&mut bytes[offset..])?;
            if read == 0 {
                return Err(Error::Timeout);
            }

            offset += read;
        }

        ResponseFrame::parse(bytes)
    }
}

pub fn init<T: Transport>(transport: T) -> Result<Device<T>> {
    let mut device = Device::new(transport);
    device.init()?;
    Ok(device)
}

pub fn sample<T: Transport>(device: &mut Device<T>) -> Result<Sample> {
    device.sample()
}

pub fn status<T: Transport>(device: &mut Device<T>) -> Result<Status> {
    device.status()
}
