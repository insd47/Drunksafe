use esp_idf_svc::sys::EspError;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Esp(#[from] EspError),

    #[error("trigger state lock poisoned")]
    State,
}

pub type Result<T> = core::result::Result<T, Error>;
