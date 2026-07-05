use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[repr(u8)]
pub(super) enum Command {
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
    pub(super) const fn byte(self) -> u8 {
        self as u8
    }

    pub(super) const fn from(byte: u8) -> Option<Self> {
        match byte {
            0x85 => Some(Self::Status),
            0x86 => Some(Self::Result),
            0x87 => Some(Self::Work),
            0x88 => Some(Self::Time),
            0x89 => Some(Self::SetTime),
            0x90 => Some(Self::Threshold),
            0x91 => Some(Self::SetThreshold),
            0x92 => Some(Self::Pressure),
            0x93 => Some(Self::SetPressure),
            _ => None,
        }
    }
}
