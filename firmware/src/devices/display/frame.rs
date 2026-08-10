use core::convert::Infallible;
use embedded_graphics::geometry::{OriginDimensions, Size};
use embedded_graphics::pixelcolor::BinaryColor;
use embedded_graphics::prelude::{DrawTarget, Pixel, Point};

pub const WIDTH: usize = 128;
pub const HEIGHT: usize = 64;
pub const PAGES: usize = HEIGHT / 8;

pub struct Frame {
    bytes: [u8; WIDTH * PAGES],
}

impl Frame {
    pub const fn new() -> Self {
        Self {
            bytes: [0; WIDTH * PAGES],
        }
    }

    pub fn reset(&mut self) {
        self.bytes.fill(0);
    }

    pub fn page(&self, page: usize, start: usize, end: usize) -> &[u8] {
        &self.bytes[page * WIDTH + start..page * WIDTH + end]
    }

    fn set(&mut self, point: Point, color: BinaryColor) {
        let Ok(x) = usize::try_from(point.x) else {
            return;
        };
        let Ok(y) = usize::try_from(point.y) else {
            return;
        };

        if x >= WIDTH || y >= HEIGHT {
            return;
        }

        let byte = &mut self.bytes[(y / 8) * WIDTH + x];
        let bit = 1 << (y % 8);

        match color {
            BinaryColor::On => *byte |= bit,
            BinaryColor::Off => *byte &= !bit,
        }
    }
}

impl DrawTarget for Frame {
    type Color = BinaryColor;
    type Error = Infallible;

    fn draw_iter<PIXELS>(&mut self, pixels: PIXELS) -> Result<(), Self::Error>
    where
        PIXELS: IntoIterator<Item = Pixel<Self::Color>>,
    {
        for Pixel(point, color) in pixels {
            self.set(point, color);
        }

        Ok(())
    }
}

impl OriginDimensions for Frame {
    fn size(&self) -> Size {
        Size::new(
            u32::try_from(WIDTH).expect("display width fits u32"),
            u32::try_from(HEIGHT).expect("display height fits u32"),
        )
    }
}
