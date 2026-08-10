use super::filter::StreamingButterworth;
use super::model::Sample;
use super::params::WINDOW_SAMPLES;
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
        }
    }
}

impl State {
    pub fn filter(&mut self, raw_12bit: u16) -> f32 {
        self.filter.push(f32::from(raw_12bit))
    }

    pub fn push(&mut self, sample: Sample) {
        if self.window.len() == WINDOW_SAMPLES {
            self.window.pop_front();
        }

        self.window.push_back(sample);
        self.total_samples += 1;
        self.samples_since_analysis += 1;
    }

    pub fn reset(&mut self) {
        *self = Self::default();
    }

    pub fn window(&self) -> &VecDeque<Sample> {
        &self.window
    }

    pub const fn total_samples(&self) -> usize {
        self.total_samples
    }

    pub const fn samples_since_analysis(&self) -> usize {
        self.samples_since_analysis
    }

    pub fn mark_analyzed(&mut self) {
        self.samples_since_analysis = 0;
    }

    pub const fn first_stable_found(&self) -> bool {
        self.first_stable_found
    }

    pub fn mark_first_stable(&mut self) {
        self.first_stable_found = true;
    }

    pub const fn last_values(&self) -> (f32, f32, f32) {
        (
            self.last_bpm,
            self.last_ibi_stddev_ms,
            self.last_peak_amplitude,
        )
    }

    pub fn set_last_values(&mut self, bpm: f32, ibi_stddev_ms: f32, peak_amplitude: f32) {
        self.last_bpm = bpm;
        self.last_ibi_stddev_ms = ibi_stddev_ms;
        self.last_peak_amplitude = peak_amplitude;
    }
}
