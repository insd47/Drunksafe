use serde::{Deserialize, Serialize};

/// Final result keeps the existing BLE result contract; live diagnostics carry detail.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PulseUnavailableReason {
    NoSignal,
    Unstable,
}
