pub mod error;
pub mod state;

pub use error::{Error, Result};
pub use state::SharedState;

use std::time::Duration;

use esp_idf_svc::hal::gpio::{Gpio0, PinDriver, Pull};

const DEBOUNCE: Duration = Duration::from_millis(40);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Event {
    MeasurementRequested,
}

pub fn init(pin: Gpio0<'static>) -> Result<SharedState> {
    log::debug!("initializing trigger feature state");
    let button = PinDriver::input(pin, Pull::Up)?;
    Ok(state::init(button))
}

pub fn poll(state: &SharedState) -> Result<Option<Event>> {
    let requested = state
        .lock()
        .map_err(|_| Error::State)?
        .poll(std::time::Instant::now(), DEBOUNCE);

    Ok(requested.then_some(Event::MeasurementRequested))
}
