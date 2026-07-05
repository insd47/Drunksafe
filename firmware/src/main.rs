mod devices;
mod features;
mod utils;

use esp_idf_svc::sys::EspError;
use std::time::Duration;

const IDLE_POLL: Duration = Duration::from_millis(20);

fn main() -> Result<(), EspError> {
    esp_idf_svc::sys::link_patches();
    esp_idf_svc::log::EspLogger::initialize_default();

    log::info!("Drunksafe firmware started");
    log::debug!("initializing firmware devices");

    let mut devices = devices::init()?;
    let mut session_sequence = 0_u32;

    log::debug!("firmware devices initialized");

    loop {
        if devices.trigger.pressed() {
            session_sequence = session_sequence.wrapping_add(1);
            let session_id = format!("button-{session_sequence}");
            devices.pulse.reset();

            let request = features::ble::session(session_id.clone());

            log::info!("measurement session requested: {request:?}");
            log::debug!("active measurement session: {session_id}");
            log::info!("waiting for phone measurement context before calibration");
        }

        std::thread::sleep(IDLE_POLL);
    }
}
