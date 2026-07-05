#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("pulse state lock poisoned")]
    State,

    #[error(
        "pulse sample timestamp moved backwards: previous {previous_ms}ms, current {current_ms}ms"
    )]
    NonMonotonic { previous_ms: u32, current_ms: u32 },
}

pub type Result<T> = core::result::Result<T, Error>;
