use crate::error::Result;
use esp_idf_svc::hal::gpio::{Input, InputPin, PinDriver, Pull};
use std::time::{Duration, Instant};

const DEBOUNCE: Duration = Duration::from_millis(50);
const LONG_PRESS: Duration = Duration::from_millis(2000);

/// 한 번의 poll에서 확정된 버튼 이벤트다.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ButtonEvent {
    /// 새로 확정된 이벤트가 없다.
    None,
    /// 짧게 눌렀다 뗐다 (측정 시작 등).
    ShortPress,
    /// `LONG_PRESS` 이상 길게 누르고 있다 (누르고 있는 동안 한 번만 발생).
    LongPress,
}

/// GPIO0(BOOT) 버튼 디바이스다. 짧게 누르면 측정 시작, 결과 화면에서 길게 누르면
/// 대기 화면으로 복귀하는 두 제스처를 구분한다.
pub struct TriggerDevice {
    button: PinDriver<'static, Input>,
    debounced_pressed: bool,
    raw_pressed: bool,
    raw_changed: Instant,
    pressed_since: Instant,
    long_fired: bool,
}

impl TriggerDevice {
    /// 측정 trigger 핀을 input pull-up으로 설정한다 (눌림 = low).
    pub fn new(pin: impl InputPin + 'static) -> Result<Self> {
        log::debug!("initializing trigger device");
        let button = PinDriver::input(pin, Pull::Up)?;
        let pressed = button.is_low();
        let now = Instant::now();

        Ok(Self {
            button,
            debounced_pressed: pressed,
            raw_pressed: pressed,
            raw_changed: now,
            pressed_since: now,
            // 부팅 시 이미 눌려 있으면 그 hold로는 long-press를 발생시키지 않는다.
            long_fired: pressed,
        })
    }

    /// 버튼 상태를 폴링해 이번에 확정된 이벤트를 반환한다. 매 루프에서 호출해야 한다.
    pub fn poll(&mut self) -> ButtonEvent {
        let now = Instant::now();
        let raw = self.button.is_low();

        if raw != self.raw_pressed {
            self.raw_pressed = raw;
            self.raw_changed = now;
        }

        let mut event = ButtonEvent::None;

        // 안정된 raw 상태가 debounce 시간 이상 유지되면 debounced 상태로 확정한다.
        if raw != self.debounced_pressed && now.duration_since(self.raw_changed) >= DEBOUNCE {
            self.debounced_pressed = raw;

            if raw {
                self.pressed_since = now;
                self.long_fired = false;
            } else if !self.long_fired && now.duration_since(self.pressed_since) < LONG_PRESS {
                event = ButtonEvent::ShortPress;
            }
        }

        // 누르고 있는 동안 long-press 임계치를 넘으면 한 번만 발생시킨다.
        if self.debounced_pressed
            && !self.long_fired
            && now.duration_since(self.pressed_since) >= LONG_PRESS
        {
            self.long_fired = true;
            event = ButtonEvent::LongPress;
        }

        event
    }
}
