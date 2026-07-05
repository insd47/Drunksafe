#![allow(dead_code)]

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u8 = 2;

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
pub enum MeasurementStartSource {
    BoardButton,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MeasurementState {
    WaitingForButton,
    RequestingPhoneContext,
    Calibrating,
    Measuring,
    Analyzing,
    Completed,
    Failed,
    Canceled,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PhoneContextField {
    RecentMeasurements,
    UserBaseline,
    LastCalibration,
    TimeSync,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskLevel {
    Safe,
    Caution,
    Danger,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ContextRequest {
    pub requested_history_limit: u8,
    pub requested_fields: Vec<PhoneContextField>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct MeasurementSessionRequest {
    pub v: u8,
    pub session_id: String,
    pub source: MeasurementStartSource,
    pub context_request: ContextRequest,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct HistoricalMeasurement {
    pub measured_at_unix_ms: u64,
    pub bac_milli_percent: u16,
    pub risk_level: RiskLevel,
    pub confidence_percent: u8,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct UserBaseline {
    pub sober_mq3_adc: Option<u16>,
    pub resting_heart_rate_bpm: Option<u8>,
    pub body_temp_c_x10: Option<i16>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CalibrationSnapshot {
    pub recorded_at_unix_ms: u64,
    pub clean_air_mq3_adc: u16,
    pub zero_offset_adc: i16,
    pub sensor_temp_c_x10: Option<i16>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct MeasurementContext {
    pub v: u8,
    pub session_id: String,
    pub phone_time_unix_ms: Option<u64>,
    pub history: Vec<HistoricalMeasurement>,
    pub user_baseline: Option<UserBaseline>,
    pub last_calibration: Option<CalibrationSnapshot>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "cmd")]
pub enum PhoneToDeviceMessage {
    ProvideMeasurementContext(MeasurementContext),
    ContextUnavailable { session_id: String, reason: String },
    SyncTime { unix_time_ms: u64 },
    CancelMeasurement { session_id: String },
    AcknowledgeResult { session_id: String },
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
    pub active_session_id: Option<String>,
    pub battery_percent: Option<u8>,
    pub sensors: Vec<SensorStatus>,
    pub error: Option<StatusError>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CalibrationProgress {
    pub v: u8,
    pub session_id: String,
    pub progress_percent: u8,
    pub stable: bool,
    pub clean_air_mq3_adc: Option<u16>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct MeasurementProgress {
    pub v: u8,
    pub session_id: String,
    pub state: MeasurementState,
    pub progress_percent: u8,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CalibrationResult {
    pub clean_air_mq3_adc: u16,
    pub zero_offset_adc: i16,
    pub stable: bool,
    pub duration_ms: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct MeasurementQuality {
    pub breath_sample_valid: bool,
    pub context_used: bool,
    pub calibration_valid: bool,
    pub confidence_percent: u8,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SensorSummary {
    pub mq3_adc: u16,
    pub alcohol_ppm_x10: u16,
    pub heart_rate_bpm: Option<u8>,
    pub spo2_percent: Option<u8>,
    pub body_temp_c_x10: Option<i16>,
    pub tremor_mg_x10: Option<i16>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct MeasurementResult {
    pub v: u8,
    pub session_id: String,
    pub measured_at_unix_ms: Option<u64>,
    pub bac_milli_percent: u16,
    pub risk_level: RiskLevel,
    pub sober_time_minutes: Option<u16>,
    pub quality: MeasurementQuality,
    pub calibration: CalibrationResult,
    pub sensors: SensorSummary,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "event")]
pub enum DeviceToPhoneMessage {
    DeviceStatus(DeviceStatus),
    MeasurementSessionRequest(MeasurementSessionRequest),
    CalibrationProgress(CalibrationProgress),
    MeasurementProgress(MeasurementProgress),
    MeasurementResult(MeasurementResult),
}
