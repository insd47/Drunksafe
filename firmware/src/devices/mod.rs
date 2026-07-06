use crate::error::Result;
pub use alcohol::AlcoholDevice;
pub use display::DisplayDevice;
use esp_idf_svc::hal::modem::Modem;
use esp_idf_svc::hal::peripherals::Peripherals;
pub use pulse::PulseDevice;
pub use trigger::TriggerDevice;

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
        modem: peripherals.modem,
        pulse: PulseDevice::new(peripherals.adc1, pins.gpio36)?,
        trigger: TriggerDevice::new(pins.gpio0)?,
    })
}

pub struct Devices {
    #[allow(dead_code)]
    pub alcohol: AlcoholDevice<'static>,
    pub display: DisplayDevice<'static>,
    pub modem: Modem<'static>,
    pub pulse: PulseDevice<'static>,
    pub trigger: TriggerDevice,
}
