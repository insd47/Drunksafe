use std::time::Duration;

pub(super) const READ_TIMEOUT: Duration = Duration::from_millis(20);
pub(super) const MAX30102_ADDRESS: u8 = 0x57;
pub(super) const FIFO_DATA: u8 = 0x07;
pub(super) const SAMPLE_RATE_HZ: usize = 100;
pub(super) const SAMPLE_PERIOD_MS: u32 = 10;
pub(super) const SAMPLE_PERIOD_TOLERANCE_MS: u32 = 2;
pub(super) const START_DELAY_SAMPLES: usize = 10 * SAMPLE_RATE_HZ;
pub(super) const ANALYSIS_INTERVAL_SAMPLES: usize = 5 * SAMPLE_RATE_HZ;
pub(super) const PEAK_THRESHOLD: f32 = 50.0;
pub(super) const MIN_PEAK_DISTANCE_MS: u32 = 300;
pub(super) const IBI_STDEV_UNSTABLE_MS: f32 = 200.0;
pub(super) const WINDOW_SAMPLES: usize = 500;
pub(super) const TREND_20S_SAMPLES: usize = 4;
pub(super) const TREND_1M_SAMPLES: usize = 12;
pub(super) const TREND_5M_SAMPLES: usize = 60;
pub(super) const FILTER_B: [f32; 5] = [0.006_867_866, 0.0, -0.013_735_732, 0.0, 0.006_867_866];
pub(super) const FILTER_A: [f32; 5] = [1.0, -3.734_089_4, 5.250_135_4, -3.295_702_5, 0.779_739_44];
