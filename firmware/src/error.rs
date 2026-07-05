#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Feature(#[from] crate::feature::Error),
}

pub type Result<T> = core::result::Result<T, Error>;
