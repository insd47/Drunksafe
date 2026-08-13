pub const SAMPLE_AVERAGE_READS: u32 = 4;
pub const SAMPLE_RATE_HZ: usize = 100;
pub const SAMPLE_PERIOD_MS: u32 = 10;
pub const SAMPLE_PERIOD_TOLERANCE_MS: u32 = 2;
pub const START_DELAY_SAMPLES: usize = 20 * SAMPLE_RATE_HZ;
pub const ANALYSIS_INTERVAL_SAMPLES: usize = 5 * SAMPLE_RATE_HZ;
pub const PEAK_THRESHOLD: f32 = 50.0;
pub const MIN_PEAK_DISTANCE_MS: u32 = 300;
// 손끝 PPG는 미세한 움직임에도 IBI 변동이 커진다. 실측에서 BPM은 정확한데 IBI
// 표준편차가 130ms 안팎으로 나와 60ms 기준으로는 늘 unstable로 떨어졌다. 평균 BPM이
// 정확한 범위를 stable로 인정하도록 여유 있게 잡는다.
pub const IBI_STDEV_UNSTABLE_MS: f32 = 300.0;
pub const WINDOW_SAMPLES: usize = 2000;
pub const FILTER_B: [f32; 5] = [0.006_867_866, 0.0, -0.013_735_732, 0.0, 0.006_867_866];
pub const FILTER_A: [f32; 5] = [1.0, -3.734_089_4, 5.250_135_4, -3.295_702_5, 0.779_739_44];
