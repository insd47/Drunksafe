use super::text::Text;
use crate::devices::display::font;
use crate::devices::display::frame::{Frame, WIDTH};
use core::fmt;

pub(crate) struct Canvas<'a> {
    pub(super) frame: &'a mut Frame,
}

impl Canvas<'_> {
    pub(crate) fn centered(&mut self, y: usize, text: fmt::Arguments<'_>) {
        let text = Text::from_args(text);
        self.draw_centered(y, text.as_str());
    }

    fn draw_centered(&mut self, y: usize, text: &str) {
        let width = text_width(text);
        let x = WIDTH.saturating_sub(width) / 2;
        self.draw_text(x, y, text);
    }

    fn draw_text(&mut self, mut x: usize, y: usize, text: &str) {
        for byte in text.bytes() {
            self.draw_char(x, y, byte.to_ascii_uppercase());
            x += 6;
        }
    }

    fn draw_char(&mut self, x: usize, y: usize, byte: u8) {
        let glyph = font::glyph(byte);

        for (col, bits) in glyph.iter().enumerate() {
            for row in 0..7 {
                if bits & (1 << row) != 0 {
                    self.frame.set_pixel(x + col, y + row);
                }
            }
        }
    }
}

fn text_width(text: &str) -> usize {
    text.len().saturating_mul(6).saturating_sub(1)
}
