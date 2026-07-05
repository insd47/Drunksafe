# Drunksafe Firmware

Rust firmware for an ESP32 DevKitC V4 using the esp-rs ESP-IDF stack.

The current hardware scope is:

- ZE29 C2H5OH alcohol module over UART.
- MAX30102 heart-rate / SpO2 sensor over I2C.

The measurement flow, BLE protocol model, and storage ERD are documented in [../.docs/measurement-communication-model.md](../.docs/measurement-communication-model.md).
Firmware 공개 표면은 [../.docs/firmware-public-surface.md](../.docs/firmware-public-surface.md)에 한국어로 정리되어 있다.

Feature modules keep their public surface narrow. `main.rs` initializes logging and then hands control to `feature::run()`. Runtime orchestration and board pin mapping live under `feature/`, while sensor code exposes focused handles such as `alcohol::Device` and `pulse::Device`.

## Prerequisites

Install the ESP Rust toolchain, linker proxy, and flashing utility:

```sh
cargo +stable install espup ldproxy espflash --locked
espup install
. ~/export-esp.sh
```

## Build

```sh
cargo build
```

The project is configured for the classic ESP32 chip with the `xtensa-esp32-espidf` target.

## Flash And Monitor

Connect the board over USB, then run:

```sh
cargo run --release
```

`cargo run` uses `espflash flash --monitor` from `.cargo/config.toml`.
