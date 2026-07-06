use error::Result;
use esp_idf_svc::hal::task::block_on;
use features::measure;
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
    let mut try_index = 0_u32;

    log::debug!("firmware devices initialized");

    loop {
        if devices.trigger.pressed() {
            let result = block_on(measure::run(&mut devices.pulse, &mut devices.alcohol));

            match result {
                Ok((pulse, alcohol_mg_l_x1000)) => log::info!(
                    "measurement completed: try_index={try_index}, alcohol_mg_l_x1000={alcohol_mg_l_x1000}, pulse={pulse:?}"
                ),
                Err(error) => log::warn!("measurement failed: try_index={try_index}, error={error}"),
            }

            try_index += 1;
        }

        std::thread::sleep(IDLE_POLL);
    }
}
