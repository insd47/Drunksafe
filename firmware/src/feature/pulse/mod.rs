pub use error::{Error, Result};
pub use model::{Analysis, Sample};
pub use state::State;

mod algorithm;
mod error;
mod filter;
mod model;
mod params;
mod state;

pub fn sample(state: &mut State, elapsed_ms: u32, raw_12bit: u16) -> Result<Option<Analysis>> {
    if let Some(previous) = state.window().back() {
        validate_timestamp(previous.elapsed_ms, elapsed_ms)?;
    }

    let filtered = state.filter(raw_12bit);
    state.push(Sample {
        elapsed_ms,
        raw_12bit,
        filtered,
    });

    if state.total_samples() < params::START_DELAY_SAMPLES {
        return Ok(None);
    }

    if state.total_samples() == params::START_DELAY_SAMPLES {
        state.mark_analyzed();
        return Ok(None);
    }

    if state.samples_since_analysis() < params::ANALYSIS_INTERVAL_SAMPLES {
        return Ok(None);
    }

    state.mark_analyzed();
    Ok(algorithm::calculate(state))
}

pub fn analyze(state: &State) -> Option<Analysis> {
    state.last_analysis()
}

pub fn reset(state: &mut State) {
    state.reset();
}

fn validate_timestamp(previous_ms: u32, current_ms: u32) -> Result<()> {
    let Some(actual_ms) = current_ms.checked_sub(previous_ms) else {
        return Err(Error::NonMonotonic {
            previous_ms,
            current_ms,
        });
    };

    let min_ms = params::SAMPLE_PERIOD_MS.saturating_sub(params::SAMPLE_PERIOD_TOLERANCE_MS);
    let max_ms = params::SAMPLE_PERIOD_MS.saturating_add(params::SAMPLE_PERIOD_TOLERANCE_MS);
    if actual_ms < min_ms || actual_ms > max_ms {
        log::warn!(
            "unexpected pulse sample cadence: expected about {}ms, got {}ms",
            params::SAMPLE_PERIOD_MS,
            actual_ms
        );
    }

    Ok(())
}
