use esp_idf_svc::hal::gpio::AnyIOPin;
use esp_idf_svc::hal::i2c::{I2cConfig, I2cDriver};
use esp_idf_svc::hal::peripherals::Peripherals;
use esp_idf_svc::hal::uart::{config, UartDriver};
use esp_idf_svc::hal::units::Hertz;
use esp_idf_svc::sys::EspError;

pub use alcohol::{AlcoholDevice, Concentration as AlcoholConcentration};
pub use pulse::{Analysis as PulseAnalysis, PulseDevice};
pub use trigger::TriggerDevice;

mod alcohol;
mod pulse;
mod trigger;

const ALCOHOL_UART_BAUD_RATE: Hertz = Hertz(9_600);
const PULSE_I2C_BAUD_RATE: Hertz = Hertz(400_000);

/// Drunksafe 보드에서 firmware runtime이 소유할 디바이스 묶음이다.
pub struct Devices {
    /// ZE29 알코올 센서 디바이스다.
    #[allow(dead_code)]
    pub alcohol: AlcoholDevice<'static>,
    /// MAX30102 pulse 센서 디바이스다.
    pub pulse: PulseDevice<'static>,
    /// 테스트용 측정 시작 버튼 디바이스다.
    pub trigger: TriggerDevice,
}

/// 보드 주변장치를 한 번 획득하고 디바이스별 HAL driver를 초기화한다.
///
/// 현재 배선은 ZE29가 UART2 TX GPIO17/RX GPIO16, MAX30102가 I2C0
/// SDA GPIO21/SCL GPIO22, trigger가 GPIO0이다.
pub fn init() -> Result<Devices, EspError> {
    let peripherals = Peripherals::take()?;

    Ok(Devices {
        alcohol: AlcoholDevice::new(UartDriver::new(
            peripherals.uart2,
            peripherals.pins.gpio17,
            peripherals.pins.gpio16,
            Option::<AnyIOPin>::None,
            Option::<AnyIOPin>::None,
            &config::Config::new().baudrate(ALCOHOL_UART_BAUD_RATE),
        )?),
        pulse: PulseDevice::new(I2cDriver::new(
            peripherals.i2c0,
            peripherals.pins.gpio21,
            peripherals.pins.gpio22,
            &I2cConfig::new().baudrate(PULSE_I2C_BAUD_RATE),
        )?),
        trigger: TriggerDevice::new(peripherals.pins.gpio0)?,
    })
}
