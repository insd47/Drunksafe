use crate::services::measure::Measurement;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum View {
    Home,
    Measuring,
    Failed,
    Result(Measurement),
}
