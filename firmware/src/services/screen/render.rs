use super::{icon, text};
use crate::devices::display::DisplayDevice;
use crate::error::Result;
use crate::services::measure::{Measurement, PulseOutcome};

pub fn home(display: &mut DisplayDevice<'_>) -> Result<()> {
    display.draw(|frame| {
        text::center(frame, 16, "drunksafe");
        icon::separator(frame, 22);
        text::center(frame, 42, "준비 완료");
        text::center(frame, 59, "버튼을 눌러주세요");
    })?;
    Ok(())
}

pub fn measuring(display: &mut DisplayDevice<'_>) -> Result<()> {
    display.draw(|frame| {
        icon::breath(frame);
        text::center(frame, 40, "측정 중");
        text::center(frame, 58, "숨을 불어주세요");
    })?;
    Ok(())
}

pub fn awaiting_pulse(display: &mut DisplayDevice<'_>) -> Result<()> {
    display.draw(|frame| {
        text::center(frame, 22, "심박 측정");
        icon::separator(frame, 27);
        text::center(frame, 46, "준비 완료");
        text::center(frame, 60, "버튼을 눌러주세요");
    })?;
    Ok(())
}

pub fn pulse_stream(display: &mut DisplayDevice<'_>) -> Result<()> {
    display.draw(|frame| {
        text::center(frame, 30, "심박");
        text::center(frame, 48, "측정 중");
    })?;
    Ok(())
}

pub fn session(display: &mut DisplayDevice<'_>) -> Result<()> {
    display.draw(|frame| {
        text::center(frame, 22, "심박 측정");
        icon::separator(frame, 27);
        text::center(frame, 48, "측정 중");
    })?;
    Ok(())
}

pub fn session_confirm(display: &mut DisplayDevice<'_>) -> Result<()> {
    display.draw(|frame| {
        text::center(frame, 22, "심박 측정");
        icon::separator(frame, 27);
        text::center(frame, 46, "버튼을");
        text::center(frame, 60, "눌러주세요");
    })?;
    Ok(())
}

pub fn failed(display: &mut DisplayDevice<'_>) -> Result<()> {
    display.draw(|frame| {
        icon::cross(frame);
        text::center(frame, 40, "측정 실패");
        text::center(frame, 58, "다시 시도해주세요");
    })?;
    Ok(())
}

pub fn result(display: &mut DisplayDevice<'_>, measurement: Measurement) -> Result<()> {
    let alcohol = measurement.alcohol_mg_l_x1000();
    let bpm = match measurement.pulse() {
        PulseOutcome::Measured { bpm, .. } => Some(bpm),
        PulseOutcome::Unavailable { .. } => None,
    };

    display.draw(|frame| {
        text::center(frame, 12, "측정 결과");
        icon::separator(frame, 17);
        icon::bullet(frame, 33);
        text::left(frame, 37, "알코올");
        text::right(
            frame,
            37,
            format_args!("{}.{:03} mg/L", alcohol / 1000, alcohol % 1000),
        );
        icon::bullet(frame, 52);
        text::left(frame, 56, "심박");

        match bpm {
            Some(bpm) => text::right(frame, 56, format_args!("{bpm} BPM")),
            None => text::right(frame, 56, "-- BPM"),
        }
    })?;
    Ok(())
}
