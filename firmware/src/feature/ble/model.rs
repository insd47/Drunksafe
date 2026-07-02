#![allow(dead_code)]

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u8 = 1;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SensorType {
    Mq3,
    Max30102,
    Mlx90614,
    Mpu6050,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MeasurementState {
    Idle,
    WarmingUp,
    Ready,
    Measuring,
    Analyzing,
    Completed,
    Failed,
    Canceled,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskLevel {
    Safe,
    Caution,
    Danger,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RecommendationType {
    Rest,
    NoDriving,
    Clinic,
    Moderation,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "cmd")]
pub enum ControlCommand {
    StartMeasurement {
        session_id: String,
        duration_ms: u32,
        sample_hz: u8,
        sensors: Vec<SensorType>,
    },
    CancelMeasurement {
        session_id: String,
    },
    SyncTime {
        unix_time_ms: u64,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SensorStatus {
    pub sensor_type: SensorType,
    pub connected: bool,
    pub calibrated: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct StatusError {
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DeviceStatus {
    pub v: u8,
    pub state: MeasurementState,
    pub progress_percent: u8,
    pub battery_percent: Option<u8>,
    pub sensors: Vec<SensorStatus>,
    pub error: Option<StatusError>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SampleFrame {
    pub v: u8,
    pub session_id: String,
    pub seq: u16,
    pub elapsed_ms: u32,
    pub progress_percent: u8,
    pub mq3_adc: u16,
    pub alcohol_ppm_x10: u16,
    pub heart_rate_bpm: Option<u8>,
    pub spo2_percent: Option<u8>,
    pub body_temp_c_x10: Option<i16>,
    pub tremor_mg_x10: Option<i16>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct MeasurementQuality {
    pub breath_sample_valid: bool,
    pub confidence_percent: u8,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct MeasurementResult {
    pub v: u8,
    pub session_id: String,
    pub measured_at_unix_ms: u64,
    pub bac_milli_percent: u16,
    pub risk_level: RiskLevel,
    pub sober_time_minutes: Option<u16>,
    pub quality: MeasurementQuality,
    pub summary: SampleFrame,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Recommendation {
    pub recommendation_type: RecommendationType,
    pub title: String,
    pub body: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "event")]
pub enum BleEvent {
    DeviceStatus(DeviceStatus),
    SampleFrame(SampleFrame),
    MeasurementResult(MeasurementResult),
    Recommendation(Recommendation),
}
