#[derive(Debug, Clone, Copy)]
pub enum TimeoutKind {
    PulseMeasurement,
    AlcoholResult,
}

impl core::fmt::Display for TimeoutKind {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::PulseMeasurement => f.write_str("pulse measurement"),
            Self::AlcoholResult => f.write_str("alcohol result wait"),
        }
    }
}

impl From<TimeoutKind> for super::Error {
    fn from(timeout: TimeoutKind) -> Self {
        Self::Timeout(timeout)
    }
}
