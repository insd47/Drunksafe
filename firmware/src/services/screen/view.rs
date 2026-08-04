use crate::services::measure::Measurement;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum View {
    Home,
    Context,
    Measuring,
    Analyzing,
    Failed,
    Result(Measurement),
}
