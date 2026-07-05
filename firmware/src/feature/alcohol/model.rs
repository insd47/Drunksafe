use super::command::Command;
use super::error::{Error, Result};
use super::protocol::ResponseFrame;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Concentration {
    pub mg_l_x1000: u16,
}

impl Concentration {
    pub const fn new(mg_l_x1000: u16) -> Self {
        Self { mg_l_x1000 }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Status {
    pub code: u8,
}

impl TryFrom<ResponseFrame> for Status {
    type Error = Error;

    fn try_from(frame: ResponseFrame) -> Result<Self> {
        if frame.command() != Command::Status {
            return Err(Error::UnexpectedCommand {
                expected: Command::Status.byte(),
                actual: frame.command().byte(),
            });
        }

        Ok(Self {
            code: frame.data()[0],
        })
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Sample {
    pub concentration: Concentration,
}

impl TryFrom<ResponseFrame> for Sample {
    type Error = Error;

    fn try_from(frame: ResponseFrame) -> Result<Self> {
        if frame.command() != Command::Result {
            return Err(Error::UnexpectedCommand {
                expected: Command::Result.byte(),
                actual: frame.command().byte(),
            });
        }

        Ok(Self {
            concentration: Concentration::new(frame.word(0)?),
        })
    }
}
