use crate::feature::state::{shared, Shared};

#[derive(Debug, Default)]
pub struct State {
    session_sequence: u32,
    active_session_id: Option<String>,
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

pub fn init() -> Result<SharedState> {
    Ok(shared(State::default()))
}

pub fn begin_button_session(state: &SharedState) -> Result<Session> {
    let mut state = state.lock().map_err(|_| Error::State)?;
    state.session_sequence = state.session_sequence.wrapping_add(1);

    let id = format!("button-{}", state.session_sequence);
    state.active_session_id = Some(id.clone());

    Ok(Session { id })
}

pub fn active_session_id(state: &SharedState) -> Result<Option<String>> {
    Ok(state
        .lock()
        .map_err(|_| Error::State)?
        .active_session_id
        .clone())
}
