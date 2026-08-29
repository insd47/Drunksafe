use crate::services::measure::Measurement;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum View {
    HomeDisconnected,
    HomeReady,
    Measuring,
    BlowNow,
    AwaitingPulse,
    PulseStream,
    Session,
    SessionConfirm,
    FittingWaiting,
    FittingConfirm,
    CheckApp,
    FittingRetry,
    FittingSlotMissed,
    Failed,
    Result(Measurement),
}
