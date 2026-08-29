//! Hardware-independent port of the attached sketch. All modes use this engine.
use super::{filter::StreamingButterworth, params::*};
use std::collections::VecDeque;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Diagnosis {
    pub bpm: f32,
    pub ibi_stddev_ms: f32,
    pub peak_count: u16,
    /// Only true for a completed, accepted 20-second attempt.
    pub stable: bool,
    pub accepted_intervals: u16,
    pub phase: &'static str,
    pub reason: Option<&'static str>,
    pub last_failure: Option<&'static str>,
    pub contact_good: Option<bool>,
    pub slot_index: u32,
    pub slot_elapsed_ms: u32,
    pub attempt_elapsed_ms: u32,
    pub consecutive_misses: u32,
    pub failed_attempts: u16,
}

#[derive(Clone, Copy, Debug)]
pub struct ClosedSlot {
    pub index: u32,
    pub bpm: Option<f32>,
    pub alert_missed: bool,
}

#[derive(Clone, Copy, Debug, Default)]
struct Intervals {
    bpm: f32,
    stddev: f32,
    accepted: u16,
    reason: Option<&'static str>,
}

fn analyze(ibis: &[u32]) -> Intervals {
    if ibis.len() < MIN_VALID_INTERVALS {
        return Intervals {
            reason: Some("insufficient_intervals"),
            ..Intervals::default()
        };
    }
    let mut sorted = ibis.to_vec();
    sorted.sort_unstable();
    let median = if sorted.len() % 2 == 0 {
        (sorted[sorted.len() / 2 - 1] + sorted[sorted.len() / 2]) as f32 * 0.5
    } else {
        sorted[sorted.len() / 2] as f32
    };
    let tolerance = (median * 0.20).max(100.0);
    let accepted: Vec<f32> = ibis
        .iter()
        .map(|v| *v as f32)
        .filter(|v| (*v - median).abs() <= tolerance)
        .collect();
    let count = accepted.len();
    if count < MIN_VALID_INTERVALS.max((ibis.len() as f32 * 0.60).ceil() as usize) {
        return Intervals {
            accepted: count as u16,
            reason: Some("invalid_pulse_signal"),
            ..Intervals::default()
        };
    }
    let mean = accepted.iter().sum::<f32>() / count as f32;
    let stddev = (accepted.iter().map(|v| (v - mean).powi(2)).sum::<f32>() / count as f32).sqrt();
    Intervals {
        bpm: 60_000.0 / mean,
        stddev,
        accepted: count as u16,
        reason: (stddev / mean > MAX_IBI_CV).then_some("ibi_unstable"),
    }
}

pub struct PulseEngine {
    filter: StreamingButterworth,
    previous: [f32; 2],
    envelope: f32,
    last_peak: Option<u32>,
    last_sample: Option<u32>,
    ibis: Vec<u32>,
    peaks: u16,
    quality_start: u32,
    raw_min: u16,
    raw_max: u16,
    filtered_min: f32,
    filtered_max: f32,
    clipped: u32,
    quality_count: u32,
    contact: Option<bool>,
    bad_windows: u8,
    attempt_start: Option<u32>,
    slot: u32,
    completed: Option<Intervals>,
    misses: u32,
    reason: Option<&'static str>,
    last_failure: Option<&'static str>,
    closed: VecDeque<ClosedSlot>,
    failed_attempts: u16,
    now: u32,
}

impl Default for PulseEngine {
    fn default() -> Self {
        Self {
            filter: StreamingButterworth::new(),
            previous: [0.0; 2],
            envelope: 0.0,
            last_peak: None,
            last_sample: None,
            ibis: Vec::with_capacity(MAX_INTERVALS),
            peaks: 0,
            quality_start: 0,
            raw_min: 4095,
            raw_max: 0,
            filtered_min: f32::MAX,
            filtered_max: f32::MIN,
            clipped: 0,
            quality_count: 0,
            contact: None,
            bad_windows: 0,
            attempt_start: None,
            slot: 0,
            completed: None,
            misses: 0,
            reason: None,
            last_failure: None,
            closed: VecDeque::new(),
            failed_attempts: 0,
            now: 0,
        }
    }
}

impl PulseEngine {
    fn reset_quality(&mut self, now: u32) {
        self.quality_start = now;
        self.raw_min = 4095;
        self.raw_max = 0;
        self.filtered_min = f32::MAX;
        self.filtered_max = f32::MIN;
        self.clipped = 0;
        self.quality_count = 0;
    }

    fn reset_beats(&mut self) {
        self.filter = StreamingButterworth::new();
        self.previous = [0.0; 2];
        self.envelope = 0.0;
        self.last_peak = None;
        self.ibis.clear();
        self.peaks = 0;
    }

    fn retry(&mut self, now: u32, reason: &'static str) {
        if reason != "sample_gap" {
            self.failed_attempts = self.failed_attempts.saturating_add(1);
        }
        self.attempt_start = None;
        self.contact = None;
        self.reason = Some(reason);
        self.last_failure = Some(reason);
        self.bad_windows = 0;
        self.reset_beats();
        self.reset_quality(now);
    }

    /// Every elapsed minute, including missing samples, enters the denominator.
    pub fn advance(&mut self, now: u32) {
        self.now = now;
        while now / SLOT_MS > self.slot {
            let bpm = self.completed.map(|r| r.bpm);
            if bpm.is_some() {
                self.misses = 0;
            } else {
                self.misses += 1;
                if self.attempt_start.is_some() {
                    self.last_failure = Some("measurement_finished_after_deadline");
                } else if self.last_failure.is_none() {
                    self.last_failure = Some("slot_deadline");
                }
            }
            self.closed.push_back(ClosedSlot {
                index: self.slot,
                bpm,
                alert_missed: bpm.is_none() && self.misses % 2 == 0,
            });
            self.slot += 1;
            self.completed = None;
            self.attempt_start = None;
            self.reset_beats();
            self.contact = None;
            self.reset_quality(now);
            self.reason = None;
            self.failed_attempts = 0;
        }
    }

    pub fn take_closed_slot(&mut self) -> Option<ClosedSlot> {
        self.closed.pop_front()
    }
    pub fn push(&mut self, now: u32, raw: u16) {
        self.advance(now);
        // Do not convert long gaps to long IBI or compressed catch-up samples.
        if self
            .last_sample
            .is_some_and(|t| now.saturating_sub(t) > 100)
        {
            self.retry(now, "sample_gap");
        }
        self.last_sample = Some(now);

        // One accepted estimate is the sole result for this fixed minute.
        // Keep it frozen at 100% until `advance` opens the next minute; quality,
        // cadence and peak logic must not turn it back into another attempt.
        if self.completed.is_some() {
            return;
        }

        let filtered = self.filter.push(f32::from(raw));
        self.raw_min = self.raw_min.min(raw);
        self.raw_max = self.raw_max.max(raw);
        self.filtered_min = self.filtered_min.min(filtered);
        self.filtered_max = self.filtered_max.max(filtered);
        self.clipped += u32::from(raw <= 3 || raw >= 4092);
        self.quality_count += 1;
        if now - self.quality_start >= QUALITY_WINDOW_MS {
            let raw_range = self.raw_max - self.raw_min;
            let range = self.filtered_max - self.filtered_min;
            let good = (MIN_RAW_RANGE..=MAX_RAW_RANGE).contains(&raw_range)
                && (MIN_FILTERED_RANGE..=MAX_FILTERED_RANGE).contains(&range)
                && self.clipped <= self.quality_count / 20;
            self.contact = Some(good);
            if self.attempt_start.is_some() {
                self.bad_windows = if good { 0 } else { self.bad_windows + 1 };
                if self.bad_windows >= 2 {
                    self.retry(now, "poor_contact");
                }
            }
            self.reset_quality(now);
        }

        self.envelope = self.envelope * 0.995 + filtered.abs() * 0.005;
        let threshold = (self.envelope * 1.30).max(6.0);
        let peak = self.previous[1] > self.previous[0]
            && self.previous[1] >= filtered
            && self.previous[1] > threshold;
        self.previous = [self.previous[1], filtered];
        if let Some(start) = self.attempt_start {
            if now - start >= FILTER_SETTLE_MS && peak {
                let peak_ms = now.saturating_sub(SAMPLE_PERIOD_MS);
                if let Some(last) = self.last_peak {
                    let ibi = peak_ms.saturating_sub(last);
                    if ibi >= MIN_IBI_MS {
                        self.last_peak = Some(peak_ms);
                        self.peaks += 1;
                        if ibi <= MAX_IBI_MS && self.ibis.len() < MAX_INTERVALS {
                            self.ibis.push(ibi);
                        }
                    }
                } else {
                    self.last_peak = Some(peak_ms);
                    self.peaks += 1;
                }
            }
            if now - start >= MEASUREMENT_MS {
                let result = analyze(&self.ibis);
                if let Some(reason) = result.reason {
                    self.retry(now, reason);
                } else {
                    self.completed = Some(result);
                    self.attempt_start = None;
                    self.reason = None;
                    self.last_failure = None;
                }
            }
        } else if self.completed.is_none() {
            if SLOT_MS - now % SLOT_MS < MEASUREMENT_MS + START_MARGIN_MS {
                self.reason = Some("insufficient_time_for_retry");
                if self.last_failure.is_none() {
                    self.last_failure = self.reason;
                }
            } else if self.contact == Some(true) {
                self.reset_beats();
                self.reset_quality(now);
                self.bad_windows = 0;
                self.attempt_start = Some(now);
                self.reason = None;
            }
        }
    }

    pub fn diagnose(&self) -> Diagnosis {
        let result = self.completed.unwrap_or_else(|| analyze(&self.ibis));
        let attempt_ms = self.attempt_start.map_or(
            if self.completed.is_some() {
                MEASUREMENT_MS
            } else {
                0
            },
            |t| self.now - t,
        );
        let phase = if self.completed.is_some() {
            "waiting_next"
        } else if self.reason == Some("insufficient_time_for_retry") {
            "missed"
        } else if self.attempt_start.is_none() {
            "waiting_contact"
        } else if attempt_ms < FILTER_SETTLE_MS {
            "warmup"
        } else {
            "collecting"
        };
        Diagnosis {
            bpm: result.bpm,
            ibi_stddev_ms: result.stddev,
            peak_count: self.peaks,
            stable: self.completed.is_some(),
            accepted_intervals: result.accepted,
            phase,
            reason: self.reason,
            last_failure: self.last_failure,
            contact_good: self.contact,
            slot_index: self.slot,
            slot_elapsed_ms: self.now % SLOT_MS,
            attempt_elapsed_ms: attempt_ms,
            consecutive_misses: self.misses,
            failed_attempts: self.failed_attempts,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn intervals_need_eight_and_reject_outliers() {
        assert!(analyze(&[800]).reason.is_some());
        assert_eq!(analyze(&[800; 8]).bpm, 75.0);
        let mut values = vec![800; 8];
        values.extend([1400; 3]);
        let result = analyze(&values);
        assert_eq!(result.bpm, 75.0);
        assert_eq!(result.accepted, 8);
        values.extend([1400; 4]);
        assert!(analyze(&values).reason.is_some());
    }
    #[test]
    fn fixed_slots_count_missing_and_alert_each_pair() {
        let mut engine = PulseEngine::default();
        engine.advance(240_000);
        for index in 0..4 {
            let slot = engine.take_closed_slot().unwrap();
            assert_eq!(slot.index, index);
            assert!(slot.bpm.is_none());
            assert_eq!(slot.alert_missed, index % 2 == 1);
        }
    }
    #[test]
    fn synthetic_wave_completes_only_after_twenty_seconds() {
        let mut engine = PulseEngine::default();
        let mut completed_at = None;
        for t in (0..60_000).step_by(10) {
            let raw = 2000.0 + 150.0 * (t as f32 / 1000.0 * 1.25 * std::f32::consts::TAU).sin();
            engine.push(t, raw as u16);
            if t < 20_000 {
                assert!(!engine.diagnose().stable);
            }
            if engine.diagnose().stable {
                completed_at.get_or_insert(t);
                assert_eq!(engine.diagnose().phase, "waiting_next");
                assert_eq!(engine.diagnose().attempt_elapsed_ms, MEASUREMENT_MS);
            }
        }
        assert!(completed_at.is_some());
        let result = engine.diagnose();
        assert!(result.stable, "{result:?}");
        assert!((result.bpm - 75.0).abs() < 3.0, "{result:?}");
        engine.advance(60_000);
        assert!(engine.take_closed_slot().unwrap().bpm.is_some());
        assert!(!engine.diagnose().stable);
    }
    #[test]
    fn flat_and_clipped_signals_do_not_produce_results() {
        for raw in [0, 2000, 4095] {
            let mut engine = PulseEngine::default();
            for t in (0..120_000).step_by(10) {
                engine.push(t, raw);
                assert!(!engine.diagnose().stable);
            }
        }
    }
}
