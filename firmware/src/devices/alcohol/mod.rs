use esp_idf_svc::hal::delay::TickType;
use esp_idf_svc::hal::uart::UartDriver;
use protocol::FRAME_LEN;
use std::time::Duration;

pub use error::{Error, Result};
pub use model::{Sample, Status};

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
    uart: UartDriver<'d>,
}

impl<'d> AlcoholDevice<'d> {
    /// 구성된 UART driver로 ZE29 device handle을 만든다.
    pub const fn new(uart: UartDriver<'d>) -> Self {
        Self { uart }
    }

    /// 현재 알코올 측정값을 읽는다.
    ///
    /// ZE29 `0x86` read test results 명령을 사용한다.
    #[allow(dead_code)]
    pub fn sample(&mut self) -> Result<Sample> {
        self.query(command::Command::Result, [0; 5])?.try_into()
    }

    /// 센서 모듈의 현재 상태 코드를 읽는다.
    ///
    /// ZE29 `0x85` query module status 명령을 사용한다.
    #[allow(dead_code)]
    pub fn status(&mut self) -> Result<Status> {
        self.query(command::Command::Status, [0; 5])?.try_into()
    }

    fn query(
        &mut self,
        command: command::Command,
        payload: [u8; 5],
    ) -> Result<protocol::ResponseFrame> {
        let request = protocol::RequestFrame::new(command, payload);
        self.write_all(request.bytes())?;
        self.read()
    }

    fn write_all(&mut self, bytes: &[u8]) -> Result<()> {
        let mut offset = 0;

        while offset < bytes.len() {
            let written = self.uart.write(&bytes[offset..])?;
            if written == 0 {
                return Err(Error::WriteZero);
            }

            offset += written;
        }

        Ok(())
    }

    fn read(&mut self) -> Result<protocol::ResponseFrame> {
        let mut bytes = [0; FRAME_LEN];
        let mut offset = 0;
        let timeout = TickType::from(DEFAULT_READ_TIMEOUT).ticks();

        while offset < FRAME_LEN {
            let read = self.uart.read(&mut bytes[offset..], timeout)?;
            if read == 0 {
                return Err(Error::Timeout);
            }

            offset += read;
        }

        protocol::ResponseFrame::parse(bytes)
    }
}
