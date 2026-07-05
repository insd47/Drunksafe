use std::time::Duration;

use esp_idf_svc::hal::gpio::{Input, PinDriver, Pull};
use esp_idf_svc::hal::peripherals::Peripherals;
use esp_idf_svc::sys::EspError;

use feature::ble::{
    ContextRequest, DeviceToPhoneMessage, MeasurementSessionRequest, MeasurementStartSource,
    PhoneContextField, PROTOCOL_VERSION,
};

mod feature;

const BUTTON_DEBOUNCE_MS: u64 = 40;
const BUTTON_POLL_MS: u64 = 20;

fn wait_for_button_press(button: &PinDriver<'_, Input>) {
    loop {
        if button.is_low() {
            std::thread::sleep(Duration::from_millis(BUTTON_DEBOUNCE_MS));
            if button.is_low() {
                return;
            }
        }

        std::thread::sleep(Duration::from_millis(BUTTON_POLL_MS));
    }
}

fn wait_for_button_release(button: &PinDriver<'_, Input>) {
    while button.is_low() {
        std::thread::sleep(Duration::from_millis(BUTTON_POLL_MS));
    }

    std::thread::sleep(Duration::from_millis(BUTTON_DEBOUNCE_MS));
}

fn build_session_request(session_id: String) -> DeviceToPhoneMessage {
    DeviceToPhoneMessage::MeasurementSessionRequest(MeasurementSessionRequest {
        v: PROTOCOL_VERSION,
        session_id,
        source: MeasurementStartSource::BoardButton,
        context_request: ContextRequest {
            requested_history_limit: 5,
            requested_fields: vec![
                PhoneContextField::RecentMeasurements,
                PhoneContextField::UserBaseline,
                PhoneContextField::LastCalibration,
                PhoneContextField::TimeSync,
            ],
        },
    })
}

fn main() -> Result<(), EspError> {
    esp_idf_svc::sys::link_patches();
    esp_idf_svc::log::EspLogger::initialize_default();

    log::info!("Drunksafe firmware started");
    log::info!(
        "BLE flow: board button -> phone context -> board calibration/measurement -> result"
    );

    let peripherals = Peripherals::take()?;
    let button = PinDriver::input(peripherals.pins.gpio0, Pull::Up)?;
    let mut session_sequence = 0_u32;

    loop {
        log::info!("waiting for BOOT button to start measurement");
        wait_for_button_press(&button);

        session_sequence = session_sequence.wrapping_add(1);
        let session_id = format!("button-{session_sequence}");
        let request = build_session_request(session_id);

        log::info!("measurement session requested: {request:?}");
        log::info!("waiting for phone measurement context before calibration");

        wait_for_button_release(&button);
    }
}
