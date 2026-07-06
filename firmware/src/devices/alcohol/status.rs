#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Status {
    Idle,
    Preheating,
    WaitBlow,
    Blowing,
    Calculating,
    ReadResult,
    Unknown(u8),
}

impl Status {
    pub const fn from(byte: u8) -> Self {
        match byte {
            0x31 => Self::Idle,
            0x32 => Self::Preheating,
            0x33 => Self::WaitBlow,
            0x34 => Self::Blowing,
            0x36 => Self::Calculating,
            0x37 => Self::ReadResult,
            status => Self::Unknown(status),
        }
    }
}
