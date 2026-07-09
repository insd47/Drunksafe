use error::Result;
use esp_idf_svc::hal::task::block_on;
use services::ble::{
    self, BleService, ErrorCode, MeasurementKind, MeasurementStep, SessionContext, Source,
    StatusKind,
};
use services::measure::{MeasureRun, MeasureService};
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
        let phone_start = ble.poll_start();
        let start = if trigger.pressed() {
            Some((Source::BoardButton, MeasurementKind::Measurement))
        } else {
            phone_start.map(|kind| (Source::Phone, kind))
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

            let context = match ble.wait_for_context(&session_id) {
                SessionContext::Received(context) => context,
                SessionContext::Cancelled => {
                    notify_ble(
                        &ble,
                        ble::device_error(Some(session_id.clone()), ErrorCode::Cancelled),
                    );
                    notify_ble(&ble, ble::device_status(StatusKind::Idle, None));
                    screen.show(View::Home);
                    continue;
                }
                SessionContext::TimedOut => {
                    notify_ble(
                        &ble,
                        ble::device_error(Some(session_id.clone()), ErrorCode::ContextTimeout),
                    );
                    notify_ble(&ble, ble::device_status(StatusKind::Idle, None));
                    screen.show(View::Failed);
                    continue;
                }
            };

            notify_progress(&ble, &session_id, MeasurementStep::Preparing);
            notify_progress(&ble, &session_id, MeasurementStep::WarmingSensor);
            notify_progress(&ble, &session_id, MeasurementStep::WaitingBreath);
            notify_progress(&ble, &session_id, MeasurementStep::SamplingBreath);
            notify_progress(&ble, &session_id, MeasurementStep::SamplingPulse);

            screen.show(View::Measuring);
            let result = block_on(measure.run_until_cancelled(ble.wait_for_cancel(&session_id)));

            match result {
                Ok(MeasureRun::Completed(measurement)) => {
                    notify_progress(&ble, &session_id, MeasurementStep::Analyzing);
                    notify_progress(&ble, &session_id, MeasurementStep::Done);
                    notify_ble(
                        &ble,
                        ble::measurement_result(
                            session_id.clone(),
                            kind,
                            measurement,
                            Some(&context),
                        ),
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
                    let error_code = ble::error_code(&error);
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

fn notify_progress(ble: &BleService, session_id: &str, step: MeasurementStep) {
    notify_ble(ble, ble::measurement_progress(session_id.to_owned(), step));
}
