use model::{DeviceToPhone, Session, Source};

pub fn init() -> SharedState {
    log::debug!("initializing ble feature state");
    state::init()
}

pub fn snapshot(state: &SharedState) -> Result<Snapshot> {
    Ok(state.lock().map_err(|_| Error::State)?.snapshot())
}

pub fn session(session_id: String) -> DeviceToPhone {
    DeviceToPhone::Session(Session {
        v: model::PROTOCOL_VERSION,
        session_id,
        source: Source::BoardButton,
        history_limit: 8,
        sync_time: true,
    })
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("ble state lock poisoned")]
    State,
}

pub type Result<T> = core::result::Result<T, Error>;

pub use state::{SharedState, Snapshot};

#[allow(dead_code)]
mod model;
mod state;
