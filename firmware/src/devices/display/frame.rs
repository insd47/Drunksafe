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

    pub fn clear(&mut self) {
        self.bytes.fill(0);
    }

    pub fn page_slice(&self, page: usize, start: usize, end: usize) -> &[u8] {
        &self.bytes[page * WIDTH + start..page * WIDTH + end]
    }

    pub fn set_pixel(&mut self, x: usize, y: usize) {
        if x >= WIDTH || y >= HEIGHT {
            return;
        }

        self.bytes[(y / 8) * WIDTH + x] |= 1 << (y % 8);
    }
}
