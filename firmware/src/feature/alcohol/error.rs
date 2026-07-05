#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum Error {
    #[error("alcohol state lock poisoned")]
    State,

    #[error("transport error")]
    Transport,
    #[error("timed out while reading alcohol sensor frame")]
    Timeout,
    #[error("invalid alcohol sensor frame start byte: expected 0xff, found {found:#04x}")]
    InvalidStart { found: u8 },
    #[error("invalid alcohol sensor checksum: expected {expected:#04x}, got {actual:#04x}")]
    InvalidChecksum { expected: u8, actual: u8 },
    #[error("unknown alcohol sensor command: {command:#04x}")]
    UnknownCommand { command: u8 },
    #[error("unexpected alcohol sensor command: expected {expected:#04x}, got {actual:#04x}")]
    UnexpectedCommand { expected: u8, actual: u8 },
    #[error("invalid alcohol sensor payload")]
    InvalidPayload,
}

pub type Result<T> = core::result::Result<T, Error>;
