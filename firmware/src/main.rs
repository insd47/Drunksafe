use esp_idf_svc::hal::peripherals::Peripherals;

mod error;
mod feature;

fn main() -> error::Result<()> {
    esp_idf_svc::sys::link_patches();
    esp_idf_svc::log::EspLogger::initialize_default();

    log::info!("Drunksafe firmware started");

    let peripherals = Peripherals::take()?;
    let features = feature::init(peripherals)?;

    feature::run(features)?;
    Ok(())
}
