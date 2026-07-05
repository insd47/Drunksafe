mod devices;
mod features;
mod utils;

fn main() -> features::Result<()> {
    esp_idf_svc::sys::link_patches();
    esp_idf_svc::log::EspLogger::initialize_default();

    log::info!("Drunksafe firmware started");

    features::run()?;
    Ok(())
}
