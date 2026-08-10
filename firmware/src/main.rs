use embassy_time::{Duration as EmbassyDuration, Timer};
use error::Result;
use esp_idf_svc::hal::task::block_on;
use services::ble::{
    self, BleService, ErrorCode, MeasurementKind, MeasurementStep, PhoneCommand, PhoneContext,
    Source, StatusKind, MEASUREMENT_PROGRESS_PLAN,
};
use services::measure::{MeasureRun, MeasureService};
use services::screen::{ScreenService, View};
use std::time::{Duration, Instant};

mod devices;
mod error;
mod services;

const IDLE_POLL: Duration = Duration::from_millis(20);
const CONTEXT_WAIT: Duration = Duration::from_secs(5);
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

            let context = wait_for_context(&ble, &session_id);

            if matches!(
                context,
                SessionContext::Cancelled | SessionContext::TimedOut
            ) {
                let error_code = match context {
                    SessionContext::Cancelled => ErrorCode::Cancelled,
                    SessionContext::TimedOut => ErrorCode::ContextTimeout,
                    SessionContext::Received(_) => unreachable!(),
                };

                notify_ble(
                    &ble,
                    ble::device_error(Some(session_id.clone()), error_code),
                );
                notify_ble(&ble, ble::device_status(StatusKind::Idle, None));
                screen.show(View::Failed);
                continue;
            }

            notify_progress(&ble, &session_id, MeasurementStep::Preparing);
            notify_progress(&ble, &session_id, MeasurementStep::WarmingSensor);
            notify_progress(&ble, &session_id, MeasurementStep::WaitingBreath);
            notify_progress(&ble, &session_id, MeasurementStep::SamplingBreath);
            notify_progress(&ble, &session_id, MeasurementStep::SamplingPulse);

            screen.show(View::Measuring);
            let result = block_on(
                measure.run_until_cancelled(wait_for_measurement_cancel(&ble, &session_id)),
            );

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
                            context.as_ref(),
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

fn notify_progress(ble: &BleService, session_id: &str, step: MeasurementStep) {
    let percent = progress_percent(step);
    notify_ble(
        ble,
        ble::measurement_progress(session_id.to_owned(), step, percent),
    );
}

fn progress_percent(step: MeasurementStep) -> u8 {
    MEASUREMENT_PROGRESS_PLAN
        .iter()
        .find_map(|(candidate, percent)| (*candidate == step).then_some(*percent))
        .unwrap_or(0)
}

enum SessionContext {
    Received(PhoneContext),
    Cancelled,
    TimedOut,
}

impl SessionContext {
    fn as_ref(&self) -> Option<&PhoneContext> {
        match self {
            Self::Received(context) => Some(context),
            Self::Cancelled | Self::TimedOut => None,
        }
    }
}

fn wait_for_context(ble: &BleService, session_id: &str) -> SessionContext {
    let started = Instant::now();

    while started.elapsed() < CONTEXT_WAIT {
        while let Some(command) = ble.try_recv_command() {
            match command {
                PhoneCommand::Context(context) if context.session_id == session_id => {
                    log::info!("received phone context for session={session_id}");
                    return SessionContext::Received(context);
                }
                PhoneCommand::Cancel {
                    session_id: cancelled_session_id,
                } if cancelled_session_id == session_id => {
                    log::info!("received cancel for session={session_id}");
                    return SessionContext::Cancelled;
                }
                PhoneCommand::Time { unix_time_ms } => {
                    log::debug!("received phone time unix_ms={unix_time_ms}");
                }
                PhoneCommand::Start { .. } => {
                    log::debug!("ignoring nested phone start while waiting for context");
                }
                PhoneCommand::Context(context) => {
                    log::debug!(
                        "ignoring context for inactive session={}",
                        context.session_id
                    );
                }
                PhoneCommand::Cancel {
                    session_id: cancelled_session_id,
                } => {
                    log::debug!("ignoring cancel for inactive session={cancelled_session_id}");
                }
                PhoneCommand::Ack { session_id } => {
                    log::debug!("received result ack for session={session_id}");
                }
            }
        }

        std::thread::sleep(IDLE_POLL);
    }

    log::warn!("phone context timed out for session={session_id}");
    SessionContext::TimedOut
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
            PhoneCommand::Time { unix_time_ms } => {
                log::debug!("received phone time unix_ms={unix_time_ms}");
            }
            PhoneCommand::Ack { session_id } => {
                log::debug!("received result ack for session={session_id}");
            }
            PhoneCommand::Start { .. } => {
                log::debug!("ignoring phone start while finishing active measurement");
            }
            PhoneCommand::Context(context) => {
                log::debug!("ignoring late context for session={}", context.session_id);
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
