use esp_idf_svc::hal::gpio::{Gpio0, Input, PinDriver, Pull};
use esp_idf_svc::sys::EspError;
use std::time::{Duration, Instant};

const DEBOUNCE: Duration = Duration::from_millis(80);

/// 테스트용 측정 시작 버튼 디바이스다.
pub struct TriggerDevice {
    button: PinDriver<'static, Input>,
    was_pressed: bool,
    last_changed: Instant,
}

impl TriggerDevice {
    /// BOOT 버튼 핀을 input pull-up으로 설정한다.
    pub fn new(pin: Gpio0<'static>) -> Result<Self, EspError> {
        log::debug!("initializing trigger device");
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
