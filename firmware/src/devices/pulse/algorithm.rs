use super::model::{Analysis, Diagnosis, Sample};
use super::{params, state};
use std::collections::VecDeque;

/// first_stable gate 없이 현재 window를 즉석 분석한다. 실시간 스트리밍 진단용이며
/// 분석 상태(peak_found, first_stable 등)를 바꾸지 않는 순수 계산이다.
pub fn diagnose(window: &VecDeque<Sample>) -> Diagnosis {
    let peaks = find_peaks(window);
    let peak_count = peaks.len() as u16;

    if peaks.len() < 2 {
        return Diagnosis {
            bpm: 0.0,
            ibi_stddev_ms: 0.0,
            peak_count,
            stable: false,
        };
    }

    let ibis = intervals(&peaks);
    let mean_ibi = mean(&ibis);
    let ibi_stddev_ms = stddev(&ibis, mean_ibi);
    let bpm = if mean_ibi > 0.0 { 60_000.0 / mean_ibi } else { 0.0 };

    Diagnosis {
        bpm: round(bpm, 1),
        ibi_stddev_ms: round(ibi_stddev_ms, 1),
        peak_count,
        stable: ibi_stddev_ms <= params::IBI_STDEV_UNSTABLE_MS,
    }
}

pub fn calculate(state: &mut state::State) -> Option<Analysis> {
    let peaks = find_peaks(state.window());

    if !peaks.is_empty() {
        state.mark_peak_found();
    }

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
            ibi_stddev_ms <= params::IBI_STDEV_UNSTABLE_MS,
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
        return None;
    }

    bpm = round(bpm, 2);
    ibi_stddev_ms = round(ibi_stddev_ms, 3);
    peak_amplitude = round(peak_amplitude, 3);

    let confidence_percent = if stable { 85 } else { 35 };
    Some(Analysis {
        bpm,
        ibi_stddev_ms,
        peak_amplitude,
        stable,
        confidence_percent,
    })
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

        if !(current > previous && current >= next && current >= params::PEAK_THRESHOLD) {
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
            if peak_at - candidates[previous].elapsed_ms >= params::MIN_PEAK_DISTANCE_MS {
                break;
            }
            keep[previous] = false;
        }

        for next in index + 1..candidates.len() {
            if candidates[next].elapsed_ms - peak_at >= params::MIN_PEAK_DISTANCE_MS {
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

fn round(value: f32, places: i32) -> f32 {
    let scale = 10_f32.powi(places);
    (value * scale).round() / scale
}
