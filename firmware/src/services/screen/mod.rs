use crate::devices::display::DisplayDevice;
use crate::error::Result;
pub use view::View;

mod icon;
mod render;
mod text;
mod view;

pub struct ScreenService<'d> {
    display: DisplayDevice<'d>,
}

impl<'d> ScreenService<'d> {
    pub fn new(display: DisplayDevice<'d>) -> Self {
        Self { display }
    }

    pub fn show(&mut self, view: View) {
        if let Err(error) = self.try_show(view) {
            log::warn!("screen update failed: view={view:?}, error={error}");
        }
    }

    fn try_show(&mut self, view: View) -> Result<()> {
        match view {
            View::HomeDisconnected => render::home_disconnected(&mut self.display),
            View::HomeReady => render::home_ready(&mut self.display),
            View::Measuring => render::measuring(&mut self.display),
            View::BlowNow => render::blow_now(&mut self.display),
            View::AwaitingPulse => render::awaiting_pulse(&mut self.display),
            View::PulseStream => render::pulse_stream(&mut self.display),
            View::Session => render::session(&mut self.display),
            View::SessionConfirm => render::session_confirm(&mut self.display),
            View::FittingWaiting => render::fitting_waiting(&mut self.display),
            View::FittingConfirm => render::fitting_confirm(&mut self.display),
            View::CheckApp => render::check_app(&mut self.display),
            View::FittingRetry => render::fitting_retry(&mut self.display),
            View::FittingSlotMissed => render::fitting_slot_missed(&mut self.display),
            View::Failed => render::failed(&mut self.display),
            View::Result(measurement) => render::result(&mut self.display, measurement),
        }
    }
}
