//! 음주 세션(3단계 적응형 스케줄)을 ESP32에서 자율적으로 실행한다.
//!
//! DORMANT(안정 HR R0 학습 + 30분마다 알코올 음성 확인) → PROBE(HR 상승 감지 시 부저
//! + 사용자 확인) → TRACK(양성 후 15분마다 dense 알코올 측정, 하강 곡선용). 로그는 RAM에
//! 타임스탬프와 함께 쌓았다가 세션 종료(앱 EndSession) 시 다운로드로 스트리밍한다.
//! 폰은 세션 동안 꺼져 있어도 되며, 종료 시 앱을 켜서 연결하면 데이터를 받는다.

use crate::devices::pulse::Diagnosis;
use crate::devices::{ButtonEvent, BuzzerDevice, TriggerDevice};
use crate::services::ble::{self, BleService, PhoneCommand, SessionRecordKind, SessionStateLabel};
use crate::services::measure::MeasureService;
use crate::services::screen::{ScreenService, View};
use esp_idf_svc::hal::delay::FreeRtos;
use esp_idf_svc::hal::task::block_on;
use std::collections::VecDeque;
use std::time::{Duration, Instant};

mod hr_rise;

/// Fixed one-minute HR monitoring driven by the common pulse engine.
#[allow(clippy::too_many_arguments)]
pub fn run_hr_watch(
    ble: &BleService,
    measure: &mut MeasureService<'_>,
    buzzer: &mut BuzzerDevice,
    screen: &mut ScreenService<'_>,
    trigger: &mut TriggerDevice,
    session_id: String,
    resting_bpm: u16,
) {
    // App has already applied the same 60..=90 resting-baseline rule.
    if !(60..=90).contains(&resting_bpm) {
        log::warn!("HR watch requires a valid app resting baseline");
        return;
    }
    let start = Instant::now();
    let mut detector = hr_rise::HrRise::new(resting_bpm);
    let mut state = SessionStateLabel::Dormant;
    let mut log = vec![state_entry(0, state)];
    let mut last_bpm = None;
    let mut last_report_ms = u32::MAX;
    let mut last_reported_phase: Option<&'static str> = None;
    let mut last_reported_state: Option<SessionStateLabel> = None;
    let mut next_sample = Instant::now();
    let mut disconnect_alerted = false;
    let mut pending_alcohol_triggers = VecDeque::new();
    measure.reset_hr_monitor();
    screen.show(View::Session);

    loop {
        alert_disconnect_once(ble, buzzer, &mut disconnect_alerted);
        match hr_watch_command(ble) {
            HrWatchCommand::End => break,
            HrWatchCommand::MeasureAlcohol => {
                run_requested_hr_watch_alcohol(
                    ble,
                    measure,
                    buzzer,
                    screen,
                    start,
                    &mut log,
                    &session_id,
                    &mut pending_alcohol_triggers,
                    &mut state,
                );
            }
            HrWatchCommand::None => {}
        }
        match trigger.poll() {
            ButtonEvent::LongPress => break,
            ButtonEvent::ShortPress if !pending_alcohol_triggers.is_empty() => {
                run_requested_hr_watch_alcohol(
                    ble,
                    measure,
                    buzzer,
                    screen,
                    start,
                    &mut log,
                    &session_id,
                    &mut pending_alcohol_triggers,
                    &mut state,
                );
            }
            ButtonEvent::ShortPress | ButtonEvent::None => {}
        }
        let now = elapsed_ms(start);
        if let Err(error) = measure.sample_hr_monitor(now) {
            log::warn!("session pulse sample failed: {error}");
        }
        while let Some(slot) = measure.take_hr_slot() {
            last_bpm = slot.bpm.map(|bpm| bpm.round() as u16);
            if let Some(bpm) = last_bpm {
                log.push(heart_entry((slot.index + 1).saturating_mul(60_000), bpm));
            }
            if slot.alert_missed {
                // Two consecutive failed fixed minutes: re-wear warning.
                let _ = buzzer.beep_pattern(2, 180, 120);
            }
            if let Some(percent) = detector.close_minute(slot.bpm) {
                pending_alcohol_triggers.push_back(percent);
                if state != SessionStateLabel::Probe {
                    state = SessionStateLabel::Probe;
                    log.push(state_entry(now, state));
                }
                // 권장 시점만 알린다. 실제 ZE29A 측정은 GPIO0 또는 앱 명령을 기다린다.
                let _ = buzzer.beep_pattern(2, 250, 150);
                log::info!("alcohol measurement recommended at baseline +{percent}%");
                screen.show(View::SessionConfirm);
            }
        }
        let diagnosis = measure.hr_diagnosis();
        let acquiring = matches!(diagnosis.phase, "warmup" | "collecting");
        let entered_acquisition =
            acquiring && !matches!(last_reported_phase, Some("warmup" | "collecting"));
        // Send real device-side acquisition progress at least every five seconds.
        // This survives app screen changes and avoids relying only on a local UI timer.
        let due = last_report_ms == u32::MAX || now.saturating_sub(last_report_ms) >= 5_000;
        let should_report = entered_acquisition
            || due
            || last_reported_state != Some(state)
            || (!acquiring && last_reported_phase != Some(diagnosis.phase));
        if should_report {
            last_report_ms = now;
            last_reported_phase = Some(diagnosis.phase);
            last_reported_state = Some(state);
            notify_event(ble, ble::pulse_reading(session_id.clone(), now, diagnosis));
            let trend = detector.trend();
            notify_event(
                ble,
                ble::session_hr_status(
                    session_id.clone(),
                    state,
                    now,
                    log.len().min(u16::MAX as usize) as u16,
                    resting_bpm,
                    last_bpm,
                    trend.valid,
                    trend.high,
                    trend.next_percent,
                    trend.alerted_percent,
                ),
            );
        }
        if log.len() >= MAX_RECORDS - 1 {
            break;
        }
        next_sample += Duration::from_millis(10);
        let now_instant = Instant::now();
        if now_instant > next_sample
            && now_instant.duration_since(next_sample) > Duration::from_millis(100)
        {
            next_sample = now_instant + Duration::from_millis(10);
        }
        freertos_delay(next_sample.saturating_duration_since(Instant::now()));
    }
    log.push(state_entry(elapsed_ms(start), state));
    stream_log(ble, &session_id, &log);
    screen.show(home_view(ble));
}

#[allow(clippy::too_many_arguments)]
fn run_requested_hr_watch_alcohol(
    ble: &BleService,
    measure: &mut MeasureService<'_>,
    buzzer: &mut BuzzerDevice,
    screen: &mut ScreenService<'_>,
    start: Instant,
    log: &mut Vec<LogEntry>,
    session_id: &str,
    pending_triggers: &mut VecDeque<u16>,
    state: &mut SessionStateLabel,
) {
    let trigger_percent = pending_triggers.pop_front();

    // 심박 트리거는 이미 권장 시점에 두 번 울렸다. 트리거 없는 자유 측정만
    // 시작 확인음을 내고, 두 경우 모두 WaitBlow에서 다시 두 번 울린다.
    if trigger_percent.is_none() {
        let _ = buzzer.beep_pattern(2, 120, 120);
    }
    let measured = measure_hr_watch_alcohol(
        ble,
        measure,
        buzzer,
        screen,
        start,
        log,
        session_id,
        trigger_percent,
    );

    let next_state = if pending_triggers.is_empty() {
        SessionStateLabel::Dormant
    } else {
        SessionStateLabel::Probe
    };
    if *state != next_state {
        *state = next_state;
        log.push(state_entry(elapsed_ms(start), next_state));
    }
    screen.show(if measured {
        View::CheckApp
    } else if pending_triggers.is_empty() {
        View::Session
    } else {
        View::SessionConfirm
    });
}

enum HrWatchCommand {
    None,
    End,
    MeasureAlcohol,
}

fn hr_watch_command(ble: &BleService) -> HrWatchCommand {
    let mut requested = HrWatchCommand::None;
    while let Some(command) = ble.try_recv_command() {
        match command {
            PhoneCommand::EndSession => requested = HrWatchCommand::End,
            PhoneCommand::MeasureSessionAlcohol if !matches!(requested, HrWatchCommand::End) => {
                requested = HrWatchCommand::MeasureAlcohol;
            }
            other => log::debug!("ignoring command during HR watch: {other:?}"),
        }
    }
    requested
}

#[allow(clippy::too_many_arguments)]
fn measure_hr_watch_alcohol(
    ble: &BleService,
    measure: &mut MeasureService<'_>,
    buzzer: &mut BuzzerDevice,
    screen: &mut ScreenService<'_>,
    start: Instant,
    log: &mut Vec<LogEntry>,
    session_id: &str,
    trigger_percent: Option<u16>,
) -> bool {
    screen.show(View::Measuring);
    let alcohol_session_id = session_id.to_owned();
    let result = block_on(measure.measure_session_alcohol(buzzer, |status| {
        notify_event(ble, ble::alcohol_state(alcohol_session_id.clone(), status));
    }));
    let measured_at = elapsed_ms(start);
    let value = match result {
        Ok(value) => {
            log.push(alcohol_entry(measured_at, value));
            Some(value)
        }
        Err(error) => {
            log::warn!("session alcohol measurement failed: {error}");
            None
        }
    };
    notify_event(
        ble,
        ble::session_alcohol_result(session_id.to_owned(), measured_at, trigger_percent, value),
    );
    value.is_some()
}

// --- 튜닝 상수 (기본값) ---
/// HR 1건을 추정하기 위해 pulse를 샘플링하는 시간이다.
const HR_BURST: embassy_time::Duration = embassy_time::Duration::from_secs(25);
/// 세션 루프의 최소 간격이다.
const SESSION_TICK: Duration = Duration::from_millis(500);
/// DORMANT에서 알코올 음성 확인 주기다.
const DORMANT_ALCOHOL_INTERVAL: Duration = Duration::from_secs(30 * 60);
/// TRACK에서 하강 곡선을 위한 dense 알코올 측정 주기다.
const TRACK_ALCOHOL_INTERVAL: Duration = Duration::from_secs(15 * 60);
/// 개인 지수 감쇠 fitting 세션의 측정 알림 간격이다.
const FITTING_ALCOHOL_INTERVAL: Duration = Duration::from_secs(10 * 60);
/// PROBE 단계에서 사용자 확인을 기다리는 최대 시간이다.
const PROBE_MAX: Duration = Duration::from_secs(10 * 60);
/// BPM 이동평균이 resting baseline 대비 이만큼 오르면 "상승"으로 본다.
const HR_RISE_DELTA_BPM: f32 = 12.0;
/// BPM 이동평균 window(2분). 이 안의 "안정" 표본만 평균한다.
const HR_MA_WINDOW_MS: u32 = 2 * 60 * 1000;
/// 이동평균이 상승 임계값을 넘어 이만큼(3분) 지속돼야 PROBE로 넘어간다 (단발 스파이크 무시).
const HR_RISE_SUSTAIN: Duration = Duration::from_secs(3 * 60);
/// 이동평균을 신뢰하기 위한 최소 표본 수.
const HR_MA_MIN_SAMPLES: usize = 3;
/// 상승하지 않는(쉬는) 구간에서만 resting baseline을 느리게 갱신하는 EMA 계수.
const HR_BASELINE_ALPHA: f32 = 0.1;
/// 알코올 양성 판정 임계값(mg/L ×1000)이다.
const ALCOHOL_POSITIVE_MG_L_X1000: u16 = 50;
/// 생리학적으로 유효하다고 볼 BPM 범위다.
const HR_MIN_BPM: f32 = 40.0;
const HR_MAX_BPM: f32 = 180.0;
/// RAM 로그 상한이다.
const MAX_RECORDS: usize = 2000;

struct LogEntry {
    t_ms: u32,
    kind: SessionRecordKind,
    state: Option<SessionStateLabel>,
    mg_l_x1000: Option<u16>,
    bpm: Option<u16>,
}

enum ProbeOutcome {
    Track,
    Dormant,
    End,
}

/// 세션을 실행한다. 앱의 EndSession(또는 보드 버튼 길게)으로 끝나면 로그를 스트리밍한다.
#[allow(clippy::too_many_arguments)]
pub fn run(
    ble: &BleService,
    measure: &mut MeasureService<'_>,
    buzzer: &mut BuzzerDevice,
    screen: &mut ScreenService<'_>,
    trigger: &mut TriggerDevice,
    session_id: String,
    resting_bpm: Option<u16>,
) {
    let start = Instant::now();
    let mut log: Vec<LogEntry> = Vec::new();
    let mut state = SessionStateLabel::Dormant;
    // 앱 기준값 측정에서 얻은 resting HR이 있으면 baseline 초기값으로 쓴다(없으면 세션 중 학습).
    let mut baseline: Option<f32> = resting_bpm.map(f32::from);
    let mut hr_samples: VecDeque<(u32, f32)> = VecDeque::new();
    let mut rise_since: Option<Instant> = None;
    let mut last_bpm: Option<u16> = None;
    let mut next_alcohol = start + DORMANT_ALCOHOL_INTERVAL;
    let mut disconnect_alerted = false;

    log.push(state_entry(0, state));
    screen.show(View::FittingWaiting);
    log::info!("session started: id={session_id}");
    let _ = buzzer.beep(80);

    loop {
        alert_disconnect_once(ble, buzzer, &mut disconnect_alerted);
        screen.show(View::Session);

        // A) HR 추정 → BPM 이동평균의 "지속 상승"으로만 PROBE 트리거 (단발 노이즈 무시)
        if let Ok(diag) = block_on(measure.sample_hr(HR_BURST)) {
            if valid_bpm(&diag) {
                let now_ms = elapsed_ms(start);
                last_bpm = Some(diag.bpm.round() as u16);
                log.push(heart_entry(now_ms, diag.bpm.round() as u16));

                // 불안정 표본은 이동평균 window에 넣지 않는다 — 노이즈로 인한 오검출 방지.
                if diag.stable {
                    hr_samples.push_back((now_ms, diag.bpm));
                    while hr_samples
                        .front()
                        .is_some_and(|&(t, _)| now_ms.saturating_sub(t) > HR_MA_WINDOW_MS)
                    {
                        hr_samples.pop_front();
                    }

                    if state == SessionStateLabel::Dormant && hr_samples.len() >= HR_MA_MIN_SAMPLES
                    {
                        let moving_avg = moving_average(&hr_samples);
                        let elevated =
                            baseline.is_some_and(|base| moving_avg >= base + HR_RISE_DELTA_BPM);

                        if elevated {
                            let since = *rise_since.get_or_insert_with(Instant::now);

                            if since.elapsed() >= HR_RISE_SUSTAIN {
                                state = SessionStateLabel::Probe;
                                log.push(state_entry(now_ms, state));
                                rise_since = None;

                                match run_probe(
                                    ble,
                                    measure,
                                    buzzer,
                                    screen,
                                    trigger,
                                    start,
                                    &mut log,
                                    &session_id,
                                ) {
                                    ProbeOutcome::Track => {
                                        state = SessionStateLabel::Track;
                                        log.push(state_entry(elapsed_ms(start), state));
                                        next_alcohol = Instant::now();
                                    }
                                    ProbeOutcome::Dormant => {
                                        state = SessionStateLabel::Dormant;
                                        log.push(state_entry(elapsed_ms(start), state));
                                    }
                                    ProbeOutcome::End => break,
                                }
                            }
                        } else {
                            // 상승이 끊기면 지속 타이머를 리셋하고, 쉬는 구간에서만 baseline을 갱신한다.
                            rise_since = None;
                            baseline = Some(match baseline {
                                Some(base) => {
                                    base * (1.0 - HR_BASELINE_ALPHA)
                                        + moving_avg * HR_BASELINE_ALPHA
                                }
                                None => moving_avg,
                            });
                        }
                    }
                }
            }
        }

        notify_status(
            ble,
            &session_id,
            state,
            elapsed_ms(start),
            log.len(),
            baseline,
            last_bpm,
        );

        // B) 예약된 알코올 측정
        if Instant::now() >= next_alcohol {
            if let Some(value) = measure_alcohol_step(measure, buzzer, screen, start, &mut log) {
                if value >= ALCOHOL_POSITIVE_MG_L_X1000 && state != SessionStateLabel::Track {
                    state = SessionStateLabel::Track;
                    log.push(state_entry(elapsed_ms(start), state));
                }
            }

            next_alcohol = Instant::now()
                + if state == SessionStateLabel::Track {
                    TRACK_ALCOHOL_INTERVAL
                } else {
                    DORMANT_ALCOHOL_INTERVAL
                };
        }

        // C) 종료 — 앱 EndSession이 주 경로, 보드 버튼 길게는 보조.
        if end_requested(ble) || trigger.poll() == ButtonEvent::LongPress {
            break;
        }

        if log.len() >= MAX_RECORDS {
            log::warn!("session log full ({MAX_RECORDS}), ending");
            break;
        }

        freertos_delay(SESSION_TICK);
    }

    log::info!("session ending: streaming {} records", log.len());
    stream_log(ble, &session_id, &log);
    screen.show(home_view(ble));
}

/// Fitting 세션: 심박 없이 10분마다 측정 시점을 알리고 GPIO0/앱 확인 후 측정한다.
pub fn run_alcohol_track(
    ble: &BleService,
    measure: &mut MeasureService<'_>,
    buzzer: &mut BuzzerDevice,
    screen: &mut ScreenService<'_>,
    trigger: &mut TriggerDevice,
    session_id: String,
) {
    let start = Instant::now();
    let mut log: Vec<LogEntry> = Vec::new();
    let state = SessionStateLabel::Track;
    let mut next_slot = Instant::now();
    let mut slot_deadline = next_slot + FITTING_ALCOHOL_INTERVAL;
    let mut measurement_due = false;
    let mut failed_attempts = 0_u8;
    let mut disconnect_alerted = false;

    log.push(state_entry(0, state));
    screen.show(View::Session);
    log::info!("alcohol-track session started: id={session_id}");
    let _ = buzzer.beep(80);

    loop {
        if Instant::now() >= next_slot && !measurement_due {
            measurement_due = true;
            failed_attempts = 0;
            slot_deadline = next_slot + FITTING_ALCOHOL_INTERVAL;
            next_slot += FITTING_ALCOHOL_INTERVAL;
            let _ = buzzer.beep(250);
            screen.show(View::FittingConfirm);
        }

        if measurement_due && Instant::now() >= slot_deadline {
            log.push(alcohol_missed_entry(elapsed_ms(start)));
            measurement_due = false;
            screen.show(View::FittingSlotMissed);
        }

        let command = fitting_command(ble);
        let button = trigger.poll();
        if matches!(command, FittingCommand::End) || button == ButtonEvent::LongPress {
            break;
        }
        if measurement_due
            && (matches!(command, FittingCommand::Measure) || button == ButtonEvent::ShortPress)
        {
            failed_attempts = failed_attempts.saturating_add(1);
            if measure_fitting_alcohol(ble, measure, buzzer, screen, start, &mut log, &session_id) {
                measurement_due = false;
                screen.show(View::FittingWaiting);
            } else if failed_attempts >= 3 {
                log.push(alcohol_missed_entry(elapsed_ms(start)));
                measurement_due = false;
                screen.show(View::FittingSlotMissed);
            } else {
                screen.show(View::FittingRetry);
            }
        }

        notify_status(
            ble,
            &session_id,
            state,
            elapsed_ms(start),
            log.len(),
            None,
            None,
        );

        if !ble.is_connected() && !disconnect_alerted {
            disconnect_alerted = true;
            let _ = buzzer.beep(1200);
            log::warn!("fitting session BLE disconnected; retaining records for reconnect");
        } else if ble.is_connected() {
            disconnect_alerted = false;
        }

        if log.len() >= MAX_RECORDS {
            log::warn!("alcohol-track log full ({MAX_RECORDS}), ending");
            break;
        }

        freertos_delay(SESSION_TICK);
    }

    log::info!("alcohol-track ending: streaming {} records", log.len());
    stream_log(ble, &session_id, &log);
    screen.show(home_view(ble));
}

enum FittingCommand {
    None,
    Measure,
    End,
}

fn fitting_command(ble: &BleService) -> FittingCommand {
    let mut requested = FittingCommand::None;
    while let Some(command) = ble.try_recv_command() {
        match command {
            PhoneCommand::MeasureSessionAlcohol => requested = FittingCommand::Measure,
            PhoneCommand::EndSession => return FittingCommand::End,
            other => log::debug!("ignoring command during fitting session: {other:?}"),
        }
    }
    requested
}

fn measure_fitting_alcohol(
    ble: &BleService,
    measure: &mut MeasureService<'_>,
    buzzer: &mut BuzzerDevice,
    screen: &mut ScreenService<'_>,
    start: Instant,
    log: &mut Vec<LogEntry>,
    session_id: &str,
) -> bool {
    screen.show(View::Measuring);
    let id = session_id.to_owned();
    let result = block_on(measure.measure_session_alcohol(buzzer, |status| {
        if matches!(status, crate::devices::alcohol::Status::WaitBlow) {
            screen.show(View::BlowNow);
        }
        notify_event(ble, ble::alcohol_state(id.clone(), status));
    }));
    let measured_at = elapsed_ms(start);
    let value = match result {
        Ok(value) => {
            log.push(alcohol_entry(measured_at, value));
            Some(value)
        }
        Err(error) => {
            log::warn!("fitting alcohol measurement failed: {error}");
            None
        }
    };
    notify_event(
        ble,
        ble::session_alcohol_result(id, measured_at, None, value),
    );
    value.is_some()
}

/// PROBE: 부저로 알리고 알코올 1회 측정 + 사용자 버튼 확인을 기다린다.
#[allow(clippy::too_many_arguments)]
fn run_probe(
    ble: &BleService,
    measure: &mut MeasureService<'_>,
    buzzer: &mut BuzzerDevice,
    screen: &mut ScreenService<'_>,
    trigger: &mut TriggerDevice,
    start: Instant,
    log: &mut Vec<LogEntry>,
    session_id: &str,
) -> ProbeOutcome {
    screen.show(View::SessionConfirm);

    // 진입 즉시 알코올 1회 측정 — 양성이면 버튼 확인 없이 바로 TRACK.
    if let Some(value) = measure_alcohol_step(measure, buzzer, screen, start, log) {
        if value >= ALCOHOL_POSITIVE_MG_L_X1000 {
            log.push(drink_entry(elapsed_ms(start)));
            return ProbeOutcome::Track;
        }
    }

    screen.show(View::SessionConfirm);
    let deadline = Instant::now() + PROBE_MAX;

    loop {
        match trigger.poll() {
            ButtonEvent::ShortPress => {
                log.push(drink_entry(elapsed_ms(start)));
                let _ = buzzer.beep_pattern(2, 80, 80);
                return ProbeOutcome::Track;
            }
            ButtonEvent::LongPress => return ProbeOutcome::End,
            ButtonEvent::None => {}
        }

        if end_requested(ble) {
            return ProbeOutcome::End;
        }

        notify_status(
            ble,
            session_id,
            SessionStateLabel::Probe,
            elapsed_ms(start),
            log.len(),
            None,
            None,
        );

        if Instant::now() >= deadline {
            return ProbeOutcome::Dormant;
        }

        freertos_delay(SESSION_TICK);
    }
}

/// 부저로 알린 뒤 알코올 1회를 측정하고 로그에 남긴다.
fn measure_alcohol_step(
    measure: &mut MeasureService<'_>,
    buzzer: &mut BuzzerDevice,
    screen: &mut ScreenService<'_>,
    start: Instant,
    log: &mut Vec<LogEntry>,
) -> Option<u16> {
    let _ = buzzer.beep_pattern(2, 100, 150);
    screen.show(View::Measuring);

    let value = match block_on(measure.measure_alcohol(buzzer)) {
        Ok(value) => {
            log.push(alcohol_entry(elapsed_ms(start), value));
            Some(value)
        }
        Err(error) => {
            log::warn!("session alcohol read failed: {error}");
            None
        }
    };

    screen.show(View::Session);
    value
}

fn end_requested(ble: &BleService) -> bool {
    let mut end = false;

    while let Some(command) = ble.try_recv_command() {
        match command {
            PhoneCommand::EndSession => end = true,
            other => log::debug!("ignoring command during session: {other:?}"),
        }
    }

    end
}

#[allow(clippy::too_many_arguments)]
fn notify_status(
    ble: &BleService,
    session_id: &str,
    state: SessionStateLabel,
    elapsed_ms: u32,
    records: usize,
    r0: Option<f32>,
    last_bpm: Option<u16>,
) {
    let event = ble::session_status(
        session_id.to_string(),
        state,
        elapsed_ms,
        clamp_u16(records),
        r0.map(|value| value.round() as u16),
        last_bpm,
    );

    if let Err(error) = ble.notify(&event) {
        log::warn!("session status notify failed: {error}");
    }
}

fn notify_event(ble: &BleService, event: ble::DeviceEvent) {
    if let Err(error) = ble.notify(&event) {
        log::warn!("session event notify failed: {error}");
    }
}

fn stream_log(ble: &BleService, session_id: &str, log: &[LogEntry]) {
    let total = clamp_u16(log.len());
    loop {
        while !ble.is_connected() {
            freertos_delay(Duration::from_millis(500));
        }
        let mut complete = true;
        for (index, entry) in log.iter().enumerate() {
            if index >= u16::MAX as usize {
                break;
            }
            let event = ble::session_record(
                session_id.to_string(),
                index as u16,
                total,
                entry.t_ms,
                entry.kind,
                entry.state,
                entry.mg_l_x1000,
                entry.bpm,
            );
            if let Err(error) = ble.notify(&event) {
                log::warn!("session record notify interrupted; retrying after reconnect: {error}");
                complete = false;
                break;
            }
            freertos_delay(Duration::from_millis(20));
        }
        if complete {
            let done = ble::session_complete(session_id.to_string(), total);
            if ble.notify(&done).is_ok() {
                return;
            }
        }
        freertos_delay(Duration::from_millis(500));
    }
}

fn alert_disconnect_once(ble: &BleService, buzzer: &mut BuzzerDevice, alerted: &mut bool) {
    if !ble.is_connected() && !*alerted {
        *alerted = true;
        let _ = buzzer.beep(1200);
        log::warn!("BLE unexpectedly disconnected; session data remains buffered");
    } else if ble.is_connected() {
        *alerted = false;
    }
}

fn home_view(ble: &BleService) -> View {
    if ble.is_connected() {
        View::HomeReady
    } else {
        View::HomeDisconnected
    }
}

fn valid_bpm(diag: &Diagnosis) -> bool {
    diag.peak_count >= 2 && diag.bpm >= HR_MIN_BPM && diag.bpm <= HR_MAX_BPM
}

/// 이동평균 window 안의 BPM 표본 평균을 낸다.
fn moving_average(samples: &VecDeque<(u32, f32)>) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }

    samples.iter().map(|&(_, bpm)| bpm).sum::<f32>() / samples.len() as f32
}

fn elapsed_ms(start: Instant) -> u32 {
    start.elapsed().as_millis().min(u128::from(u32::MAX)) as u32
}

fn clamp_u16(value: usize) -> u16 {
    value.min(u16::MAX as usize) as u16
}

/// `std::thread::sleep` maps to `usleep` on this ESP-IDF target and can keep
/// CPU0's idle task from running often enough to feed the task watchdog.
/// FreeRTOS delay blocks the main task and explicitly yields to IDLE0.
fn freertos_delay(duration: Duration) {
    let micros = duration.as_micros();
    if micros == 0 {
        return;
    }
    let millis = micros
        .saturating_add(999)
        .saturating_div(1_000)
        .min(u128::from(u32::MAX)) as u32;
    FreeRtos::delay_ms(millis);
}

fn state_entry(t_ms: u32, state: SessionStateLabel) -> LogEntry {
    LogEntry {
        t_ms,
        kind: SessionRecordKind::State,
        state: Some(state),
        mg_l_x1000: None,
        bpm: None,
    }
}

fn heart_entry(t_ms: u32, bpm: u16) -> LogEntry {
    LogEntry {
        t_ms,
        kind: SessionRecordKind::Heart,
        state: None,
        mg_l_x1000: None,
        bpm: Some(bpm),
    }
}

fn alcohol_entry(t_ms: u32, mg_l_x1000: u16) -> LogEntry {
    LogEntry {
        t_ms,
        kind: SessionRecordKind::Alcohol,
        state: None,
        mg_l_x1000: Some(mg_l_x1000),
        bpm: None,
    }
}

fn alcohol_missed_entry(t_ms: u32) -> LogEntry {
    LogEntry {
        t_ms,
        kind: SessionRecordKind::AlcoholMissed,
        state: None,
        mg_l_x1000: None,
        bpm: None,
    }
}

fn drink_entry(t_ms: u32) -> LogEntry {
    LogEntry {
        t_ms,
        kind: SessionRecordKind::DrinkConfirmed,
        state: None,
        mg_l_x1000: None,
        bpm: None,
    }
}
