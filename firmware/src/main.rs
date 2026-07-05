mod feature;
mod utils;

fn main() -> feature::Result<()> {
    esp_idf_svc::sys::link_patches();
    esp_idf_svc::log::EspLogger::initialize_default();

    log::info!("Drunksafe firmware started");

    feature::run()?;
    Ok(())
}
