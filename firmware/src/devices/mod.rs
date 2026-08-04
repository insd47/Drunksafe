use crate::error::Result;
pub use alcohol::{AlcoholDevice, Error as AlcoholError, Status as AlcoholStatus};
pub use display::{DisplayDevice, Frame as DisplayFrame};
use esp_idf_svc::hal::modem::Modem;
use esp_idf_svc::hal::peripherals::Peripherals;
pub use pulse::{Analysis as PulseAnalysis, Error as PulseError, PulseDevice};
pub use trigger::TriggerDevice;

mod alcohol;
mod display;
mod pulse;
mod trigger;

pub fn init() -> Result<Devices> {
    let peripherals = Peripherals::take()?;
    let pins = peripherals.pins;

    Ok(Devices {
        alcohol: AlcoholDevice::new(peripherals.uart2, pins.gpio17, pins.gpio16)?,
        display: DisplayDevice::new(peripherals.i2c0, pins.gpio21, pins.gpio22)?,
        modem: peripherals.modem,
        pulse: PulseDevice::new(peripherals.adc1, pins.gpio36)?,
        trigger: TriggerDevice::new(pins.gpio0)?,
    })
}

pub struct Devices {
    pub alcohol: AlcoholDevice<'static>,
    pub display: DisplayDevice<'static>,
    pub modem: Modem<'static>,
    pub pulse: PulseDevice<'static>,
    pub trigger: TriggerDevice,
}
