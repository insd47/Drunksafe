use super::error::Result;
use std::time::Duration;

pub trait Transport {
    fn write(&mut self, bytes: &[u8]) -> Result<()>;
    fn read(&mut self, bytes: &mut [u8], timeout: Duration) -> Result<usize>;
}
