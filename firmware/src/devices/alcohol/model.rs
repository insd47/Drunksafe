use super::command::Command;
use super::error::{Error, Result};
use super::protocol::ResponseFrame;
use serde::{Deserialize, Serialize};

/// 호기 알코올 농도다.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Concentration {
    /// mg/L 단위를 1000배 정수로 표현한 값이다.
    pub mg_l_x1000: u16,
}

impl Concentration {
    /// mg/L x1000 정수값으로 농도 모델을 만든다.
    pub const fn new(mg_l_x1000: u16) -> Self {
        Self { mg_l_x1000 }
    }
}

/// ZE29 모듈 상태 응답이다.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Status {
    /// ZE29 status 응답 payload의 첫 번째 상태 코드다.
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

/// ZE29 알코올 측정 응답이다.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Sample {
    /// 센서가 반환한 호기 알코올 농도다.
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
