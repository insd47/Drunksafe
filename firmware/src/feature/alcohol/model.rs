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
pub struct Raw {
    pub command: Command,
    pub data: [u8; 6],
}

impl Raw {
    pub const fn new(command: Command, data: [u8; 6]) -> Self {
        Self { command, data }
    }
}

impl From<ResponseFrame> for Raw {
    fn from(frame: ResponseFrame) -> Self {
        Self::new(frame.command(), *frame.data())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Status {
    pub code: u8,
    pub raw: Raw,
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
            raw: frame.into(),
        })
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Sample {
    pub concentration: Concentration,
    pub raw: Raw,
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
            raw: frame.into(),
        })
    }
}
