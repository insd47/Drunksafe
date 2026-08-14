use devices::pulse::PulseUnavailableReason;
use devices::{ButtonEvent, TriggerDevice};
use embassy_time::{Duration as EmbassyDuration, Timer};
use error::Result;
use esp_idf_svc::hal::task::block_on;
use services::ble::{
    self, BleService, ErrorCode, MeasurementKind, PhoneCommand, Source, StatusKind,
};
use services::measure::{Measurement, MeasureService, PhaseRun, PulseOutcome};
use services::screen::{ScreenService, View};
use services::session;
use std::time::Duration;

mod devices;
mod error;
mod services;

const IDLE_POLL: Duration = Duration::from_millis(20);
const MEASUREMENT_CANCEL_POLL: EmbassyDuration = EmbassyDuration::from_millis(20);
const PPG_BATCH_SAMPLES: usize = 20;
const PPG_SAMPLE_PERIOD_MS: u16 = 10;

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
    let mut buzzer = devices.buzzer;
    let mut session_seq = 0_u32;

    // 부팅 자가 진단: 부저 배선(GPIO27, active-low)이 맞으면 짧게 한 번 울린다.
    if let Err(error) = buzzer.beep(80) {
        log::warn!("buzzer self-test failed: {error}");
    }
    // 결과/실패 화면에 머무는 동안에만 GPIO0 길게 누르기로 대기 화면에 복귀시킨다.
    let mut on_result_screen = false;

    log::debug!("firmware devices initialized");
    screen.show(View::Home);
    notify_ble(&ble, ble::device_status(StatusKind::Idle, None));

    loop {
        let button = trigger.poll();

        // 결과 화면에서 길게 누르면 대기 화면으로 복귀하고, 연결이 없으면 다시 advertising한다.
        if button == ButtonEvent::LongPress && on_result_screen {
            log::info!("long-press on result screen: returning to home");
            screen.show(View::Home);
            on_result_screen = false;
            notify_ble(&ble, ble::device_status(StatusKind::Idle, None));

            if !ble.is_connected() {
                if let Err(error) = ble.ensure_advertising() {
                    log::warn!("failed to restart advertising after returning to home: {error:?}");
                }
            }

            std::thread::sleep(IDLE_POLL);
            continue;
        }

        let mut phone_start = None;
        let mut phone_pulse_stream = None;
        let mut phone_session: Option<Option<u16>> = None;
        let mut phone_alcohol_track = false;

        while let Some(command) = ble.try_recv_command() {
            match command {
                PhoneCommand::Start { kind } => {
                    phone_start = Some(kind);
                }
                PhoneCommand::Cancel { session_id } => {
                    log::info!("received cancel for session={session_id}");
                }
                PhoneCommand::StartPulseStream { stream_raw } => {
                    phone_pulse_stream = Some(stream_raw);
                }
                PhoneCommand::StopPulseStream => {
                    log::debug!("ignoring stop_pulse_stream while idle");
                }
                PhoneCommand::StartPulsePhase { session_id } => {
                    log::debug!("ignoring start_pulse_phase while idle: session={session_id}");
                }
                PhoneCommand::StartSession { resting_bpm } => {
                    phone_session = Some(resting_bpm);
                }
                PhoneCommand::StartAlcoholTrack => {
                    phone_alcohol_track = true;
                }
                PhoneCommand::EndSession => {
                    log::debug!("ignoring end_session while idle");
                }
            }
        }

        if let Some(stream_raw) = phone_pulse_stream {
            run_pulse_stream(&ble, &mut measure, &mut screen, &mut session_seq, stream_raw);
            on_result_screen = false;
            std::thread::sleep(IDLE_POLL);
            continue;
        }

        if let Some(resting_bpm) = phone_session {
            session_seq = session_seq.wrapping_add(1);
            let session_id = format!("fw-session-{session_seq}");
            session::run(
                &ble,
                &mut measure,
                &mut buzzer,
                &mut screen,
                &mut trigger,
                session_id,
                resting_bpm,
            );
            notify_ble(&ble, ble::device_status(StatusKind::Idle, None));
            on_result_screen = false;
            std::thread::sleep(IDLE_POLL);
            continue;
        }

        if phone_alcohol_track {
            session_seq = session_seq.wrapping_add(1);
            let session_id = format!("fw-alctrack-{session_seq}");
            session::run_alcohol_track(
                &ble,
                &mut measure,
                &mut buzzer,
                &mut screen,
                &mut trigger,
                session_id,
            );
            notify_ble(&ble, ble::device_status(StatusKind::Idle, None));
            on_result_screen = false;
            std::thread::sleep(IDLE_POLL);
            continue;
        }

        let start = if button == ButtonEvent::ShortPress {
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

            // 1단계: 알코올만 측정한다 (pulse 센서는 착용만). 실패하면 pulse 없이 실패 화면.
            // ZE29A 상태를 앱에 흘려보내 "예열 중 / 지금 부세요" 타이밍을 안내한다.
            screen.show(View::Measuring);
            let on_alcohol_state = |status| {
                notify_ble(&ble, ble::alcohol_state(session_id.clone(), status));
            };
            let alcohol = match block_on(measure.run_alcohol_until_cancelled(
                wait_for_measurement_cancel(&ble, &session_id),
                on_alcohol_state,
            )) {
                Ok(PhaseRun::Completed(value)) => value,
                Ok(PhaseRun::Cancelled) => {
                    finish_cancelled(&ble, &mut screen, &session_id);
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
                    on_result_screen = true;
                    log::error!("alcohol phase failed: error={error}");
                    std::thread::sleep(IDLE_POLL);
                    continue;
                }
            };

            // 알코올 측정 완료 → 사용자가 앱/보드 버튼으로 심박 측정 시작을 지시할 때까지 대기.
            notify_ble(
                &ble,
                ble::device_status(StatusKind::AwaitingPulse, Some(session_id.clone())),
            );
            screen.show(View::AwaitingPulse);
            if let PulsePhaseSignal::Cancel =
                wait_for_pulse_phase(&ble, &session_id, &mut trigger)
            {
                finish_cancelled(&ble, &mut screen, &session_id);
                continue;
            }

            // 2단계: pulse 측정 (1분). 실패해도 알코올 결과는 그대로 보여준다.
            notify_ble(
                &ble,
                ble::device_status(StatusKind::Measuring, Some(session_id.clone())),
            );
            screen.show(View::PulseStream);
            let pulse = match block_on(
                measure.run_pulse_until_cancelled(wait_for_measurement_cancel(&ble, &session_id)),
            ) {
                Ok(PhaseRun::Completed(outcome)) => outcome,
                Ok(PhaseRun::Cancelled) => {
                    finish_cancelled(&ble, &mut screen, &session_id);
                    continue;
                }
                Err(error) => {
                    log::warn!("pulse phase hardware error, reporting alcohol only: error={error}");
                    PulseOutcome::Unavailable {
                        reason: PulseUnavailableReason::NoSignal,
                    }
                }
            };

            let measurement = Measurement::new(alcohol, pulse);
            notify_ble(
                &ble,
                ble::measurement_result(session_id.clone(), kind, measurement),
            );
            notify_ble(
                &ble,
                ble::device_status(StatusKind::ResultReady, Some(session_id)),
            );
            screen.show(View::Result(measurement));
            on_result_screen = true;
        }

        std::thread::sleep(IDLE_POLL);
    }
}

/// 측정 세션이 취소됐을 때 앱에 알리고 대기 화면으로 돌아간다.
fn finish_cancelled(ble: &BleService, screen: &mut ScreenService<'_>, session_id: &str) {
    notify_ble(
        ble,
        ble::device_error(Some(session_id.to_string()), ErrorCode::Cancelled),
    );
    notify_ble(ble, ble::device_status(StatusKind::Idle, None));
    screen.show(View::Home);
}

/// 알코올 측정 완료 후 심박 측정 단계로 넘어갈지(사용자 버튼/앱 명령) 아니면 취소할지를 기다린다.
enum PulsePhaseSignal {
    Proceed,
    Cancel,
}

fn wait_for_pulse_phase(
    ble: &BleService,
    session_id: &str,
    trigger: &mut TriggerDevice,
) -> PulsePhaseSignal {
    loop {
        if trigger.poll() == ButtonEvent::ShortPress {
            return PulsePhaseSignal::Proceed;
        }

        while let Some(command) = ble.try_recv_command() {
            match command {
                PhoneCommand::StartPulsePhase {
                    session_id: requested,
                } if requested == session_id => {
                    return PulsePhaseSignal::Proceed;
                }
                PhoneCommand::Cancel {
                    session_id: requested,
                } if requested == session_id => {
                    return PulsePhaseSignal::Cancel;
                }
                other => {
                    log::debug!("ignoring command while awaiting pulse phase: {other:?}");
                }
            }
        }

        // 대기 중 휴대폰 연결이 끊기면 세션을 접는다.
        if !ble.is_connected() {
            return PulsePhaseSignal::Cancel;
        }

        std::thread::sleep(IDLE_POLL);
    }
}

/// 알코올을 빼고 pulse raw/진단만 실시간 스트리밍한다 (개발자 도구). 정지 명령이나
/// 연결 해제로 끝나면 대기 화면으로 돌아간다.
fn run_pulse_stream(
    ble: &BleService,
    measure: &mut MeasureService<'_>,
    screen: &mut ScreenService<'_>,
    session_seq: &mut u32,
    stream_raw: bool,
) {
    *session_seq = session_seq.wrapping_add(1);
    let session_id = format!("fw-pulse-{session_seq}");

    notify_ble(
        ble,
        ble::device_status(StatusKind::Measuring, Some(session_id.clone())),
    );
    screen.show(View::PulseStream);

    // raw 파형은 앱이 명시적으로 요청한 경우에만 전송한다 (BPM reading은 항상 전송).
    let mut ppg_batch: Vec<u16> = Vec::with_capacity(PPG_BATCH_SAMPLES);
    let mut ppg_batch_t0_ms: Option<u32> = None;
    let on_ppg_sample = |elapsed_ms: u32, raw: u16| {
        if !stream_raw {
            return;
        }

        if ppg_batch_t0_ms.is_none() {
            ppg_batch_t0_ms = Some(elapsed_ms);
        }

        ppg_batch.push(raw);

        if ppg_batch.len() >= PPG_BATCH_SAMPLES {
            let t0_ms = ppg_batch_t0_ms.take().unwrap_or(elapsed_ms);
            let samples = std::mem::take(&mut ppg_batch);
            notify_ble(
                ble,
                ble::ppg_sample_batch(session_id.clone(), t0_ms, PPG_SAMPLE_PERIOD_MS, samples),
            );
        }
    };
    let on_reading = |elapsed_ms, diagnosis| {
        notify_ble(ble, ble::pulse_reading(session_id.clone(), elapsed_ms, diagnosis));
    };

    if let Err(error) = block_on(measure.run_pulse_stream(
        wait_for_pulse_stream_stop(ble),
        on_ppg_sample,
        on_reading,
    )) {
        log::error!("pulse stream failed: error={error}");
    }

    notify_ble(ble, ble::device_status(StatusKind::Idle, None));
    screen.show(View::Home);
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
            PhoneCommand::Start { .. }
            | PhoneCommand::StartPulseStream { .. }
            | PhoneCommand::StartPulsePhase { .. }
            | PhoneCommand::StartSession { .. }
            | PhoneCommand::StartAlcoholTrack
            | PhoneCommand::EndSession => {
                log::debug!("ignoring start/session command while finishing active measurement");
            }
            PhoneCommand::Cancel {
                session_id: cancelled_session_id,
            } => {
                log::debug!("ignoring cancel for inactive session={cancelled_session_id}");
            }
            PhoneCommand::StopPulseStream => {
                log::debug!("ignoring stop_pulse_stream during measurement");
            }
        }
    }

    cancelled
}

/// pulse 스트리밍을 멈춰야 하는지 확인한다 — 정지/취소 명령이 오거나 연결이 끊기면 멈춘다.
async fn wait_for_pulse_stream_stop(ble: &BleService) {
    loop {
        if pulse_stream_stop_requested(ble) || !ble.is_connected() {
            return;
        }

        Timer::after(MEASUREMENT_CANCEL_POLL).await;
    }
}

fn pulse_stream_stop_requested(ble: &BleService) -> bool {
    let mut stop = false;

    while let Some(command) = ble.try_recv_command() {
        match command {
            PhoneCommand::StopPulseStream => {
                stop = true;
            }
            PhoneCommand::Cancel { session_id } => {
                log::debug!("cancel during pulse stream: session={session_id}");
                stop = true;
            }
            PhoneCommand::Start { .. }
            | PhoneCommand::StartPulseStream { .. }
            | PhoneCommand::StartPulsePhase { .. }
            | PhoneCommand::StartSession { .. }
            | PhoneCommand::StartAlcoholTrack
            | PhoneCommand::EndSession => {
                log::debug!("ignoring start/session command during pulse stream");
            }
        }
    }

    stop
}

fn ble_error_code(error: &error::Error) -> Option<ErrorCode> {
    match error {
        error::Error::AlcoholDevice(_) => Some(ErrorCode::AlcoholSensor),
        error::Error::Timeout(_) => Some(ErrorCode::MeasurementTimeout),
        error::Error::PulseDevice(_) | error::Error::Esp(_) => None,
    }
}
