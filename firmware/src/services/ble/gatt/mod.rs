//! GATT 등록 순서와 단일 연결 정책을 보존하는 BLE server 경계다.
//! Event characteristic의 CCCD가 먼저 등록돼야 descriptor가 올바른 characteristic에 귀속되므로 command characteristic은 CCCD 등록 뒤에 추가하고 service는 command 등록 뒤에 시작한다.
//! Legacy advertising의 31-byte 한도에서 이름과 tx power를 유지하기 위해 128-bit service UUID는 advertising payload에 싣지 않는다.
//! 연결 중 advertising을 중단해 단일 연결만 허용하며, 따라서 연결 상태는 하나의 `Option`으로 유지한다.

pub use server::GattServer;
mod attributes;
mod connection;
mod gap;
mod server;
mod status;
