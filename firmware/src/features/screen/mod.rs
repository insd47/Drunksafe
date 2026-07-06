use crate::devices::display::{Canvas, DisplayDevice};
use crate::error::Result;

use pages::ResultPage;
pub use pages::ResultPager;

mod pages;

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

pub fn measurement_failed(display: &mut DisplayDevice<'_>) -> Result<()> {
    display.draw(|canvas| {
        canvas.centered(18, format_args!("MEASURE FAIL"));
        canvas.centered(38, format_args!("TRY AGAIN"));
    })?;
    Ok(())
}

pub fn show_current_result(display: &mut DisplayDevice<'_>, pager: &ResultPager) -> Result<()> {
    show_result_page(display, pager.current())
}

pub fn show_next_result(display: &mut DisplayDevice<'_>, pager: &mut ResultPager) -> Result<()> {
    let page = pager.next();
    show_result_page(display, page)?;
    pager.advance();
    Ok(())
}

fn show_result_page(display: &mut DisplayDevice<'_>, page: ResultPage) -> Result<()> {
    match page {
        ResultPage::Home => home(display),
        ResultPage::Done {
            alcohol_mg_l_x1000,
            pulse_bpm,
        } => done(display, alcohol_mg_l_x1000, pulse_bpm),
        ResultPage::Alcohol { alcohol_mg_l_x1000 } => alcohol(display, alcohol_mg_l_x1000),
        ResultPage::Pulse { pulse_bpm } => pulse(display, pulse_bpm),
    }
}

fn done(
    display: &mut DisplayDevice<'_>,
    alcohol_mg_l_x1000: u16,
    pulse_bpm: Option<u16>,
) -> Result<()> {
    display.draw(|display| {
        display.centered(16, format_args!("DONE"));
        add_mg_l(display, 34, "ALC", alcohol_mg_l_x1000);
        add_bpm(display, 50, pulse_bpm);
    })?;
    Ok(())
}

fn alcohol(display: &mut DisplayDevice<'_>, alcohol_mg_l_x1000: u16) -> Result<()> {
    display.draw(|display| {
        display.centered(16, format_args!("ALCOHOL"));
        add_mg_l(display, 38, "ALC", alcohol_mg_l_x1000);
    })?;
    Ok(())
}

fn pulse(display: &mut DisplayDevice<'_>, pulse_bpm: Option<u16>) -> Result<()> {
    display.draw(|display| {
        display.centered(16, format_args!("PULSE"));
        add_bpm(display, 38, pulse_bpm);
    })?;
    Ok(())
}

fn add_mg_l(display: &mut Canvas<'_>, y: usize, label: &'static str, value_x1000: u16) {
    display.centered(
        y,
        format_args!(
            "{label} {}.{:03} MG/L",
            value_x1000 / 1000,
            value_x1000 % 1000
        ),
    );
}

fn add_bpm(display: &mut Canvas<'_>, y: usize, pulse_bpm: Option<u16>) {
    match pulse_bpm {
        Some(bpm) => display.centered(y, format_args!("BPM {bpm}")),
        None => display.centered(y, format_args!("BPM --")),
    }
}
