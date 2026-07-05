use esp_idf_svc::hal::gpio::{AnyIOPin, Gpio0};
use esp_idf_svc::hal::i2c::{I2cConfig, I2cDriver};
use esp_idf_svc::hal::peripherals::Peripherals;
use esp_idf_svc::hal::uart::{config, UartDriver};
use esp_idf_svc::hal::units::Hertz;
use esp_idf_svc::sys::EspError;

const ALCOHOL_UART_BAUD_RATE: Hertz = Hertz(9_600);
const PULSE_I2C_BAUD_RATE: Hertz = Hertz(400_000);

pub struct Board {
    pub trigger: Gpio0<'static>,
    pub alcohol: UartDriver<'static>,
    pub pulse: I2cDriver<'static>,
}

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
