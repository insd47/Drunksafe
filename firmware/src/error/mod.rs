use crate::devices;
pub use timeout::TimeoutKind;

mod timeout;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Esp(#[from] esp_idf_svc::sys::EspError),
    #[error(transparent)]
    AlcoholDevice(#[from] devices::AlcoholError),
    #[error(transparent)]
    PulseDevice(#[from] devices::PulseError),
    #[error("{0} timed out")]
    Timeout(TimeoutKind),
}

pub type Result<T> = core::result::Result<T, Error>;
