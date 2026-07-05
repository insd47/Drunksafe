use super::model::{Sample, Status};
use crate::feature::state::{shared, Shared};

#[derive(Debug, Default)]
pub struct State {
    status: Option<Status>,
    last_sample: Option<Sample>,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct Snapshot {
    pub has_status: bool,
    pub has_sample: bool,
}

pub type SharedState = Shared<State>;

pub fn init() -> SharedState {
    shared(State::default())
}

impl State {
    pub const fn snapshot(&self) -> Snapshot {
        Snapshot {
            has_status: self.status.is_some(),
            has_sample: self.last_sample.is_some(),
        }
    }

    pub fn set_status(&mut self, status: Status) {
        self.status = Some(status);
    }

    pub fn set_sample(&mut self, sample: Sample) {
        self.last_sample = Some(sample);
    }
}
