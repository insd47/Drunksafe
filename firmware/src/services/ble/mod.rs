use model::{DeviceToPhone, Session, Source};

#[allow(dead_code)]
mod model;

/// 보드 버튼에서 시작된 새 측정 세션 요청 DTO를 만든다.
#[allow(dead_code)]
pub fn session(session_id: String) -> DeviceToPhone {
    DeviceToPhone::Session(Session {
        v: model::PROTOCOL_VERSION,
        session_id,
        source: Source::BoardButton,
        history_limit: 8,
        sync_time: true,
    })
}
