use error::Result;
use esp_idf_svc::hal::task::block_on;
use services::ble::{
    self, BleService, ErrorCode, MeasurementStep, PhoneCommand, Source, StatusKind,
};
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

    let devices = devices::init()?;
    let ble = BleService::new(devices.modem)?;
    let mut measure = MeasureService::new(devices.pulse, devices.alcohol);
    let mut screen = ScreenService::new(devices.display);
    let mut trigger = devices.trigger;
    let mut session_seq = 0_u32;

    log::debug!("firmware devices initialized");
    screen.show(View::Home);
    notify_ble(&ble, ble::device_status(StatusKind::Idle, None));

    loop {
        let mut phone_start = false;

        while let Some(command) = ble.try_recv_command() {
            match command {
                PhoneCommand::Start => {
                    phone_start = true;
                }
                PhoneCommand::Context(context) => {
                    log::info!("received phone context for session={}", context.session_id);
                }
                PhoneCommand::Cancel { session_id } => {
                    log::info!("received cancel for session={session_id}");
                }
                PhoneCommand::Time { unix_time_ms } => {
                    log::debug!("received phone time unix_ms={unix_time_ms}");
                }
                PhoneCommand::Ack { session_id } => {
                    log::debug!("received result ack for session={session_id}");
                }
            }
        }

        let source = if trigger.pressed() {
            Some(Source::BoardButton)
        } else if phone_start {
            Some(Source::Phone)
        } else {
            None
        };

        if let Some(source) = source {
            session_seq = session_seq.wrapping_add(1);
            let session_id = format!("fw-{session_seq}");

            notify_ble(
                &ble,
                ble::device_status(StatusKind::Measuring, Some(session_id.clone())),
            );
            notify_ble(&ble, ble::measurement_started(session_id.clone(), source));
            notify_ble(
                &ble,
                ble::measurement_progress(session_id.clone(), MeasurementStep::Preparing, 5),
            );

            screen.show(View::Measuring);
            let result = block_on(measure.run());

            match result {
                Ok(measurement) => {
                    notify_ble(
                        &ble,
                        ble::measurement_progress(
                            session_id.clone(),
                            MeasurementStep::Analyzing,
                            90,
                        ),
                    );
                    notify_ble(
                        &ble,
                        ble::measurement_result(session_id.clone(), measurement),
                    );
                    notify_ble(
                        &ble,
                        ble::device_status(StatusKind::ResultReady, Some(session_id)),
                    );
                    screen.show(View::Result(measurement));
                }
                Err(error) => {
                    let error_code = ble_error_code(&error);
                    notify_ble(
                        &ble,
                        ble::device_error(Some(session_id.clone()), error_code),
                    );
                    notify_ble(
                        &ble,
                        ble::device_status(StatusKind::Error, Some(session_id)),
                    );
                    screen.show(View::Failed);
                    log::error!("measure failed: error={error}");
                }
            }
        }

        std::thread::sleep(IDLE_POLL);
    }
}

fn notify_ble(ble: &BleService, event: ble::DeviceEvent) {
    if let Err(error) = ble.notify(&event) {
        log::warn!("BLE notify failed: {error}");
    }
}

fn ble_error_code(error: &error::Error) -> ErrorCode {
    match error {
        error::Error::AlcoholDevice(_) => ErrorCode::AlcoholSensor,
        error::Error::PulseDevice(_) => ErrorCode::PulseSensor,
        error::Error::Timeout(_) => ErrorCode::MeasurementTimeout,
        error::Error::Esp(_) => ErrorCode::Protocol,
    }
}
