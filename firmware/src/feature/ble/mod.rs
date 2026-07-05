use model::{DeviceToPhone, Session, Source};

#[allow(dead_code)]
mod model;

pub fn session(session_id: String) -> DeviceToPhone {
    DeviceToPhone::Session(Session {
        v: model::PROTOCOL_VERSION,
        session_id,
        source: Source::BoardButton,
        history_limit: 8,
        sync_time: true,
    })
}
