pub mod alcohol;
pub mod ble;
pub mod pulse;
pub mod runtime;
pub mod state;
pub mod trigger;

use std::time::Duration;

use esp_idf_svc::hal::peripherals::Peripherals;

const IDLE_POLL: Duration = Duration::from_millis(20);

pub struct Features {
    pub alcohol: alcohol::SharedState,
    pub ble: ble::SharedState,
    pub pulse: pulse::SharedState,
    pub runtime: runtime::SharedState,
    pub trigger: trigger::SharedState,
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
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

pub fn init(peripherals: Peripherals) -> Result<Features> {
    log::debug!("initializing firmware features");

    let pins = peripherals.pins;
    let alcohol = alcohol::init()?;
    let ble = ble::init()?;
    let pulse = pulse::init()?;
    let runtime = runtime::init()?;
    let trigger = trigger::init(pins.gpio0)?;

    log::debug!("firmware features initialized");
    Ok(Features {
        alcohol,
        ble,
        pulse,
        runtime,
        trigger,
    })
}

pub fn run(features: Features) -> Result<()> {
    let alcohol = alcohol::snapshot(&features.alcohol)?;
    let ble = ble::snapshot(&features.ble)?;
    log::debug!(
        "feature state snapshot: protocol_version={}, alcohol_sample={}",
        ble.protocol_version,
        alcohol.has_sample
    );

    loop {
        if let Some(event) = trigger::poll(&features.trigger)? {
            match event {
                trigger::Event::MeasurementRequested => {
                    let session = runtime::begin_button_session(&features.runtime)?;
                    pulse::reset(&features.pulse)?;

                    let request = ble::session(session.id);
                    let active_session_id = runtime::active_session_id(&features.runtime)?;

                    log::info!("measurement session requested: {request:?}");
                    log::debug!("active measurement session: {active_session_id:?}");
                    log::info!("waiting for phone measurement context before calibration");
                }
            }
        }

        std::thread::sleep(IDLE_POLL);
    }
}
