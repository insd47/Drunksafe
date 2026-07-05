use channel::Channel;
use command::Command;
pub use error::{Error, Result};
use esp_idf_svc::hal::uart::UartDriver;
pub use model::Concentration;
use std::time::Duration;

mod channel;
mod command;
mod error;
mod model;
mod protocol;

const DEFAULT_READ_TIMEOUT: Duration = Duration::from_millis(100);

/// ZE29 알코올 센서를 다루는 device handle이다.
///
/// UART driver는 `devices::init()`에서 보드 배선에 맞게 구성해 전달한다.
/// 이 타입은 ZE29 request/response frame을 만들고 해석하는 책임만 가진다.
pub struct AlcoholDevice<'d> {
    channel: Channel<'d>,
}

impl<'d> AlcoholDevice<'d> {
    /// 구성된 UART driver로 ZE29 device handle을 만든다.
    pub const fn new(uart: UartDriver<'d>) -> Self {
        let channel = Channel::new(uart);
        Self { channel }
    }

    /// 현재 알코올 측정값을 읽는다.
    ///
    /// ZE29 `0x86` read test results 명령을 사용한다.
    #[allow(dead_code)]
    pub fn test(&mut self) -> Result<Concentration> {
        let res = self.channel.request(Command::Result, [0; 5])?;
        Ok(Concentration::new(res.word(0)?))
    }

    /// 센서 모듈의 현재 상태 코드를 읽는다.
    ///
    /// ZE29 `0x85` query module status 명령을 사용한다.
    #[allow(dead_code)]
    pub fn status(&mut self) -> Result<u8> {
        let res = self.channel.request(Command::Status, [0; 5])?;
        Ok(res.payload()[0])
    }

    /// 센서 모듈의 wake 상태를 전환한다.
    ///
    /// ZE29 `0x87` switch module working status 명령을 사용한다.
    #[allow(dead_code)]
    pub fn work(&mut self, wake: bool) -> Result<()> {
        self.channel
            .request(Command::Work, [wake as u8, 0, 0, 0, 0])?;

        Ok(())
    }
}
