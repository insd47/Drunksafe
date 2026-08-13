use channel::Channel;
pub use error::{Error, Result};
use esp_idf_svc::hal::gpio::{InputPin, OutputPin};
use esp_idf_svc::hal::uart::Uart;
use protocol::Command;
pub use status::Status;

mod channel;
mod checksum;
mod error;
mod protocol;
mod status;

/// 입김 유지 시간(초). 기본 4초를 대폭 줄여 짧게 불어도 인정되게 한다. 범위 1~10 (0x89).
const BLOW_TIME_SECONDS: u8 = 2;
/// 입김 압력 감지 임계값. 기본 8을 최소값(5)으로 낮춰 약한 입김도 감지되게 한다. 범위 5~200 (0x93).
const BLOW_PRESSURE_THRESHOLD: u8 = 5;

pub struct AlcoholDevice<'d> {
    channel: Channel<'d>,
}

impl<'d> AlcoholDevice<'d> {
    pub fn new<UART: Uart + 'd>(
        uart: UART,
        tx: impl OutputPin + 'd,
        rx: impl InputPin + 'd,
    ) -> Result<Self> {
        let channel = Channel::new(uart, tx, rx)?;
        Ok(Self { channel })
    }

    pub async fn test(&mut self) -> Result<u16> {
        let response = self.channel.request(Command::Result, [0; 5]).await?;
        let payload = response.payload();

        Ok(u16::from_be_bytes([payload[0], payload[1]]))
    }

    pub async fn status(&mut self) -> Result<Status> {
        let res = self.channel.request(Command::Status, [0; 5]).await?;
        Ok(Status::from(res.payload()[0]))
    }

    pub async fn start(&mut self) -> Result<()> {
        self.channel.clear().await?;
        self.configure().await;
        self.work(true).await
    }

    /// ZE29A의 입김 유지 시간(0x89)과 압력 임계값(0x93)을 낮춰 측정 성공률을 높인다.
    /// 설정이 실패해도 측정 자체는 계속하도록 best-effort로 처리한다.
    async fn configure(&mut self) {
        if let Err(error) = self.set_blow_time(BLOW_TIME_SECONDS).await {
            log::warn!("[ALCOHOL] set blow time failed: {error}");
        }
        if let Err(error) = self.set_blow_pressure(BLOW_PRESSURE_THRESHOLD).await {
            log::warn!("[ALCOHOL] set blow pressure failed: {error}");
        }
    }

    async fn set_blow_time(&mut self, seconds: u8) -> Result<()> {
        let response = self
            .channel
            .request(Command::SetBlowTime, [seconds, 0, 0, 0, 0])
            .await?;
        log_setting("blow time(s)", seconds, response.payload()[0]);
        Ok(())
    }

    async fn set_blow_pressure(&mut self, threshold: u8) -> Result<()> {
        let response = self
            .channel
            .request(Command::SetBlowPressure, [threshold, 0, 0, 0, 0])
            .await?;
        log_setting("blow pressure", threshold, response.payload()[0]);
        Ok(())
    }

    pub async fn stop(&mut self) -> Result<()> {
        self.channel.clear().await?;

        let Err(first) = self.work(false).await else {
            return Ok(());
        };

        self.channel.clear().await?;
        self.work(false).await.map_err(|_| first)
    }

    async fn work(&mut self, enabled: bool) -> Result<()> {
        // ZE29A 센서 프로토콜: Work 명령(0x87)의 data1은
        // 시작 시 0x32 (Preheating 상태코드), 정지 시 0x31 (Idle 상태코드)
        // 참고: sketch_jul31a.ino의 startPreheating()에서 sendCommand(0x87, 0x32) 사용
        let value: u8 = if enabled { 0x32 } else { 0x31 };
        self.channel
            .request(Command::Work, [value, 0, 0, 0, 0])
            .await?;

        Ok(())
    }
}

fn log_setting(name: &str, value: u8, result: u8) {
    if result == 0x01 {
        log::info!("[ALCOHOL] {name} set to {value}");
    } else {
        log::warn!("[ALCOHOL] {name} set to {value} rejected (result={result:#04x})");
    }
}
