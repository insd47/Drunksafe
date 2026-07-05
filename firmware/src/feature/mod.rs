use esp_idf_svc::hal::peripherals::Peripherals;
use esp_idf_svc::sys::EspError;
use std::time::Duration;

#[allow(dead_code)]
mod alcohol;
mod ble;
#[allow(dead_code)]
mod pulse;
mod runtime;
mod state;
mod trigger;

const IDLE_POLL: Duration = Duration::from_millis(20);

pub fn run() -> Result<()> {
    log::debug!("initializing firmware features");

    let pins = Peripherals::take()?.pins;
    let alcohol = alcohol::init();
    let ble = ble::init();
    let pulse = pulse::init();
    let runtime = runtime::init();
    let trigger = trigger::init(pins.gpio0)?;

    log::debug!("firmware features initialized");

    let alcohol = alcohol::snapshot(&alcohol)?;
    let ble = ble::snapshot(&ble)?;

    log::debug!(
        "feature state snapshot: protocol_version={}, alcohol_sample={}",
        ble.protocol_version,
        alcohol.has_sample
    );

    loop {
        if let Some(event) = trigger::poll(&trigger)? {
            match event {
                trigger::Event::MeasurementRequested => {
                    let session = runtime::begin_button_session(&runtime)?;
                    pulse::reset(&pulse)?;

                    let request = ble::session(session.id.clone());

                    log::info!("measurement session requested: {request:?}");
                    log::debug!("active measurement session: {}", session.id);
                    log::info!("waiting for phone measurement context before calibration");
                }
            }
        }

        std::thread::sleep(IDLE_POLL);
    }
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Esp(#[from] EspError),

    #[error(transparent)]
    Alcohol(#[from] alcohol::Error),

    #[error(transparent)]
    Ble(#[from] ble::Error),

    #[error(transparent)]
    Pulse(#[from] pulse::Error),

    #[error(transparent)]
    Runtime(#[from] runtime::Error),

    #[error(transparent)]
    Trigger(#[from] trigger::Error),
}

pub type Result<T> = core::result::Result<T, Error>;
