#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Error {
    Transport,
    Timeout,
    InvalidStart { found: u8 },
    InvalidChecksum { expected: u8, actual: u8 },
    UnknownCommand { command: u8 },
    UnexpectedCommand { expected: u8, actual: u8 },
    InvalidPayload,
}

pub type Result<T> = core::result::Result<T, Error>;
