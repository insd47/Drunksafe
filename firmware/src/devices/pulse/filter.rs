// Ported from origin/modules-fixed:ppg_processor.py.
// scipy.signal.butter(2, [0.7, 3.5], btype="band", fs=100.0)
use super::params;

#[derive(Clone, Copy, Debug, Default)]
pub struct StreamingButterworth {
    z: [f32; 4],
    reference: f32,
    initialized: bool,
}

impl StreamingButterworth {
    pub const fn new() -> Self {
        Self {
            z: [0.0; 4],
            reference: 0.0,
            initialized: false,
        }
    }

    pub fn push(&mut self, sample: f32) -> f32 {
        // The PPG signal rides on a large sensor/contact-dependent DC level.
        // Feeding that level into a zero-state IIR creates a large transient
        // each time contact acquisition resets the filter.  The working
        // standalone sketch removes the initial constant offset first.
        if !self.initialized {
            self.reference = sample;
            self.initialized = true;
        }
        let input = sample - self.reference;
        let y = params::FILTER_B[0] * input + self.z[0];

        self.z[0] = params::FILTER_B[1] * input - params::FILTER_A[1] * y + self.z[1];
        self.z[1] = params::FILTER_B[2] * input - params::FILTER_A[2] * y + self.z[2];
        self.z[2] = params::FILTER_B[3] * input - params::FILTER_A[3] * y + self.z[3];
        self.z[3] = params::FILTER_B[4] * input - params::FILTER_A[4] * y;

        y
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constant_sensor_dc_does_not_create_a_filter_transient() {
        for dc in [500.0, 2000.0, 3500.0] {
            let mut filter = StreamingButterworth::new();
            for _ in 0..500 {
                assert!(filter.push(dc).abs() < 0.001);
            }
        }
    }
}
