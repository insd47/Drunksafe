use esp_idf_svc::hal::peripherals::Peripherals;
pub use alcohol::AlcoholDevice;
pub use pulse::PulseDevice;
pub use trigger::TriggerDevice;
use crate::error::Result;

pub mod alcohol;
pub mod pulse;
pub mod trigger;

pub fn init() -> Result<Devices> {
    let peripherals = Peripherals::take()?;
    let pins = peripherals.pins;

    Ok(Devices {
        alcohol: AlcoholDevice::new(peripherals.uart2, pins.gpio17, pins.gpio16)?,
        pulse: PulseDevice::new(peripherals.adc1, pins.gpio36)?,
        trigger: TriggerDevice::new(pins.gpio0)?,
    })
}

pub struct Devices {
    #[allow(dead_code)]
    pub alcohol: AlcoholDevice<'static>,
    pub pulse: PulseDevice<'static>,
    pub trigger: TriggerDevice,
}
