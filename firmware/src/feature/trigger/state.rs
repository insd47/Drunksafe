use esp_idf_svc::hal::gpio::{Input, PinDriver};
use std::time::{Duration, Instant};

/// 버튼 debounce 진행 상태를 보관한다.
pub struct State {
    button: PinDriver<'static, Input>,
    phase: Phase,
}

impl State {
    /// 이미 input으로 설정된 버튼 pin driver를 trigger 상태로 감싼다.
    pub fn new(button: PinDriver<'static, Input>) -> Self {
        Self {
            button,
            phase: Phase::Ready,
        }
    }

    /// 현재 버튼 값을 읽고 debounce 상태 머신을 진행한다.
    ///
    /// 반환값이 `true`이면 눌림이 안정적으로 확인된 순간이다.
    pub fn poll(&mut self, now: Instant, debounce: Duration) -> bool {
        let pressed = self.button.is_low();

        match self.phase {
            Phase::Ready => {
                if pressed {
                    self.phase = Phase::DebouncingPress(now);
                }
            }
            Phase::DebouncingPress(since) => {
                if !pressed {
                    self.phase = Phase::Ready;
                } else if now.duration_since(since) >= debounce {
                    self.phase = Phase::Pressed;
                    return true;
                }
            }
            Phase::Pressed => {
                if !pressed {
                    self.phase = Phase::DebouncingRelease(now);
                }
            }
            Phase::DebouncingRelease(since) => {
                if pressed {
                    self.phase = Phase::Pressed;
                } else if now.duration_since(since) >= debounce {
                    self.phase = Phase::Ready;
                }
            }
        }

        false
    }
}

enum Phase {
    Ready,
    DebouncingPress(Instant),
    Pressed,
    DebouncingRelease(Instant),
}
