use super::TEXT_BYTES;
use core::fmt;
use std::fmt::Write;

pub(super) struct Text {
    bytes: [u8; TEXT_BYTES],
    len: usize,
}

impl Text {
    const fn empty() -> Self {
        Self {
            bytes: [0; TEXT_BYTES],
            len: 0,
        }
    }

    pub(super) fn from_args(args: fmt::Arguments<'_>) -> Self {
        let mut text = Self::empty();
        let _ = text.write_fmt(args);
        text
    }

    pub(super) fn as_str(&self) -> &str {
        core::str::from_utf8(&self.bytes[..self.len]).unwrap_or("")
    }
}

impl Write for Text {
    fn write_str(&mut self, value: &str) -> fmt::Result {
        for character in value.chars() {
            let mut buffer = [0; 4];
            let encoded = character.encode_utf8(&mut buffer).as_bytes();
            if self.len + encoded.len() > TEXT_BYTES {
                break;
            }

            self.bytes[self.len..self.len + encoded.len()].copy_from_slice(encoded);
            self.len += encoded.len();
        }

        Ok(())
    }
}
