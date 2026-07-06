use super::error::Result;
use super::Error::{UnexpectedCommand, UnknownCommand};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[repr(u8)]
pub enum Command {
    Status = 0x85,
    Result = 0x86,
    Work = 0x87,
    Time = 0x88,
    SetTime = 0x89,
    Threshold = 0x90,
    SetThreshold = 0x91,
    Pressure = 0x92,
    SetPressure = 0x93,
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
            0x88 => Ok(Self::Time),
            0x89 => Ok(Self::SetTime),
            0x90 => Ok(Self::Threshold),
            0x91 => Ok(Self::SetThreshold),
            0x92 => Ok(Self::Pressure),
            0x93 => Ok(Self::SetPressure),
            _ => Err(UnknownCommand { command: byte }),
        }
    }

    pub fn expect(self, byte: u8) -> Result<()> {
        let actual = Command::from(byte)?;

        if actual != self {
            Err(UnexpectedCommand {
                expected: self.byte(),
                actual: byte,
            })
        } else {
            Ok(())
        }
    }
}
