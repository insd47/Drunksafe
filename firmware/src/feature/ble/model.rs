#![allow(dead_code)]

use serde::{Deserialize, Serialize};

use crate::feature::alchol;

pub const PROTOCOL_VERSION: u8 = 4;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    BoardButton,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum State {
    Idle,
    Context,
    Measuring,
    Done,
    Error,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Risk {
    Safe,
    Caution,
    Danger,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Status {
    pub v: u8,
    pub state: State,
    pub session_id: Option<String>,
    pub battery_percent: Option<u8>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Session {
    pub v: u8,
    pub session_id: String,
    pub source: Source,
    pub history_limit: u8,
    pub sync_time: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct History {
    pub measured_at_unix_ms: u64,
    pub alcohol_mg_l_x1000: u16,
    pub risk: Risk,
    pub confidence_percent: u8,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Context {
    pub v: u8,
    pub session_id: String,
    pub phone_time_unix_ms: Option<u64>,
    pub recent: Vec<History>,
    pub sober_alcohol_mg_l_x1000: Option<u16>,
    pub elimination_mg_l_per_hour_x1000: Option<u16>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Progress {
    pub v: u8,
    pub session_id: String,
    pub state: State,
    pub percent: u8,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Report {
    pub v: u8,
    pub session_id: String,
    pub measured_at_unix_ms: Option<u64>,
    pub alcohol: alchol::Sample,
    pub bac_milli_percent: Option<u16>,
    pub sober_time_minutes: Option<u16>,
    pub risk: Risk,
    pub confidence_percent: u8,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "cmd")]
pub enum PhoneToDevice {
    Context(Context),
    Cancel { session_id: String },
    Time { unix_time_ms: u64 },
    Ack { session_id: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "event")]
pub enum DeviceToPhone {
    Status(Status),
    Session(Session),
    Progress(Progress),
    Result(Report),
}
