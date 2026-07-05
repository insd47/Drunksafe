use crate::feature::state::{shared, Shared};

pub fn init() -> SharedState {
    shared(State::default())
}

pub fn begin_button_session(state: &SharedState) -> Result<Session> {
    let mut state = state.lock().map_err(|_| Error::State)?;
    state.session_sequence = state.session_sequence.wrapping_add(1);

    let id = format!("button-{}", state.session_sequence);

    Ok(Session { id })
}

#[derive(Debug, Default)]
pub struct State {
    session_sequence: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Session {
    pub id: String,
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("feature runtime state lock poisoned")]
    State,
}

pub type Result<T> = core::result::Result<T, Error>;
pub type SharedState = Shared<State>;
