use super::error::Result;
use super::protocol::FRAME_LEN;
use crate::devices::alcohol::Error;

pub fn generate(bytes: &[u8; FRAME_LEN]) -> u8 {
    bytes[1..8]
        .iter()
        .fold(0_u8, |sum, byte| sum.wrapping_add(*byte))
        .wrapping_neg()
}

pub fn expect(bytes: &[u8; FRAME_LEN]) -> Result<()> {
    let expected = generate(bytes);
    let actual = bytes[8];

    if expected != actual {
        Err(Error::InvalidChecksum { expected, actual })
    } else {
        Ok(())
    }
}
