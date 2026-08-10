use crate::services::measure::Measurement;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum View {
    Home,
    Measuring,
    MeasuringPulse { signal_percent: u8 },
    Failed,
    Result(Measurement),
}
