use crate::devices;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Esp(#[from] esp_idf_svc::sys::EspError),
    #[error(transparent)]
    AlcoholDevice(#[from] devices::alcohol::Error),
    #[error(transparent)]
    PulseDevice(#[from] devices::pulse::Error),
}

pub type Result<T> = core::result::Result<T, Error>;
