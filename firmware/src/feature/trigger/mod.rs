use esp_idf_svc::hal::gpio::{Gpio0, PinDriver, Pull};
use esp_idf_svc::sys::EspError;
pub use state::State;
use std::time::Duration;

mod state;

const DEBOUNCE: Duration = Duration::from_millis(40);

pub fn init(pin: Gpio0<'static>) -> Result<State, EspError> {
    log::debug!("initializing trigger feature state");
    let button = PinDriver::input(pin, Pull::Up)?;
    Ok(State::new(button))
}

pub fn poll(state: &mut State) -> Option<Event> {
    state
        .poll(std::time::Instant::now(), DEBOUNCE)
        .then_some(Event::MeasurementRequested)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Event {
    MeasurementRequested,
}
