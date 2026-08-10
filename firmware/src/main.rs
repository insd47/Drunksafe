use embassy_time::{Duration as EmbassyDuration, Timer};
use error::Result;
use esp_idf_svc::hal::task::block_on;
use services::ble::{
    self, BleService, ErrorCode, MeasurementKind, PhoneCommand, Source, StatusKind,
};
use services::measure::{MeasureRun, MeasureService};
use services::screen::{ScreenService, View};
use std::time::Duration;

mod devices;
mod error;
mod services;

const IDLE_POLL: Duration = Duration::from_millis(20);
const MEASUREMENT_CANCEL_POLL: EmbassyDuration = EmbassyDuration::from_millis(20);

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
        let mut phone_start = None;

        while let Some(command) = ble.try_recv_command() {
            match command {
                PhoneCommand::Start { kind } => {
                    phone_start = Some(kind);
                }
                PhoneCommand::Cancel { session_id } => {
                    log::info!("received cancel for session={session_id}");
                }
            }
        }

        let start = if trigger.pressed() {
            Some((Source::BoardButton, MeasurementKind::Measurement))
        } else if let Some(kind) = phone_start {
            Some((Source::Phone, kind))
        } else {
            None
        };

        if let Some((source, kind)) = start {
            session_seq = session_seq.wrapping_add(1);
            let session_id = format!("fw-{session_seq}");

            notify_ble(
                &ble,
                ble::device_status(StatusKind::Measuring, Some(session_id.clone())),
            );
            notify_ble(
                &ble,
                ble::measurement_started(session_id.clone(), source, kind),
            );

            screen.show(View::Measuring);
            let result = block_on(
                measure.run_until_cancelled(wait_for_measurement_cancel(&ble, &session_id)),
            );

            match result {
                Ok(MeasureRun::Completed(measurement)) => {
                    notify_ble(
                        &ble,
                        ble::measurement_result(session_id.clone(), kind, measurement),
                    );
                    notify_ble(
                        &ble,
                        ble::device_status(StatusKind::ResultReady, Some(session_id)),
                    );
                    screen.show(View::Result(measurement));
                }
                Ok(MeasureRun::Cancelled) => {
                    notify_ble(
                        &ble,
                        ble::device_error(Some(session_id.clone()), ErrorCode::Cancelled),
                    );
                    notify_ble(&ble, ble::device_status(StatusKind::Idle, None));
                    screen.show(View::Home);
                    continue;
                }
                Err(error) => {
                    if let Some(error_code) = ble_error_code(&error) {
                        notify_ble(
                            &ble,
                            ble::device_error(Some(session_id.clone()), error_code),
                        );
                    }
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

async fn wait_for_measurement_cancel(ble: &BleService, session_id: &str) {
    loop {
        if measurement_cancel_requested(ble, session_id) {
            return;
        }

        Timer::after(MEASUREMENT_CANCEL_POLL).await;
    }
}

fn measurement_cancel_requested(ble: &BleService, session_id: &str) -> bool {
    let mut cancelled = false;

    while let Some(command) = ble.try_recv_command() {
        match command {
            PhoneCommand::Cancel {
                session_id: cancelled_session_id,
            } if cancelled_session_id == session_id => {
                cancelled = true;
            }
            PhoneCommand::Start { .. } => {
                log::debug!("ignoring phone start while finishing active measurement");
            }
            PhoneCommand::Cancel {
                session_id: cancelled_session_id,
            } => {
                log::debug!("ignoring cancel for inactive session={cancelled_session_id}");
            }
        }
    }

    cancelled
}

fn ble_error_code(error: &error::Error) -> Option<ErrorCode> {
    match error {
        error::Error::AlcoholDevice(_) => Some(ErrorCode::AlcoholSensor),
        error::Error::Timeout(_) => Some(ErrorCode::MeasurementTimeout),
        error::Error::PulseDevice(_) | error::Error::Esp(_) => None,
    }
}
