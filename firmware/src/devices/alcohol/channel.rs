use super::command::Command;
use super::protocol::{ResponseFrame, FRAME_LEN};
use super::{protocol, Error};
use embassy_time::{with_timeout, Duration};
use esp_idf_svc::hal::uart::{AsyncUartDriver, UartDriver};

const READ_TIMEOUT: Duration = Duration::from_millis(100);

pub struct Channel<'d> {
    uart: AsyncUartDriver<'d, UartDriver<'d>>,
}

impl<'d> Channel<'d> {
    pub const fn new(uart: AsyncUartDriver<'d, UartDriver<'d>>) -> Self {
        Self { uart }
    }

    pub async fn request(
        &mut self,
        command: Command,
        payload: [u8; 5],
    ) -> crate::devices::alcohol::Result<ResponseFrame> {
        let frame = protocol::RequestFrame::new(command, payload);
        self.write(frame.bytes()).await?;
        self.read(command).await
    }

    async fn write(&mut self, bytes: &[u8]) -> crate::devices::alcohol::Result<()> {
        let mut offset = 0;

        while offset < bytes.len() {
            let written = self.uart.write(&bytes[offset..]).await?;
            if written == 0 {
                return Err(Error::WriteZero);
            }

            offset += written;
        }

        Ok(())
    }

    async fn read(&mut self, command: Command) -> crate::devices::alcohol::Result<ResponseFrame> {
        let mut bytes = [0; FRAME_LEN];

        with_timeout(READ_TIMEOUT, async {
            let mut offset = 0;

            while offset < FRAME_LEN {
                let read = self.uart.read(&mut bytes[offset..]).await?;
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
