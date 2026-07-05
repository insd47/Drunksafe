use super::filter::StreamingButterworth;
use super::model::{Analysis, Sample, Trend};
use super::params::{TREND_1M_SAMPLES, TREND_20S_SAMPLES, TREND_5M_SAMPLES, WINDOW_SAMPLES};
use crate::utils::math;
use std::collections::VecDeque;

#[derive(Debug)]
pub struct State {
    filter: StreamingButterworth,
    window: VecDeque<Sample>,
    total_samples: usize,
    samples_since_analysis: usize,
    first_stable_found: bool,
    last_bpm: f32,
    last_ibi_stddev_ms: f32,
    last_peak_amplitude: f32,
    trend_20s: MovingAverage,
    trend_1m: MovingAverage,
    trend_5m: MovingAverage,
    last_analysis: Option<Analysis>,
}

#[derive(Debug)]
struct MovingAverage {
    values: VecDeque<f32>,
    capacity: usize,
    previous: Option<f32>,
}

impl MovingAverage {
    fn new(capacity: usize) -> Self {
        Self {
            values: VecDeque::with_capacity(capacity),
            capacity,
            previous: None,
        }
    }

    fn push(&mut self, value: f32) -> Trend {
        if self.values.len() == self.capacity {
            self.values.pop_front();
        }
        self.values.push_back(value);

        if self.values.len() != self.capacity {
            return Trend::default();
        }

        let average = math::round(
            self.values.iter().sum::<f32>() / self.values.len() as f32,
            2,
        );
        let delta = self
            .previous
            .map(|previous| math::round(average - previous, 2));
        self.previous = Some(average);

        Trend {
            bpm: Some(average),
            delta,
        }
    }
}

impl Default for State {
    fn default() -> Self {
        Self {
            filter: StreamingButterworth::new(),
            window: VecDeque::with_capacity(WINDOW_SAMPLES),
            total_samples: 0,
            samples_since_analysis: 0,
            first_stable_found: false,
            last_bpm: 0.0,
            last_ibi_stddev_ms: 0.0,
            last_peak_amplitude: 0.0,
            trend_20s: MovingAverage::new(TREND_20S_SAMPLES),
            trend_1m: MovingAverage::new(TREND_1M_SAMPLES),
            trend_5m: MovingAverage::new(TREND_5M_SAMPLES),
            last_analysis: None,
        }
    }
}

impl State {
    pub(super) fn filter(&mut self, raw_12bit: u16) -> f32 {
        self.filter.push(f32::from(raw_12bit))
    }

    pub(super) fn push(&mut self, sample: Sample) {
        if self.window.len() == WINDOW_SAMPLES {
            self.window.pop_front();
        }

        self.window.push_back(sample);
        self.total_samples += 1;
        self.samples_since_analysis += 1;
    }

    pub(super) fn reset(&mut self) {
        *self = Self::default();
    }

    pub(super) fn window(&self) -> &VecDeque<Sample> {
        &self.window
    }

    pub(super) const fn total_samples(&self) -> usize {
        self.total_samples
    }

    pub(super) const fn samples_since_analysis(&self) -> usize {
        self.samples_since_analysis
    }

    pub(super) fn mark_analyzed(&mut self) {
        self.samples_since_analysis = 0;
    }

    pub(super) const fn first_stable_found(&self) -> bool {
        self.first_stable_found
    }

    pub(super) fn mark_first_stable(&mut self) {
        self.first_stable_found = true;
    }

    pub(super) const fn last_values(&self) -> (f32, f32, f32) {
        (
            self.last_bpm,
            self.last_ibi_stddev_ms,
            self.last_peak_amplitude,
        )
    }

    pub(super) fn set_last_values(&mut self, bpm: f32, ibi_stddev_ms: f32, peak_amplitude: f32) {
        self.last_bpm = bpm;
        self.last_ibi_stddev_ms = ibi_stddev_ms;
        self.last_peak_amplitude = peak_amplitude;
    }

    pub(super) fn push_trends(&mut self, bpm: f32) -> (Trend, Trend, Trend) {
        (
            self.trend_20s.push(bpm),
            self.trend_1m.push(bpm),
            self.trend_5m.push(bpm),
        )
    }

    pub(super) fn set_analysis(&mut self, analysis: Analysis) {
        self.last_analysis = Some(analysis);
    }

    pub(super) const fn last_analysis(&self) -> Option<Analysis> {
        self.last_analysis
    }
}
