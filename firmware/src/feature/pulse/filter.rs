// Ported from origin/modules-fixed:ppg_processor.py.
// scipy.signal.butter(2, [0.7, 3.5], btype="band", fs=100.0)
const B: [f32; 5] = [0.006_867_866, 0.0, -0.013_735_732, 0.0, 0.006_867_866];
const A: [f32; 5] = [1.0, -3.734_089_4, 5.250_135_4, -3.295_702_5, 0.779_739_44];

#[derive(Clone, Copy, Debug, Default)]
pub struct StreamingButterworth {
    z: [f32; 4],
}

impl StreamingButterworth {
    pub const fn new() -> Self {
        Self { z: [0.0; 4] }
    }

    pub fn push(&mut self, sample: f32) -> f32 {
        let y = B[0] * sample + self.z[0];

        self.z[0] = B[1] * sample - A[1] * y + self.z[1];
        self.z[1] = B[2] * sample - A[2] * y + self.z[2];
        self.z[2] = B[3] * sample - A[3] * y + self.z[3];
        self.z[3] = B[4] * sample - A[4] * y;

        y
    }
}
