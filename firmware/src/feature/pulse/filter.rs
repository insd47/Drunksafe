// Ported from origin/modules-fixed:ppg_processor.py.
// scipy.signal.butter(2, [0.7, 3.5], btype="band", fs=100.0)
use super::params;

#[derive(Clone, Copy, Debug, Default)]
pub struct StreamingButterworth {
    z: [f32; 4],
}

impl StreamingButterworth {
    pub const fn new() -> Self {
        Self { z: [0.0; 4] }
    }

    pub fn push(&mut self, sample: f32) -> f32 {
        let y = params::FILTER_B[0] * sample + self.z[0];

        self.z[0] = params::FILTER_B[1] * sample - params::FILTER_A[1] * y + self.z[1];
        self.z[1] = params::FILTER_B[2] * sample - params::FILTER_A[2] * y + self.z[2];
        self.z[2] = params::FILTER_B[3] * sample - params::FILTER_A[3] * y + self.z[3];
        self.z[3] = params::FILTER_B[4] * sample - params::FILTER_A[4] * y;

        y
    }
}
