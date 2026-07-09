use std::time::{Duration, Instant};

use embassy_time::{Duration as EmbassyDuration, Timer};

use super::{BleService, ErrorCode, MeasurementKind, PhoneCommand, PhoneContext};

const CONTEXT_WAIT: Duration = Duration::from_secs(5);
const COMMAND_POLL: Duration = Duration::from_millis(20);
const CANCEL_POLL: EmbassyDuration = EmbassyDuration::from_millis(20);

pub(crate) enum SessionContext {
    Received(PhoneContext),
    Cancelled,
    TimedOut,
}

impl SessionContext {
    pub fn as_ref(&self) -> Option<&PhoneContext> {
        match self {
            Self::Received(context) => Some(context),
            Self::Cancelled | Self::TimedOut => None,
        }
    }

    pub const fn error_code(&self) -> Option<ErrorCode> {
        match self {
            Self::Received(_) => None,
            Self::Cancelled => Some(ErrorCode::Cancelled),
            Self::TimedOut => Some(ErrorCode::ContextTimeout),
        }
    }
}

impl BleService {
    pub(crate) fn poll_start(&self) -> Option<MeasurementKind> {
        let mut start = None;

        while let Some(command) = self.try_recv_command() {
            match command {
                PhoneCommand::Start { kind } => start = Some(kind),
                PhoneCommand::Context(context) => {
                    log::info!(
                        "received context for inactive session={}",
                        context.session_id
                    );
                }
                PhoneCommand::Cancel { session_id } => {
                    log::info!("received cancel for inactive session={session_id}");
                }
                PhoneCommand::Time { unix_time_ms } => {
                    log::debug!("received phone time unix_ms={unix_time_ms}");
                }
                PhoneCommand::Ack { session_id } => {
                    log::debug!("received result ack for session={session_id}");
                }
            }
        }

        start
    }

    pub(crate) fn wait_for_context(&self, session_id: &str) -> SessionContext {
        let started = Instant::now();

        while started.elapsed() < CONTEXT_WAIT {
            while let Some(command) = self.try_recv_command() {
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
                    command => log_ignored(command, "waiting for context"),
                }
            }

            std::thread::sleep(COMMAND_POLL);
        }

        log::warn!("phone context timed out for session={session_id}");
        SessionContext::TimedOut
    }

    pub(crate) async fn wait_for_cancel(&self, session_id: &str) {
        loop {
            if self.cancel_requested(session_id) {
                return;
            }

            Timer::after(CANCEL_POLL).await;
        }
    }

    fn cancel_requested(&self, session_id: &str) -> bool {
        let mut cancelled = false;

        while let Some(command) = self.try_recv_command() {
            match command {
                PhoneCommand::Cancel {
                    session_id: cancelled_session_id,
                } if cancelled_session_id == session_id => cancelled = true,
                command => log_ignored(command, "finishing active measurement"),
            }
        }

        cancelled
    }
}

fn log_ignored(command: PhoneCommand, state: &str) {
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
