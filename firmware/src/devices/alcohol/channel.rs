use super::protocol::{Command, ResponseFrame, FRAME_LEN};
use super::Result;
use super::{protocol, Error};
use embassy_time::{with_timeout, Duration};
use esp_idf_svc::hal::gpio::{AnyIOPin, InputPin, OutputPin};
use esp_idf_svc::hal::uart::{config, AsyncUartDriver, Uart, UartDriver};
use esp_idf_svc::hal::units::Hertz;

// ZE29A가 이따금 응답이 느려도 한 번의 read timeout으로 측정 전체가 실패하지 않도록
// 레퍼런스 스케치(status 500ms)에 가깝게 여유를 준다.
const READ_TIMEOUT: Duration = Duration::from_millis(300);
const CLEAR_TIMEOUT: Duration = Duration::from_millis(120);
const MAX_CLEAR_BYTES: usize = FRAME_LEN * 4;

pub struct Channel<'d> {
    driver: AsyncUartDriver<'d, UartDriver<'d>>,
}

impl<'d> Channel<'d> {
    pub fn new<UART: Uart + 'd>(
        uart: UART,
        tx: impl OutputPin + 'd,
        rx: impl InputPin + 'd,
    ) -> Result<Self> {
        let driver = AsyncUartDriver::new(
            uart,
            tx,
            rx,
            Option::<AnyIOPin>::None,
            Option::<AnyIOPin>::None,
            &config::Config::new().baudrate(Hertz(9_600)),
        )?;

        Ok(Self { driver })
    }

    pub async fn request(&mut self, command: Command, payload: [u8; 5]) -> Result<ResponseFrame> {
        let frame = protocol::RequestFrame::new(command, payload);
        self.write(frame.bytes()).await?;
        self.read(command).await
    }

    pub async fn clear(&mut self) -> Result<()> {
        let mut bytes = [0; FRAME_LEN];
        let mut cleared = 0;

        while cleared < MAX_CLEAR_BYTES {
            match with_timeout(CLEAR_TIMEOUT, self.driver.read(&mut bytes)).await {
                Ok(Ok(0)) | Err(_) => return Ok(()),
                Ok(Ok(read)) => {
                    cleared += read;
                    log::trace!("[ALCOHOL] discarded stale bytes: {:?}", &bytes[..read]);
                }
                Ok(Err(error)) => return Err(error.into()),
            }
        }

        log::warn!("[ALCOHOL] stopped clearing UART after {cleared} bytes");
        Ok(())
    }

    async fn write(&mut self, bytes: &[u8]) -> Result<()> {
        let mut offset = 0;

        while offset < bytes.len() {
            let written = self.driver.write(&bytes[offset..]).await?;
            if written == 0 {
                return Err(Error::WriteZero);
            }

            offset += written;
        }

        log::trace!("[ALCOHOL] sent request: bytes={bytes:?}");
        Ok(())
    }

    async fn read(&mut self, command: Command) -> Result<ResponseFrame> {
        let mut bytes = [0; FRAME_LEN];

        with_timeout(READ_TIMEOUT, async {
            let mut offset = 0;

            while offset < FRAME_LEN {
                let read = self.driver.read(&mut bytes[offset..]).await?;
                if read == 0 {
                    return Err(Error::Timeout);
                }

                offset += read;
            }

            Ok(())
        })
        .await
        .map_err(|_| Error::Timeout)??;

        log::trace!("[ALCOHOL] received response: command={command:?}, bytes={bytes:?}");
        ResponseFrame::parse(command, bytes)
    }
}
