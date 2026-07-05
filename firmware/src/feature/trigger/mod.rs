use esp_idf_svc::hal::gpio::{Gpio0, PinDriver, Pull};
use esp_idf_svc::sys::EspError;
pub use state::State;
use std::time::Duration;

mod state;

const DEBOUNCE: Duration = Duration::from_millis(40);

/// BOOT 버튼 핀을 입력 pull-up으로 설정하고 trigger 상태를 만든다.
pub fn init(pin: Gpio0<'static>) -> Result<State, EspError> {
    log::debug!("initializing trigger feature state");
    let button = PinDriver::input(pin, Pull::Up)?;
    Ok(State::new(button))
}

/// 버튼 debounce 상태 머신을 한 번 진행하고 발생한 이벤트를 반환한다.
///
/// 블로킹하지 않으므로 runtime loop에서 주기적으로 호출한다.
pub fn poll(state: &mut State) -> Option<Event> {
    state
        .poll(std::time::Instant::now(), DEBOUNCE)
        .then_some(Event::MeasurementRequested)
}

/// 측정 흐름을 시작할 수 있는 입력 이벤트다.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Event {
    /// 보드 버튼으로 새 측정이 요청됐다.
    MeasurementRequested,
}
