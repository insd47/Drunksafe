use crate::devices::{AlcoholError, PulseError};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Pulse(#[from] PulseError),
    #[error(transparent)]
    Alcohol(#[from] AlcoholError),
    #[error("alcohol measurement timed out")]
    AlcoholTimeout,
}

pub type Result<T> = core::result::Result<T, Error>;
