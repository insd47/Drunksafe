pub use alcohol::{AlcoholDevice, Error as AlcoholError, Status as AlcoholStatus};
use esp_idf_svc::hal::gpio::AnyIOPin;
use esp_idf_svc::hal::i2c::{I2cConfig, I2cDriver};
use esp_idf_svc::hal::peripherals::Peripherals;
use esp_idf_svc::hal::uart::{config, AsyncUartDriver};
use esp_idf_svc::hal::units::Hertz;
use esp_idf_svc::sys::EspError;
pub use pulse::{Analysis as PulseAnalysis, Error as PulseError, PulseDevice};
pub use trigger::TriggerDevice;

mod alcohol;
mod pulse;
mod trigger;

const ALCOHOL_UART_BAUD_RATE: Hertz = Hertz(9_600);
const PULSE_I2C_BAUD_RATE: Hertz = Hertz(400_000);

pub struct Devices {
    #[allow(dead_code)]
    pub alcohol: AlcoholDevice<'static>,
    pub pulse: PulseDevice<'static>,
    pub trigger: TriggerDevice,
}

pub fn init() -> Result<Devices, EspError> {
    let peripherals = Peripherals::take()?;

    Ok(Devices {
        alcohol: AlcoholDevice::new(AsyncUartDriver::new(
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
