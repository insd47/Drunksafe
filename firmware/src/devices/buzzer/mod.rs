use crate::error::Result;
use esp_idf_svc::hal::delay::FreeRtos;
use esp_idf_svc::hal::gpio::{Output, OutputPin, PinDriver};

/// active 부저(자체 발진)를 active-low로 구동하는 device handle이다.
/// LOW = 소리 남, HIGH = 무음. 세션 중 알코올 측정 알림 등에 쓴다.
pub struct BuzzerDevice {
    pin: PinDriver<'static, Output>,
}

impl BuzzerDevice {
    /// 부저 핀을 output으로 설정하고 무음(HIGH) 상태로 둔다.
    pub fn new(pin: impl OutputPin + 'static) -> Result<Self> {
        log::debug!("initializing buzzer device");
        let mut pin = PinDriver::output(pin)?;
        pin.set_high()?;
        Ok(Self { pin })
    }

    /// 소리를 켠다 (active-low라 LOW).
    pub fn on(&mut self) -> Result<()> {
        self.pin.set_low()?;
        Ok(())
    }

    /// 소리를 끈다.
    pub fn off(&mut self) -> Result<()> {
        self.pin.set_high()?;
        Ok(())
    }

    /// `ms`밀리초 동안 한 번 울린다.
    pub fn beep(&mut self, ms: u64) -> Result<()> {
        self.on()?;
        FreeRtos::delay_ms(ms.min(u64::from(u32::MAX)) as u32);
        self.off()?;
        Ok(())
    }

    /// `count`번 짧게 반복해서 울린다 (알림 패턴용). 세션 스케줄러에서 사용 예정.
    #[allow(dead_code)]
    pub fn beep_pattern(&mut self, count: u8, on_ms: u64, off_ms: u64) -> Result<()> {
        for index in 0..count {
            self.beep(on_ms)?;
            if index + 1 < count {
                FreeRtos::delay_ms(off_ms.min(u64::from(u32::MAX)) as u32);
            }
        }
        Ok(())
    }
}
