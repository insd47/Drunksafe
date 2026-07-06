use super::command::Command;
use super::protocol::{ResponseFrame, FRAME_LEN};
use super::Result;
use super::{protocol, Error};
use embassy_time::{with_timeout, Duration};
use esp_idf_svc::hal::gpio::{AnyIOPin, InputPin, OutputPin};
use esp_idf_svc::hal::uart::{config, AsyncUartDriver, Uart, UartDriver};
use esp_idf_svc::hal::units::Hertz;

const READ_TIMEOUT: Duration = Duration::from_millis(100);

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

    async fn write(&mut self, bytes: &[u8]) -> Result<()> {
        let mut offset = 0;

        while offset < bytes.len() {
            let written = self.driver.write(&bytes[offset..]).await?;
            if written == 0 {
                return Err(Error::WriteZero);
            }

            offset += written;
        }

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

        ResponseFrame::parse(command, bytes)
    }
}
