use esp_idf_svc::hal::gpio::{Input, PinDriver};

use std::time::{Duration, Instant};

use crate::feature::state::{shared, Shared};

pub struct State {
    button: PinDriver<'static, Input>,
    phase: Phase,
}

impl State {
    pub fn new(button: PinDriver<'static, Input>) -> Self {
        Self {
            button,
            phase: Phase::Ready,
        }
    }

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

pub type SharedState = Shared<State>;

pub fn init(button: PinDriver<'static, Input>) -> SharedState {
    shared(State::new(button))
}
