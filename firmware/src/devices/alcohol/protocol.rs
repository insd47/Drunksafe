use super::checksum;
use super::error::{Error, Result};
use super::Error::{UnexpectedCommand, UnknownCommand};
use serde::{Deserialize, Serialize};

pub const FRAME_LEN: usize = 9;
const START: u8 = 0xFF;
const ADDRESS: u8 = 0x01;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[repr(u8)]
pub enum Command {
    Status = 0x85,
    Result = 0x86,
    Work = 0x87,
    SetBlowTime = 0x89,
    SetBlowPressure = 0x93,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RequestFrame {
    bytes: [u8; FRAME_LEN],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ResponseFrame {
    payload: [u8; 6],
}

impl Command {
    pub const fn byte(self) -> u8 {
        self as u8
    }

    pub const fn from(byte: u8) -> Result<Self> {
        match byte {
            0x85 => Ok(Self::Status),
            0x86 => Ok(Self::Result),
            0x87 => Ok(Self::Work),
            0x89 => Ok(Self::SetBlowTime),
            0x93 => Ok(Self::SetBlowPressure),
            _ => Err(UnknownCommand { command: byte }),
        }
    }

    pub fn expect(self, byte: u8) -> Result<()> {
        let actual = Self::from(byte)?;

        if actual == self {
            Ok(())
        } else {
            Err(UnexpectedCommand {
                expected: self.byte(),
                actual: byte,
            })
        }
    }
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

        Ok(Self { payload })
    }

    pub const fn payload(&self) -> &[u8; 6] {
        &self.payload
    }
}
