use crate::services::measure::Measurement;

use super::model::{
    Alcohol, DeviceEvent, MeasurementKind, MeasurementResult, PhoneContext, Pulse, PROTOCOL_VERSION,
};

mod alcohol;
mod confidence;
mod risk;
mod sober;

pub fn result(
    session: String,
    kind: MeasurementKind,
    measurement: Measurement,
    context: Option<&PhoneContext>,
) -> DeviceEvent {
    let raw = measurement.alcohol_mg_l_x1000();
    let pulse = measurement.pulse_bpm();
    let corrected = alcohol::corrected(raw, context);
    let upper = alcohol::upper(raw, context);
    let raw_bac = alcohol::bac(raw);
    let bac = alcohol::bac(corrected);
    let upper_bac = alcohol::bac(upper).max(raw_bac);

    DeviceEvent::MeasurementResult(MeasurementResult {
        v: PROTOCOL_VERSION,
        session_id: session,
        kind,
        measured_at_unix_ms: context.and_then(|value| value.phone_time_unix_ms),
        alcohol: Alcohol { mg_l_x1000: raw },
        pulse: pulse.map(|bpm| Pulse {
            bpm: bpm as f32,
            stable: true,
            confidence_percent: confidence::pulse(context, bpm),
        }),
        bac_milli_percent: Some(bac),
        bac_upper_milli_percent: Some(upper_bac),
        sober_time_minutes: sober::time(upper.max(raw), upper_bac, context),
        risk: risk::from(upper_bac),
        confidence_percent: confidence::overall(context, pulse),
    })
}
