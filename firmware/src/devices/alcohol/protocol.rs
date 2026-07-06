use super::checksum;
use super::command::Command;
use super::error::{Error, Result};

pub const FRAME_LEN: usize = 9;
const START: u8 = 0xFF;
const ADDRESS: u8 = 0x01;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RequestFrame {
    bytes: [u8; FRAME_LEN],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ResponseFrame {
    command: Command,
    payload: [u8; 6],
    bytes: [u8; FRAME_LEN],
}

impl RequestFrame {
    pub fn new(command: Command, payload: [u8; 5]) -> Self {
        let mut bytes = [0; FRAME_LEN];
        bytes[0] = START;
        bytes[1] = ADDRESS;
        bytes[2] = command.byte();
        bytes[3..8].copy_from_slice(&payload);
        bytes[8] = checksum::generate(&bytes);

        Self { bytes }
    }

    pub const fn bytes(&self) -> &[u8; FRAME_LEN] {
        &self.bytes
    }
}

impl ResponseFrame {
    pub fn parse(command: Command, bytes: [u8; FRAME_LEN]) -> Result<Self> {
        if bytes[0] != START {
            return Err(Error::InvalidStart { found: bytes[0] });
        }

        command.expect(bytes[1])?;
        checksum::expect(&bytes)?;

        let mut payload = [0; 6];
        payload.copy_from_slice(&bytes[2..8]);

        Ok(Self {
            command,
            payload,
            bytes,
        })
    }

    pub const fn payload(&self) -> &[u8; 6] {
        &self.payload
    }

    pub fn word(&self, offset: usize) -> Result<u16> {
        if offset + 1 >= self.payload.len() {
            return Err(Error::InvalidPayload);
        }

        Ok(u16::from_be_bytes([
            self.payload[offset],
            self.payload[offset + 1],
        ]))
    }
}
