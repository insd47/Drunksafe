//! Rolling ten-minute alcohol-measurement recommendation policy.
use std::collections::VecDeque;

pub const WINDOW_MINUTES: usize = 10;
pub const REQUIRED_HIGH_MINUTES: usize = 8;
pub const FIRST_PERCENT: u16 = 10;
pub const STEP_PERCENT: u16 = 5;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Trend {
    pub valid: u8,
    pub high: u8,
    pub next_percent: u16,
    pub alerted_percent: Option<u16>,
}

pub struct HrRise {
    baseline: f32,
    slots: VecDeque<Option<f32>>,
    next_percent: u16,
    alerted_percent: Option<u16>,
    complete: bool,
}

impl HrRise {
    pub fn new(baseline: u16) -> Self {
        Self {
            baseline: baseline as f32,
            slots: VecDeque::new(),
            next_percent: FIRST_PERCENT,
            alerted_percent: None,
            complete: false,
        }
    }

    /// Call once for every closed fixed minute, including None for failures.
    pub fn close_minute(&mut self, bpm: Option<f32>) -> Option<u16> {
        self.slots
            .push_back(bpm.filter(|v| v.is_finite() && (40.0..=180.0).contains(v)));
        if self.slots.len() > WINDOW_MINUTES {
            self.slots.pop_front();
        }
        if self.slots.len() < WINDOW_MINUTES || self.complete {
            return None;
        }
        let threshold = self.baseline * (1.0 + self.next_percent as f32 / 100.0);
        let valid = self.slots.iter().flatten().count();
        let high = self
            .slots
            .iter()
            .flatten()
            .filter(|bpm| **bpm >= threshold)
            .count();
        if valid >= REQUIRED_HIGH_MINUTES && high >= REQUIRED_HIGH_MINUTES {
            let fired = self.next_percent;
            self.alerted_percent = Some(fired);
            if fired >= 20 {
                self.complete = true;
            } else {
                self.next_percent = self.next_percent.saturating_add(STEP_PERCENT);
            }
            Some(fired)
        } else {
            None
        }
    }

    pub fn trend(&self) -> Trend {
        let threshold = self.baseline * (1.0 + self.next_percent as f32 / 100.0);
        Trend {
            valid: self.slots.iter().flatten().count() as u8,
            high: self
                .slots
                .iter()
                .flatten()
                .filter(|bpm| **bpm >= threshold)
                .count() as u8,
            next_percent: self.next_percent,
            alerted_percent: self.alerted_percent,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requires_a_complete_window_and_eight_high_minutes() {
        let mut d = HrRise::new(80);
        for _ in 0..9 {
            assert_eq!(d.close_minute(Some(90.0)), None);
        }
        assert_eq!(d.close_minute(Some(90.0)), Some(10));
    }
    #[test]
    fn missing_or_low_minutes_remain_in_denominator() {
        let mut d = HrRise::new(80);
        for value in [Some(90.0); 7].into_iter().chain([None, None, Some(80.0)]) {
            assert_eq!(d.close_minute(value), None);
        }
        assert_eq!(d.trend().valid, 8);
        assert_eq!(d.trend().high, 7);
    }
    #[test]
    fn rolling_window_can_fire_ten_then_fifteen_percent() {
        let mut d = HrRise::new(80);
        for _ in 0..10 {
            d.close_minute(Some(90.0));
        }
        assert_eq!(d.trend().alerted_percent, Some(10));
        for _ in 0..10 {
            if d.close_minute(Some(94.0)) == Some(15) {
                return;
            }
        }
        panic!("15 percent threshold did not fire");
    }
    #[test]
    fn stops_after_twenty_percent() {
        let mut d = HrRise::new(80);
        let mut fired_twenty = false;
        for _ in 0..30 {
            fired_twenty |= d.close_minute(Some(100.0)) == Some(20);
        }
        assert!(fired_twenty);
        for _ in 0..20 {
            assert_eq!(d.close_minute(Some(120.0)), None);
        }
    }
}
