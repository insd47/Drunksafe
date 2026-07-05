use crate::devices;
use esp_idf_svc::sys::EspError;
use std::time::Duration;

mod ble;

const IDLE_POLL: Duration = Duration::from_millis(20);

/// 펌웨어 feature 런타임을 시작한다.
///
/// 보드 디바이스를 초기화한 뒤, 버튼 입력을 감시하는 단일 루프를 실행한다.
/// 현재는 버튼 측정 요청을 BLE 세션 요청 로그와 pulse 상태 초기화로 연결한다.
pub fn run() -> Result<()> {
    log::debug!("initializing firmware features");

    let mut devices = devices::init()?;
    let mut session_sequence = 0_u32;

    log::debug!("firmware features initialized");

    loop {
        if devices.trigger.pressed() {
            let session_id = next_button_session_id(&mut session_sequence);
            devices.pulse.reset();

            let request = ble::session(session_id.clone());

            log::info!("measurement session requested: {request:?}");
            log::debug!("active measurement session: {session_id}");
            log::info!("waiting for phone measurement context before calibration");
        }

        std::thread::sleep(IDLE_POLL);
    }
}

fn next_button_session_id(sequence: &mut u32) -> String {
    *sequence = sequence.wrapping_add(1);
    format!("button-{sequence}")
}

/// feature 런타임 초기화와 실행 중 발생할 수 있는 오류다.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// ESP-IDF HAL 또는 service layer에서 전달된 오류다.
    #[error(transparent)]
    Esp(#[from] EspError),
}

/// feature 런타임에서 사용하는 결과 타입이다.
pub type Result<T> = core::result::Result<T, Error>;
