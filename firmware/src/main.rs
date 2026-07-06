use error::Result;
use esp_idf_svc::hal::task::block_on;
use services::measure::MeasureService;
use services::screen::{ScreenService, View};
use std::time::Duration;

mod devices;
mod error;
mod services;
mod utils;

const IDLE_POLL: Duration = Duration::from_millis(20);

fn main() -> Result<()> {
    esp_idf_svc::sys::link_patches();
    esp_idf_svc::log::EspLogger::initialize_default();

    log::info!("Drunksafe firmware started");
    log::debug!("initializing firmware devices");

    let mut devices = devices::init()?;
    let mut measure = MeasureService::new(devices.pulse, devices.alcohol);
    let mut screen = ScreenService::new(devices.display);

    log::debug!("firmware devices initialized");
    screen.show(View::Home);

    loop {
        if devices.trigger.pressed() {
            screen.show(View::Measuring);
            let result = block_on(measure.run());

            match result {
                Ok(measurement) => {
                    screen.show(View::Result(measurement));
                }
                Err(error) => {
                    screen.show(View::Failed);
                    log::error!("measure failed: error={error}");
                }
            }
        }

        std::thread::sleep(IDLE_POLL);
    }
}
