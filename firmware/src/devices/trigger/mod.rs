use crate::error::Result;
use esp_idf_svc::hal::gpio::{Input, InputPin, PinDriver, Pull};
use std::time::{Duration, Instant};

const DEBOUNCE: Duration = Duration::from_millis(80);

/// Pull-up 입력 버튼 디바이스다.
pub struct ButtonDevice {
    button: PinDriver<'static, Input>,
    was_pressed: bool,
    last_changed: Instant,
}

impl ButtonDevice {
    /// 버튼 핀을 input pull-up으로 설정한다.
    pub fn new(pin: impl InputPin + 'static) -> Result<Self> {
        log::debug!("initializing button device");
        let button = PinDriver::input(pin, Pull::Up)?;
        let was_pressed = button.is_low();

        Ok(Self {
            button,
            was_pressed,
            last_changed: Instant::now(),
        })
    }

    /// 버튼이 새로 눌린 순간에만 `true`를 반환한다.
    pub fn pressed(&mut self) -> bool {
        let now = Instant::now();
        let pressed = self.button.is_low();
        if pressed == self.was_pressed {
            return false;
        }

        if now.duration_since(self.last_changed) < DEBOUNCE {
            return false;
        }

        self.was_pressed = pressed;
        self.last_changed = now;

        pressed
    }
}
