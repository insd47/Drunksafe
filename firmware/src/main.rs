use std::time::Duration;

use esp_idf_svc::hal::adc::attenuation::DB_12;
use esp_idf_svc::hal::adc::oneshot::config::AdcChannelConfig;
use esp_idf_svc::hal::adc::oneshot::{AdcChannelDriver, AdcDriver};
use esp_idf_svc::hal::gpio::{Input, PinDriver, Pull};
use esp_idf_svc::hal::peripherals::Peripherals;
use esp_idf_svc::sys::{esp_timer_get_time, EspError};

mod feature;

const SAMPLE_INTERVAL_US: u64 = 10_000;
const PROBE_DURATION_US: u64 = 20_000_000;
const PROBE_SAMPLE_COUNT: usize = (PROBE_DURATION_US / SAMPLE_INTERVAL_US) as usize;
const ADC_AVERAGE_COUNT: u16 = 4;
const BUTTON_DEBOUNCE_MS: u64 = 40;
const BUTTON_POLL_MS: u64 = 20;
const FILTER_SETTLE_US: u64 = 500_000;
const FILTER_SETTLE_SAMPLE_COUNT: usize = (FILTER_SETTLE_US / SAMPLE_INTERVAL_US) as usize;
const MIN_PEAK_INTERVAL_US: u64 = 285_000; // 210 BPM upper bound.
const MAX_PEAK_INTERVAL_US: u64 = 1_430_000; // 42 BPM lower bound.
const PEAK_THRESHOLD_RATIO: f32 = 0.45;
const MIN_PEAK_AMPLITUDE: f32 = 1.0;
const ESP32_ADC_MAX_12BIT: u32 = 4095;
const ARDUINO_UNO_ADC_MAX_10BIT: u32 = 1023;
const KIM_THRESHOLD_UNO_10BIT: u16 = 530;
const KIM_THRESHOLD_ESP32_12BIT: u16 = uno_10bit_to_esp32_12bit(KIM_THRESHOLD_UNO_10BIT);
const KIM_TARGET_N: usize = 20;
const KIM_MIN_REPORT_SAMPLES: usize = 5;
const KIM_MAX_TOTAL_DATA: usize = 200;
const KIM_MIN_BEAT_INTERVAL_MS: u32 = 300;
const KIM_MIN_VALID_BPM: u16 = 45;
const KIM_MAX_VALID_BPM: u16 = 150;

// Ported from origin/pulse:ppg_processor.py.
// scipy.signal.butter(2, [0.7, 3.5], btype="band", fs=100.0)
const FILTER_B: [f32; 5] = [0.006_867_866, 0.0, -0.013_735_732, 0.0, 0.006_867_866];
const FILTER_A: [f32; 5] = [1.0, -3.734_089_4, 5.250_135_4, -3.295_702_5, 0.779_739_44];

struct StreamingButterworth {
    z: [f32; 4],
}

impl StreamingButterworth {
    fn new() -> Self {
        Self { z: [0.0; 4] }
    }

    fn push(&mut self, sample: f32) -> f32 {
        let y = FILTER_B[0] * sample + self.z[0];

        self.z[0] = FILTER_B[1] * sample - FILTER_A[1] * y + self.z[1];
        self.z[1] = FILTER_B[2] * sample - FILTER_A[2] * y + self.z[2];
        self.z[2] = FILTER_B[3] * sample - FILTER_A[3] * y + self.z[3];
        self.z[3] = FILTER_B[4] * sample - FILTER_A[4] * y;

        y
    }
}

#[derive(Clone, Copy, Debug)]
struct PpgSample {
    elapsed_us: u64,
    raw_12bit: u16,
    raw_uno_10bit: u16,
    beddy_filtered: f32,
}

#[derive(Clone, Copy, Debug)]
struct BeddyPulseAnalysis {
    bpm: Option<f32>,
    peak_count: u16,
    interval_count: u16,
    raw_min: u16,
    raw_max: u16,
    filtered_min: f32,
    filtered_max: f32,
    threshold: f32,
}

#[derive(Clone, Copy, Debug)]
struct KimThresholdAnalysis {
    bpm: Option<f32>,
    total_collected: usize,
    selected_count: usize,
    stddev: Option<f32>,
    selected_min: Option<u16>,
    selected_max: Option<u16>,
    raw_uno_min: u16,
    raw_uno_max: u16,
}

fn now_micros() -> u64 {
    unsafe { esp_timer_get_time() as u64 }
}

const fn uno_10bit_to_esp32_12bit(value: u16) -> u16 {
    ((value as u32 * ESP32_ADC_MAX_12BIT + ARDUINO_UNO_ADC_MAX_10BIT / 2)
        / ARDUINO_UNO_ADC_MAX_10BIT) as u16
}

fn esp32_12bit_to_uno_10bit(value: u16) -> u16 {
    ((u32::from(value) * ARDUINO_UNO_ADC_MAX_10BIT + ESP32_ADC_MAX_12BIT / 2) / ESP32_ADC_MAX_12BIT)
        as u16
}

fn wait_for_button_press(button: &PinDriver<'_, Input>) {
    loop {
        if button.is_low() {
            std::thread::sleep(Duration::from_millis(BUTTON_DEBOUNCE_MS));
            if button.is_low() {
                return;
            }
        }

        std::thread::sleep(Duration::from_millis(BUTTON_POLL_MS));
    }
}

fn wait_for_button_release(button: &PinDriver<'_, Input>) {
    while button.is_low() {
        std::thread::sleep(Duration::from_millis(BUTTON_POLL_MS));
    }

    std::thread::sleep(Duration::from_millis(BUTTON_DEBOUNCE_MS));
}

fn analyze_beddy_pulse(samples: &[PpgSample]) -> BeddyPulseAnalysis {
    let mut raw_min = u16::MAX;
    let mut raw_max = u16::MIN;
    let mut filtered_min = f32::INFINITY;
    let mut filtered_max = f32::NEG_INFINITY;
    let first_analysis_sample = FILTER_SETTLE_SAMPLE_COUNT.min(samples.len().saturating_sub(3));

    for sample in samples {
        raw_min = raw_min.min(sample.raw_12bit);
        raw_max = raw_max.max(sample.raw_12bit);
    }

    for sample in &samples[first_analysis_sample..] {
        filtered_min = filtered_min.min(sample.beddy_filtered);
        filtered_max = filtered_max.max(sample.beddy_filtered);
    }

    let positive_amplitude = filtered_max.max(0.0);
    let negative_amplitude = (-filtered_min).max(0.0);
    let polarity = if positive_amplitude >= negative_amplitude {
        1.0
    } else {
        -1.0
    };
    let threshold =
        (positive_amplitude.max(negative_amplitude) * PEAK_THRESHOLD_RATIO).max(MIN_PEAK_AMPLITUDE);

    let mut last_peak_at = None;
    let mut peak_count = 0_u16;
    let mut interval_count = 0_u16;
    let mut interval_sum_us = 0_u64;

    for index in (first_analysis_sample + 1)..samples.len().saturating_sub(1) {
        let previous = samples[index - 1].beddy_filtered * polarity;
        let current = samples[index].beddy_filtered * polarity;
        let next = samples[index + 1].beddy_filtered * polarity;

        if !(current > previous && current >= next && current >= threshold) {
            continue;
        }

        let peak_at = samples[index].elapsed_us;
        if let Some(last) = last_peak_at {
            let interval = peak_at.saturating_sub(last);
            if interval < MIN_PEAK_INTERVAL_US {
                continue;
            }

            if interval <= MAX_PEAK_INTERVAL_US {
                interval_sum_us = interval_sum_us.saturating_add(interval);
                interval_count = interval_count.saturating_add(1);
            }
        }

        peak_count = peak_count.saturating_add(1);
        last_peak_at = Some(peak_at);
    }

    let bpm = if interval_count > 0 {
        let average_interval_us = interval_sum_us as f32 / f32::from(interval_count);
        Some(60_000_000.0 / average_interval_us)
    } else {
        None
    };

    BeddyPulseAnalysis {
        bpm,
        peak_count,
        interval_count,
        raw_min,
        raw_max,
        filtered_min,
        filtered_max,
        threshold,
    }
}

fn analyze_kim_threshold(samples: &[PpgSample]) -> KimThresholdAnalysis {
    let mut beat_intervals = [900_u32; 10];
    let mut beat_index = 0_usize;
    let mut is_pulse = false;
    let mut last_beat_time_ms = 0_u32;
    let mut sample_counter_ms = 0_u32;
    let mut bpm_history = Vec::with_capacity(KIM_MAX_TOTAL_DATA);
    let mut raw_uno_min = u16::MAX;
    let mut raw_uno_max = u16::MIN;

    for sample in samples {
        sample_counter_ms = sample_counter_ms.saturating_add((SAMPLE_INTERVAL_US / 1_000) as u32);
        raw_uno_min = raw_uno_min.min(sample.raw_uno_10bit);
        raw_uno_max = raw_uno_max.max(sample.raw_uno_10bit);

        if sample.raw_12bit > KIM_THRESHOLD_ESP32_12BIT
            && !is_pulse
            && sample_counter_ms.saturating_sub(last_beat_time_ms) > KIM_MIN_BEAT_INTERVAL_MS
        {
            is_pulse = true;
            let ibi = sample_counter_ms.saturating_sub(last_beat_time_ms);
            last_beat_time_ms = sample_counter_ms;

            beat_intervals[beat_index] = ibi;
            beat_index = (beat_index + 1) % beat_intervals.len();

            let running_total: u32 = beat_intervals.iter().sum();
            let avg_ibi = running_total / beat_intervals.len() as u32;
            if avg_ibi > 0 {
                let calculated_bpm = 60_000_u32 / avg_ibi;
                if calculated_bpm > u32::from(KIM_MIN_VALID_BPM)
                    && calculated_bpm < u32::from(KIM_MAX_VALID_BPM)
                    && bpm_history.len() < KIM_MAX_TOTAL_DATA
                {
                    bpm_history.push(calculated_bpm as u16);
                }
            }
        }

        if sample.raw_12bit < KIM_THRESHOLD_ESP32_12BIT {
            is_pulse = false;
        }
    }

    let total_collected = bpm_history.len();
    if total_collected <= KIM_MIN_REPORT_SAMPLES {
        return KimThresholdAnalysis {
            bpm: None,
            total_collected,
            selected_count: 0,
            stddev: None,
            selected_min: None,
            selected_max: None,
            raw_uno_min,
            raw_uno_max,
        };
    }

    bpm_history.sort_unstable();
    let selected_count = total_collected.min(KIM_TARGET_N);
    let mut best_avg = 0.0_f32;
    let mut best_stddev = f32::INFINITY;
    let mut best_min = None;
    let mut best_max = None;

    for start_index in 0..=(total_collected - selected_count) {
        let window = &bpm_history[start_index..start_index + selected_count];
        let sum: u32 = window.iter().map(|value| u32::from(*value)).sum();
        let avg = sum as f32 / selected_count as f32;
        let variance_sum: f32 = window
            .iter()
            .map(|value| {
                let diff = f32::from(*value) - avg;
                diff * diff
            })
            .sum();
        let stddev = (variance_sum / selected_count as f32).sqrt();

        if stddev < best_stddev {
            best_stddev = stddev;
            best_avg = avg;
            best_min = window.first().copied();
            best_max = window.last().copied();
        }
    }

    KimThresholdAnalysis {
        bpm: Some(best_avg),
        total_collected,
        selected_count,
        stddev: Some(best_stddev),
        selected_min: best_min,
        selected_max: best_max,
        raw_uno_min,
        raw_uno_max,
    }
}

fn optional_bpm_text(value: Option<f32>) -> String {
    match value {
        Some(value) => format!("{value:.1}"),
        None => "unavailable".to_string(),
    }
}

fn optional_f32_text(value: Option<f32>) -> String {
    match value {
        Some(value) => format!("{value:.3}"),
        None => "unavailable".to_string(),
    }
}

fn optional_u16_text(value: Option<u16>) -> String {
    match value {
        Some(value) => value.to_string(),
        None => "unavailable".to_string(),
    }
}

fn main() -> Result<(), EspError> {
    esp_idf_svc::sys::link_patches();
    esp_idf_svc::log::EspLogger::initialize_default();

    log::info!("Drunksafe PPG algorithm comparison probe started");
    log::info!("Probe input: GPIO36 / ADC1_CH0, button: BOOT GPIO0 active-low");

    let peripherals = Peripherals::take()?;
    let pins = peripherals.pins;
    let adc = AdcDriver::new(peripherals.adc1)?;
    let config = AdcChannelConfig {
        attenuation: DB_12,
        ..Default::default()
    };
    let mut ppg_pin = AdcChannelDriver::new(&adc, pins.gpio36, &config)?;
    let button = PinDriver::input(pins.gpio0, Pull::Up)?;

    loop {
        println!("ready,press_boot_button");
        wait_for_button_press(&button);

        println!(
            "probe,start,duration_ms,{},sample_hz,100,adc_average,{},beddy_source,origin/pulse:ppg_processor.py,kim_source,origin/feature/parts-list:sketch/esp32.ino",
            PROBE_DURATION_US / 1_000,
            ADC_AVERAGE_COUNT
        );

        let mut filter = StreamingButterworth::new();
        let mut samples = Vec::with_capacity(PROBE_SAMPLE_COUNT);
        let probe_started_at = now_micros();
        let mut next_sample_at = probe_started_at;

        for index in 0..PROBE_SAMPLE_COUNT {
            let now = now_micros();
            if now < next_sample_at {
                std::thread::sleep(Duration::from_micros(next_sample_at - now));
            }

            let sample_time = now_micros();
            next_sample_at = next_sample_at.saturating_add(SAMPLE_INTERVAL_US);

            let mut sum = 0_u32;
            for _ in 0..ADC_AVERAGE_COUNT {
                sum += u32::from(adc.read_raw(&mut ppg_pin)?);
            }

            let raw = (sum / u32::from(ADC_AVERAGE_COUNT)) as u16;
            let filtered = filter.push(f32::from(raw));
            samples.push(PpgSample {
                elapsed_us: sample_time.saturating_sub(probe_started_at),
                raw_12bit: raw,
                raw_uno_10bit: esp32_12bit_to_uno_10bit(raw),
                beddy_filtered: filtered,
            });

            let sample_number = index + 1;
            if sample_number % 100 == 0 {
                println!(
                    "probe,progress_percent,{}",
                    sample_number * 100 / PROBE_SAMPLE_COUNT
                );
            }
        }

        let beddy = analyze_beddy_pulse(&samples);
        let kim = analyze_kim_threshold(&samples);

        println!(
            "probe,result,worker,BeddyTear04,branch,origin/pulse,algorithm,butter_bandpass_peak,bpm,{},quality,{},peaks,{},intervals,{},raw_min_12bit,{},raw_max_12bit,{},filtered_min,{:.3},filtered_max,{:.3},peak_threshold,{:.3}",
            optional_bpm_text(beddy.bpm),
            if beddy.interval_count > 0 { "valid" } else { "insufficient" },
            beddy.peak_count,
            beddy.interval_count,
            beddy.raw_min,
            beddy.raw_max,
            beddy.filtered_min,
            beddy.filtered_max,
            beddy.threshold
        );
        println!(
            "probe,result,worker,KimJaeYoung,branch,origin/feature/parts-list,algorithm,threshold_window_stddev,bpm,{},quality,{},bpm_samples,{},selected_samples,{},stddev,{},selected_min,{},selected_max,{},raw_min_uno_10bit,{},raw_max_uno_10bit,{},threshold_uno_10bit,{},threshold_esp32_12bit,{}",
            optional_bpm_text(kim.bpm),
            if kim.bpm.is_some() { "valid" } else { "insufficient" },
            kim.total_collected,
            kim.selected_count,
            optional_f32_text(kim.stddev),
            optional_u16_text(kim.selected_min),
            optional_u16_text(kim.selected_max),
            kim.raw_uno_min,
            kim.raw_uno_max,
            KIM_THRESHOLD_UNO_10BIT,
            KIM_THRESHOLD_ESP32_12BIT
        );

        if let (Some(beddy_bpm), Some(kim_bpm)) = (beddy.bpm, kim.bpm) {
            let delta = beddy_bpm - kim_bpm;
            println!(
                "probe,compare,beddy_minus_kim_bpm,{delta:.1},abs_delta_bpm,{:.1}",
                delta.abs()
            );
        } else {
            println!("probe,compare,beddy_minus_kim_bpm,unavailable,abs_delta_bpm,unavailable");
        }

        wait_for_button_release(&button);
    }
}
