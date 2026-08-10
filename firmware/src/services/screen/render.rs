use super::{icon, text};
use crate::devices::display::DisplayDevice;
use crate::error::Result;
use crate::services::measure::Measurement;

pub fn home(display: &mut DisplayDevice<'_>) -> Result<()> {
    display.draw(|frame| {
        text::center(frame, 16, "드렁세이프");
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
    let bpm = measurement.pulse().map(|pulse| pulse.bpm());

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
