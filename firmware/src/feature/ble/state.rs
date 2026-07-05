use crate::feature::state::{shared, Shared};

use super::model::PROTOCOL_VERSION;

#[derive(Debug)]
pub struct State {
    protocol_version: u8,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Snapshot {
    pub protocol_version: u8,
}

impl Default for State {
    fn default() -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
        }
    }
}

impl State {
    pub const fn snapshot(&self) -> Snapshot {
        Snapshot {
            protocol_version: self.protocol_version,
        }
    }
}

pub type SharedState = Shared<State>;

pub fn init() -> SharedState {
    shared(State::default())
}
