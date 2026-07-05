use esp_idf_svc::sys::EspError;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Esp(#[from] EspError),

    #[error(transparent)]
    Feature(#[from] crate::feature::Error),
}

pub type Result<T> = core::result::Result<T, Error>;
