use crate::devices::display::DisplayDevice;
use crate::error::Result;
pub use view::View;

mod render;
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
            View::Home => render::home(&mut self.display),
            View::Measuring => render::measuring(&mut self.display),
            View::Failed => render::failed(&mut self.display),
            View::Result(measurement) => render::result(&mut self.display, measurement),
        }
    }
}
