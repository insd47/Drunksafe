use crate::services::measure::Measurement;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum View {
    Home,
    Measuring,
    AwaitingPulse,
    PulseStream,
    Session,
    SessionConfirm,
    Failed,
    Result(Measurement),
}
