use super::command::Command;
use super::error::{Error, Result};

pub const FRAME_LEN: usize = 9;
pub const START: u8 = 0xFF;
pub const ADDRESS: u8 = 0x01;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RequestFrame {
    bytes: [u8; FRAME_LEN],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ResponseFrame {
    command: Command,
    data: [u8; 6],
    bytes: [u8; FRAME_LEN],
}

impl RequestFrame {
    pub fn new(command: Command, payload: [u8; 5]) -> Self {
        let mut bytes = [0; FRAME_LEN];
        bytes[0] = START;
        bytes[1] = ADDRESS;
        bytes[2] = command.byte();
        bytes[3..8].copy_from_slice(&payload);
        bytes[8] = checksum(&bytes);

        Self { bytes }
    }

    pub const fn bytes(&self) -> &[u8; FRAME_LEN] {
        &self.bytes
    }
}

impl ResponseFrame {
    pub fn parse(bytes: [u8; FRAME_LEN]) -> Result<Self> {
        if bytes[0] != START {
            return Err(Error::InvalidStart { found: bytes[0] });
        }

        let expected = checksum(&bytes);
        let actual = bytes[8];
        if actual != expected {
            return Err(Error::InvalidChecksum { expected, actual });
        }

        let command = Command::from(bytes[1]).ok_or(Error::UnknownCommand { command: bytes[1] })?;
        let mut data = [0; 6];
        data.copy_from_slice(&bytes[2..8]);

        Ok(Self {
            command,
            data,
            bytes,
        })
    }

    pub const fn command(&self) -> Command {
        self.command
    }

    pub const fn data(&self) -> &[u8; 6] {
        &self.data
    }

    pub const fn bytes(&self) -> &[u8; FRAME_LEN] {
        &self.bytes
    }

    pub fn word(&self, offset: usize) -> Result<u16> {
        if offset + 1 >= self.data.len() {
            return Err(Error::InvalidPayload);
        }

        Ok(u16::from_be_bytes([
            self.data[offset],
            self.data[offset + 1],
        ]))
    }
}

pub fn checksum(bytes: &[u8; FRAME_LEN]) -> u8 {
    bytes[1..8]
        .iter()
        .fold(0_u8, |sum, byte| sum.wrapping_add(*byte))
        .wrapping_neg()
}
