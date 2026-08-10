use esp_idf_svc::hal::delay::BLOCK;
use esp_idf_svc::hal::gpio::{InputPin, OutputPin};
use esp_idf_svc::hal::i2c::{I2c, I2cConfig, I2cDriver};
use esp_idf_svc::hal::units::Hertz;
use esp_idf_svc::sys::EspError;
pub use frame::Frame;
use frame::{PAGES, WIDTH};

mod command;
mod frame;

pub struct DisplayDevice<'d> {
    i2c: I2cDriver<'d>,
    frame: Frame,
}

impl<'d> DisplayDevice<'d> {
    pub fn new<I2C: I2c + 'd>(
        i2c: I2C,
        sda: impl InputPin + OutputPin + 'd,
        scl: impl InputPin + OutputPin + 'd,
    ) -> Result<Self, EspError> {
        let config = I2cConfig::new().baudrate(Hertz(100_000));
        let mut display = Self {
            i2c: I2cDriver::new(i2c, sda, scl, &config)?,
            frame: Frame::new(),
        };

        display.init()?;
        display.clear()?;
        Ok(display)
    }

    pub fn clear(&mut self) -> Result<(), EspError> {
        self.frame.reset();
        self.flush()
    }

    pub fn draw(&mut self, content: impl FnOnce(&mut Frame)) -> Result<(), EspError> {
        self.frame.reset();
        content(&mut self.frame);
        self.flush()
    }

    fn init(&mut self) -> Result<(), EspError> {
        for command in command::INIT {
            self.command(*command)?;
        }

        Ok(())
    }

    fn command(&mut self, command: u8) -> Result<(), EspError> {
        self.i2c.write(
            command::ADDRESS,
            &[command::COMMAND_CONTROL, command],
            BLOCK,
        )
    }

    fn flush(&mut self) -> Result<(), EspError> {
        for page in 0..PAGES {
            let column = command::COLUMN_OFFSET;
            let page_command = u8::try_from(page).expect("display page fits u8");
            self.command(0xb0 | page_command)?;
            self.command(column & 0x0f)?;
            self.command(0x10 | (column >> 4))?;

            for start in (0..WIDTH).step_by(command::DATA_CHUNK) {
                let end = (start + command::DATA_CHUNK).min(WIDTH);
                let mut packet = [0_u8; command::DATA_CHUNK + 1];
                packet[0] = command::DATA_CONTROL;
                packet[1..=end - start].copy_from_slice(self.frame.page(page, start, end));
                self.i2c
                    .write(command::ADDRESS, &packet[..=end - start], BLOCK)?;
            }
        }

        Ok(())
    }
}
