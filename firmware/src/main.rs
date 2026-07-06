use error::Result;
use esp_idf_svc::hal::task::block_on;
use features::{measure, screen};
use std::time::Duration;

mod devices;
mod error;
mod features;
mod utils;

const IDLE_POLL: Duration = Duration::from_millis(20);

fn main() -> Result<()> {
    esp_idf_svc::sys::link_patches();
    esp_idf_svc::log::EspLogger::initialize_default();

    log::info!("Drunksafe firmware started");
    log::debug!("initializing firmware devices");

    let mut devices = devices::init()?;
    let mut result_pager = screen::ResultPager::new();
    let mut try_index = 0_u32;

    log::debug!("firmware devices initialized");
    log_screen(screen::home(&mut devices.display));

    loop {
        if devices.trigger.pressed() {
            result_pager.clear();
            log_screen(screen::measuring(&mut devices.display));
            let result = block_on(measure::run(&mut devices.pulse, &mut devices.alcohol));

            match result {
                Ok(measurement) => {
                    result_pager.set(measurement.alcohol_mg_l_x1000(), measurement.pulse_bpm());
                    log_screen(screen::show_current_result(
                        &mut devices.display,
                        &result_pager,
                    ));
                    log::info!(
                        "measurement completed: try_index={try_index}, alcohol_mg_l_x1000={}, pulse_bpm={:?}",
                        measurement.alcohol_mg_l_x1000(),
                        measurement.pulse_bpm()
                    );
                }
                Err(error) => {
                    log_screen(screen::measurement_failed(&mut devices.display));
                    log::warn!("measurement failed: try_index={try_index}, error={error}");
                }
            }

            try_index += 1;
        }

        if devices.result_page.pressed() {
            log_screen(screen::show_next_result(
                &mut devices.display,
                &mut result_pager,
            ));
        }

        std::thread::sleep(IDLE_POLL);
    }
}

fn log_screen(result: Result<()>) {
    if let Err(error) = result {
        log::warn!("screen update failed: {}", error);
    }
}
