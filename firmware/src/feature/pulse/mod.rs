#![allow(dead_code)]

pub mod error;
mod filter;
pub mod model;
pub mod state;

pub use error::{Error, Result};
pub use model::{Analysis, Sample};
pub use state::{SharedState, Snapshot};

use std::collections::VecDeque;

const SAMPLE_RATE_HZ: usize = 100;
const SAMPLE_PERIOD_MS: u32 = 10;
const SAMPLE_PERIOD_TOLERANCE_MS: u32 = 2;
const START_DELAY_SAMPLES: usize = 10 * SAMPLE_RATE_HZ;
const ANALYSIS_INTERVAL_SAMPLES: usize = 5 * SAMPLE_RATE_HZ;
const PEAK_THRESHOLD: f32 = 50.0;
const MIN_PEAK_DISTANCE_MS: u32 = 300;
const IBI_STDEV_UNSTABLE_MS: f32 = 200.0;

pub fn init() -> Result<SharedState> {
    log::debug!("initializing pulse feature state");
    Ok(state::init())
}

pub fn sample(state: &SharedState, elapsed_ms: u32, raw_12bit: u16) -> Result<Option<Analysis>> {
    let mut state = state.lock().map_err(|_| Error::State)?;

    if let Some(previous) = state.window().back() {
        validate_timestamp(previous.elapsed_ms, elapsed_ms)?;
    }

    let filtered = state.filter(raw_12bit);
    state.push(Sample {
        elapsed_ms,
        raw_12bit,
        filtered,
    });

    if state.total_samples() < START_DELAY_SAMPLES {
        return Ok(None);
    }

    if state.total_samples() == START_DELAY_SAMPLES {
        state.mark_analyzed();
        return Ok(None);
    }

    if state.samples_since_analysis() < ANALYSIS_INTERVAL_SAMPLES {
        return Ok(None);
    }

    state.mark_analyzed();
    calculate(&mut state)
}

pub fn analyze(state: &SharedState) -> Result<Option<Analysis>> {
    Ok(state.lock().map_err(|_| Error::State)?.last_analysis())
}

pub fn reset(state: &SharedState) -> Result<()> {
    state.lock().map_err(|_| Error::State)?.reset();
    Ok(())
}

pub fn snapshot(state: &SharedState) -> Result<Snapshot> {
    Ok(state.lock().map_err(|_| Error::State)?.snapshot())
}

fn calculate(state: &mut state::State) -> Result<Option<Analysis>> {
    let peaks = find_peaks(state.window());
    let (mut bpm, mut ibi_stddev_ms, mut peak_amplitude, stable) = if peaks.len() >= 2 {
        let ibis = intervals(&peaks);
        let mean_ibi = mean(&ibis);
        let ibi_stddev_ms = stddev(&ibis, mean_ibi);
        let peak_amplitude =
            peaks.iter().map(|peak| peak.amplitude).sum::<f32>() / peaks.len() as f32;
        let bpm = if mean_ibi > 0.0 {
            60_000.0 / mean_ibi
        } else {
            0.0
        };

        state.set_last_values(bpm, ibi_stddev_ms, peak_amplitude);
        (
            bpm,
            ibi_stddev_ms,
            peak_amplitude,
            ibi_stddev_ms <= IBI_STDEV_UNSTABLE_MS,
        )
    } else {
        let (last_bpm, last_ibi_stddev_ms, last_peak_amplitude) = state.last_values();
        (last_bpm, last_ibi_stddev_ms, last_peak_amplitude, false)
    };

    if stable && !state.first_stable_found() {
        state.mark_first_stable();
        log::debug!("first stable pulse analysis found");
    }

    if !state.first_stable_found() {
        return Ok(None);
    }

    bpm = round2(bpm);
    ibi_stddev_ms = round3(ibi_stddev_ms);
    peak_amplitude = round3(peak_amplitude);

    let (trend_20s, trend_1m, trend_5m) = state.push_trends(bpm);
    let confidence_percent = if stable { 85 } else { 35 };
    let analysis = Analysis {
        bpm,
        ibi_stddev_ms,
        peak_amplitude,
        stable,
        confidence_percent,
        trend_20s,
        trend_1m,
        trend_5m,
    };

    state.set_analysis(analysis);
    Ok(Some(analysis))
}

#[derive(Clone, Copy)]
struct Peak {
    elapsed_ms: u32,
    amplitude: f32,
}

fn find_peaks(samples: &VecDeque<Sample>) -> Vec<Peak> {
    let samples: Vec<_> = samples.iter().copied().collect();
    let mut candidates = Vec::new();

    for index in 1..samples.len().saturating_sub(1) {
        let previous = samples[index - 1].filtered;
        let current = samples[index].filtered;
        let next = samples[index + 1].filtered;

        if !(current > previous && current >= next && current >= PEAK_THRESHOLD) {
            continue;
        }

        candidates.push(Peak {
            elapsed_ms: samples[index].elapsed_ms,
            amplitude: current,
        });
    }

    retain_highest_peaks(candidates)
}

fn retain_highest_peaks(candidates: Vec<Peak>) -> Vec<Peak> {
    let mut keep = vec![true; candidates.len()];
    let mut by_amplitude: Vec<_> = (0..candidates.len()).collect();
    by_amplitude.sort_by(|left, right| {
        candidates[*right]
            .amplitude
            .total_cmp(&candidates[*left].amplitude)
    });

    for index in by_amplitude {
        if !keep[index] {
            continue;
        }

        let peak_at = candidates[index].elapsed_ms;

        for previous in (0..index).rev() {
            if peak_at - candidates[previous].elapsed_ms >= MIN_PEAK_DISTANCE_MS {
                break;
            }
            keep[previous] = false;
        }

        for next in index + 1..candidates.len() {
            if candidates[next].elapsed_ms - peak_at >= MIN_PEAK_DISTANCE_MS {
                break;
            }
            keep[next] = false;
        }
    }

    candidates
        .into_iter()
        .enumerate()
        .filter_map(|(index, peak)| keep[index].then_some(peak))
        .collect()
}

fn intervals(peaks: &[Peak]) -> Vec<f32> {
    peaks
        .windows(2)
        .map(|window| (window[1].elapsed_ms - window[0].elapsed_ms) as f32)
        .collect()
}

fn mean(values: &[f32]) -> f32 {
    values.iter().sum::<f32>() / values.len() as f32
}

fn stddev(values: &[f32], mean: f32) -> f32 {
    let variance = values
        .iter()
        .map(|value| {
            let diff = value - mean;
            diff * diff
        })
        .sum::<f32>()
        / values.len() as f32;

    variance.sqrt()
}

fn validate_timestamp(previous_ms: u32, current_ms: u32) -> Result<()> {
    let Some(actual_ms) = current_ms.checked_sub(previous_ms) else {
        return Err(Error::NonMonotonic {
            previous_ms,
            current_ms,
        });
    };

    let min_ms = SAMPLE_PERIOD_MS.saturating_sub(SAMPLE_PERIOD_TOLERANCE_MS);
    let max_ms = SAMPLE_PERIOD_MS.saturating_add(SAMPLE_PERIOD_TOLERANCE_MS);
    if actual_ms < min_ms || actual_ms > max_ms {
        log::warn!(
            "unexpected pulse sample cadence: expected about {}ms, got {}ms",
            SAMPLE_PERIOD_MS,
            actual_ms
        );
    }

    Ok(())
}

fn round2(value: f32) -> f32 {
    (value * 100.0).round() / 100.0
}

fn round3(value: f32) -> f32 {
    (value * 1_000.0).round() / 1_000.0
}
