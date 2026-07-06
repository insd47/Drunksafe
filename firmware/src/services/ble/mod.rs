mod gatt;
mod model;
#[allow(dead_code)]
mod transport;

pub use gatt::BleService;
#[allow(unused_imports)]
pub use model::{
    Alcohol, DeviceError, DeviceEvent, DeviceStatus, ErrorCode, HistoryEntry, MeasurementProgress,
    MeasurementResult, MeasurementStarted, MeasurementStep, PhoneCommand, PhoneContext, Pulse,
    Risk, Source, StatusKind,
};
#[allow(unused_imports)]
pub use transport::{
    DeviceEventTransport, PhoneCommandTransport, TransportError, DEVICE_EVENT_CHARACTERISTIC_UUID,
    DEVICE_NAME, MAX_BLE_JSON_PAYLOAD_BYTES, PHONE_COMMAND_CHARACTERISTIC_UUID, SERVICE_UUID,
};

/// 새 측정 세션 이벤트를 만든다.
#[allow(dead_code)]
pub fn measurement_started(session_id: String, source: Source) -> DeviceEvent {
    DeviceEvent::MeasurementStarted(MeasurementStarted {
        v: model::PROTOCOL_VERSION,
        session_id,
        source,
        history_limit: 8,
        needs_context: true,
        sync_time: true,
    })
}

#[allow(dead_code)]
pub fn measurement_progress(session_id: String, step: MeasurementStep, percent: u8) -> DeviceEvent {
    DeviceEvent::MeasurementProgress(MeasurementProgress {
        v: model::PROTOCOL_VERSION,
        session_id,
        step,
        percent: percent.min(100),
    })
}

#[allow(dead_code)]
pub fn measurement_result(
    session_id: String,
    measurement: crate::services::measure::Measurement,
) -> DeviceEvent {
    let alcohol_mg_l_x1000 = measurement.alcohol_mg_l_x1000();
    let pulse_bpm = measurement.pulse_bpm();
    let bac_milli_percent = estimate_bac_milli_percent(alcohol_mg_l_x1000);
    let risk = risk_from_bac(bac_milli_percent);

    DeviceEvent::MeasurementResult(MeasurementResult {
        v: model::PROTOCOL_VERSION,
        session_id,
        measured_at_unix_ms: None,
        alcohol: Alcohol {
            mg_l_x1000: alcohol_mg_l_x1000,
        },
        pulse: Some(Pulse {
            bpm: pulse_bpm as f32,
            stable: true,
            confidence_percent: 70,
        }),
        bac_milli_percent: Some(bac_milli_percent),
        bac_upper_milli_percent: Some(bac_milli_percent.saturating_add(8)),
        sober_time_minutes: estimate_sober_time_minutes(bac_milli_percent),
        risk,
        confidence_percent: 65,
    })
}

#[allow(dead_code)]
pub fn device_status(status: StatusKind, active_session_id: Option<String>) -> DeviceEvent {
    DeviceEvent::Status(DeviceStatus {
        v: model::PROTOCOL_VERSION,
        status,
        active_session_id,
        battery_percent: None,
        firmware_version: Some(env!("CARGO_PKG_VERSION").to_owned()),
    })
}

#[allow(dead_code)]
pub fn device_error(session_id: Option<String>, code: ErrorCode) -> DeviceEvent {
    DeviceEvent::DeviceError(DeviceError {
        v: model::PROTOCOL_VERSION,
        session_id,
        code,
    })
}

fn estimate_bac_milli_percent(alcohol_mg_l_x1000: u16) -> u16 {
    ((u32::from(alcohol_mg_l_x1000) * 3) / 14).min(u32::from(u16::MAX)) as u16
}

fn estimate_sober_time_minutes(bac_milli_percent: u16) -> Option<u16> {
    if bac_milli_percent < 10 {
        return Some(0);
    }

    Some(((u32::from(bac_milli_percent) * 60) / 15).min(u32::from(u16::MAX)) as u16)
}

fn risk_from_bac(bac_milli_percent: u16) -> Risk {
    if bac_milli_percent >= 30 {
        Risk::Danger
    } else if bac_milli_percent >= 15 {
        Risk::Caution
    } else {
        Risk::Safe
    }
}
