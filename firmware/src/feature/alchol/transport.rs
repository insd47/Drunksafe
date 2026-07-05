use super::error::Result;

pub trait Transport {
    fn write(&mut self, bytes: &[u8]) -> Result<()>;
    fn read(&mut self, bytes: &mut [u8]) -> Result<usize>;
}
