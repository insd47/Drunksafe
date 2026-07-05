use esp_idf_svc::hal::peripherals::Peripherals;
use esp_idf_svc::sys::EspError;
use std::time::Duration;

#[allow(dead_code)]
mod alcohol;
mod ble;
#[allow(dead_code)]
mod pulse;
mod trigger;

const IDLE_POLL: Duration = Duration::from_millis(20);

pub fn run() -> Result<()> {
    log::debug!("initializing firmware features");

    let pins = Peripherals::take()?.pins;
    let mut pulse = pulse::State::default();
    let mut trigger = trigger::init(pins.gpio0)?;
    let mut session_sequence = 0_u32;

    log::debug!("firmware features initialized");

    loop {
        if let Some(event) = trigger::poll(&mut trigger) {
            match event {
                trigger::Event::MeasurementRequested => {
                    let session_id = next_button_session_id(&mut session_sequence);
                    pulse::reset(&mut pulse);

                    let request = ble::session(session_id.clone());

                    log::info!("measurement session requested: {request:?}");
                    log::debug!("active measurement session: {session_id}");
                    log::info!("waiting for phone measurement context before calibration");
                }
            }
        }

        std::thread::sleep(IDLE_POLL);
    }
}

fn next_button_session_id(sequence: &mut u32) -> String {
    *sequence = sequence.wrapping_add(1);
    format!("button-{sequence}")
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Esp(#[from] EspError),
}

pub type Result<T> = core::result::Result<T, Error>;
