use application::Application;
use error::Result;

mod application;
mod devices;
mod error;
mod services;
mod utils;

fn main() -> Result<()> {
    esp_idf_svc::sys::link_patches();
    esp_idf_svc::log::EspLogger::initialize_default();

    log::info!("Drunksafe firmware started");
    Application::new(devices::init()?)?.run()
}
