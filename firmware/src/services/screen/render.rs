use crate::devices::DisplayDevice;
use crate::error::Result;
use crate::services::measure::Measurement;

pub fn home(display: &mut DisplayDevice<'_>) -> Result<()> {
    display.draw(|canvas| {
        canvas.centered(18, format_args!("DRUNKSAFE"));
        canvas.centered(38, format_args!("READY"));
    })?;
    Ok(())
}

pub fn measuring(display: &mut DisplayDevice<'_>) -> Result<()> {
    display.draw(|canvas| {
        canvas.centered(16, format_args!("MEASURING"));
        canvas.centered(36, format_args!("PLEASE WAIT"));
    })?;
    Ok(())
}

pub fn failed(display: &mut DisplayDevice<'_>) -> Result<()> {
    display.draw(|canvas| {
        canvas.centered(18, format_args!("MEASURE FAIL"));
        canvas.centered(38, format_args!("TRY AGAIN"));
    })?;
    Ok(())
}

pub fn result(display: &mut DisplayDevice<'_>, measurement: Measurement) -> Result<()> {
    let alcohol = measurement.alcohol_mg_l_x1000();
    let bpm = measurement.pulse_bpm();

    display.draw(|canvas| {
        canvas.centered(
            22,
            format_args!("ALC {}.{:03} MG/L", alcohol / 1000, alcohol % 1000),
        );

        canvas.centered(42, format_args!("BPM {bpm}"))
    })?;
    Ok(())
}
