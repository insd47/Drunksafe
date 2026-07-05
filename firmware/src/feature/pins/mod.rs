use esp_idf_svc::hal::gpio::{AnyIOPin, Gpio0};
use esp_idf_svc::hal::i2c::{I2cConfig, I2cDriver};
use esp_idf_svc::hal::peripherals::Peripherals;
use esp_idf_svc::hal::uart::{config, UartDriver};
use esp_idf_svc::hal::units::Hertz;
use esp_idf_svc::sys::EspError;

const ALCOHOL_UART_BAUD_RATE: Hertz = Hertz(9_600);
const PULSE_I2C_BAUD_RATE: Hertz = Hertz(400_000);

/// Drunksafe 보드에서 feature runtime이 소유할 HAL driver 묶음이다.
///
/// 핀 번호와 bus 설정은 이 모듈에서만 결정하고, 각 feature에는 이미 구성된
/// driver만 전달한다.
pub struct Board {
    /// 측정 시작 버튼으로 사용하는 BOOT 핀이다.
    pub trigger: Gpio0<'static>,
    /// ZE29 알코올 센서와 통신하는 UART driver다.
    pub alcohol: UartDriver<'static>,
    /// MAX30102 pulse 센서와 통신하는 I2C driver다.
    pub pulse: I2cDriver<'static>,
}

/// 보드 주변장치를 한 번 획득하고 feature별 HAL driver로 나눈다.
///
/// 현재 배선은 ZE29가 UART2 TX GPIO17/RX GPIO16, MAX30102가 I2C0
/// SDA GPIO21/SCL GPIO22, trigger가 GPIO0이다.
pub fn take() -> Result<Board, EspError> {
    let peripherals = Peripherals::take()?;
    let pins = peripherals.pins;
    let alcohol_config = config::Config::new().baudrate(ALCOHOL_UART_BAUD_RATE);
    let pulse_config = I2cConfig::new().baudrate(PULSE_I2C_BAUD_RATE);

    Ok(Board {
        trigger: pins.gpio0,
        alcohol: UartDriver::new(
            peripherals.uart2,
            pins.gpio17,
            pins.gpio16,
            Option::<AnyIOPin>::None,
            Option::<AnyIOPin>::None,
            &alcohol_config,
        )?,
        pulse: I2cDriver::new(peripherals.i2c0, pins.gpio21, pins.gpio22, &pulse_config)?,
    })
}
