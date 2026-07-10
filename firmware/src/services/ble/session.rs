use std::time::{Duration, Instant};

use embassy_time::{Duration as EmbassyDuration, Timer};

use super::model::{ErrorCode, MeasurementKind, PhoneCommand, PhoneContext};
use super::service::BleService;

const CONTEXT_WAIT: Duration = Duration::from_secs(5);
const COMMAND_POLL: Duration = Duration::from_millis(20);
const CANCEL_POLL: EmbassyDuration = EmbassyDuration::from_millis(20);

pub fn start(ble: &BleService) -> Option<MeasurementKind> {
    let mut start = None;

    while let Some(command) = ble.receive() {
        match command {
            PhoneCommand::Start { kind } => start = Some(kind),
            command => ignored(command, "idle"),
        }
    }

    start
}

pub fn context(ble: &BleService, session: &str) -> core::result::Result<PhoneContext, ErrorCode> {
    let started = Instant::now();

    while started.elapsed() < CONTEXT_WAIT {
        while let Some(command) = ble.receive() {
            match command {
                PhoneCommand::Context(context) if context.session_id == session => {
                    log::info!("received phone context for session={session}");
                    return Ok(context);
                }
                PhoneCommand::Cancel { session_id } if session_id == session => {
                    log::info!("received cancel for session={session}");
                    return Err(ErrorCode::Cancelled);
                }
                command => ignored(command, "waiting for context"),
            }
        }

        std::thread::sleep(COMMAND_POLL);
    }

    log::warn!("phone context timed out for session={session}");
    Err(ErrorCode::ContextTimeout)
}

pub async fn cancel(ble: &BleService, session: &str) {
    loop {
        if requested(ble, session) {
            return;
        }

        Timer::after(CANCEL_POLL).await;
    }
}

fn requested(ble: &BleService, session: &str) -> bool {
    let mut cancelled = false;

    while let Some(command) = ble.receive() {
        match command {
            PhoneCommand::Cancel { session_id } if session_id == session => cancelled = true,
            command => ignored(command, "measuring"),
        }
    }

    cancelled
}

fn ignored(command: PhoneCommand, state: &str) {
    match command {
        PhoneCommand::Start { .. } => log::debug!("ignoring nested phone start while {state}"),
        PhoneCommand::Context(context) => {
            log::debug!(
                "ignoring context for session={} while {state}",
                context.session_id
            );
        }
        PhoneCommand::Cancel { session_id } => {
            log::debug!("ignoring cancel for session={session_id} while {state}");
        }
        PhoneCommand::Time { unix_time_ms } => {
            log::debug!("received phone time unix_ms={unix_time_ms}");
        }
        PhoneCommand::Ack { session_id } => {
            log::debug!("received result ack for session={session_id}");
        }
    }
}
