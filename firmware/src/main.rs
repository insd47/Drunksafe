use std::time::Duration;

fn main() {
    esp_idf_svc::sys::link_patches();
    esp_idf_svc::log::EspLogger::initialize_default();

    log::info!("Drunksafe firmware started on ESP32 DevKitC V4");

    loop {
        log::info!("heartbeat");
        std::thread::sleep(Duration::from_secs(1));
    }
}
