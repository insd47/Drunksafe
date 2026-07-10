use crate::devices::DisplayDevice;
use crate::error::Result;
use crate::services::measure::Measurement;

use super::{icon, text};

pub fn home(display: &mut DisplayDevice<'_>) -> Result<()> {
    display.draw(|frame| {
        icon::check(frame);
        text::center(frame, 40, "측정 준비");
        text::center(frame, 58, "버튼을 눌러주세요");
    })?;
    Ok(())
}

pub fn context(display: &mut DisplayDevice<'_>) -> Result<()> {
    display.draw(|frame| {
        icon::spinner(frame);
        text::center(frame, 40, "정보 확인 중");
        text::center(frame, 58, "앱 연결을 확인하세요");
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

pub fn analyzing(display: &mut DisplayDevice<'_>) -> Result<()> {
    display.draw(|frame| {
        icon::spinner(frame);
        text::center(frame, 40, "분석 중");
        text::center(frame, 58, "잠시 기다려주세요");
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

        match measurement.pulse_bpm() {
            Some(bpm) => text::right(frame, 56, format_args!("{bpm} BPM")),
            None => text::right(frame, 56, "-- BPM"),
        }
    })?;
    Ok(())
}
