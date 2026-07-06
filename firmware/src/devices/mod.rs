use crate::error::Result;
pub use alcohol::AlcoholDevice;
pub use display::DisplayDevice;
use esp_idf_svc::hal::peripherals::Peripherals;
pub use pulse::PulseDevice;
pub use trigger::ButtonDevice;

pub mod alcohol;
pub mod display;
pub mod pulse;
pub mod trigger;

pub fn init() -> Result<Devices> {
    let peripherals = Peripherals::take()?;
    let pins = peripherals.pins;

    Ok(Devices {
        alcohol: AlcoholDevice::new(peripherals.uart2, pins.gpio17, pins.gpio16)?,
        display: DisplayDevice::new(peripherals.i2c0, pins.gpio21, pins.gpio22)?,
        pulse: PulseDevice::new(peripherals.adc1, pins.gpio36)?,
        trigger: ButtonDevice::new(pins.gpio0)?,
        result_page: ButtonDevice::new(pins.gpio18)?,
    })
}

pub struct Devices {
    #[allow(dead_code)]
    pub alcohol: AlcoholDevice<'static>,
    pub display: DisplayDevice<'static>,
    pub pulse: PulseDevice<'static>,
    pub trigger: ButtonDevice,
    pub result_page: ButtonDevice,
}
