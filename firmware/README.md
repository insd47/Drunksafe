# Drunksafe Firmware

Rust firmware for an ESP32 DevKitC V4 using the esp-rs ESP-IDF stack.

The current hardware scope is:

- ZE29 C2H5OH alcohol module over UART.
- Analog PPG heart-rate sensor over ADC.
- SH1106 128x64 OLED display over I2C.
- Pull-up buttons for measurement trigger and result page cycling.

The measurement flow, BLE protocol model, and storage ERD are documented in [../.docs/measurement-communication-model.md](../.docs/measurement-communication-model.md).
Firmware 공개 표면은 [../.docs/firmware-public-surface.md](../.docs/firmware-public-surface.md)에 한국어로 정리되어 있다.
Screen 브랜치의 OLED 통합 내역과 핀 충돌은 [../.docs/display-integration.md](../.docs/display-integration.md)에 정리되어 있다.

Firmware modules keep their public surface narrow. `main.rs` initializes logging, devices, and the runtime loop directly. Board pin mapping and hardware handles live under `devices/`; measurement/screen/BLE policy lives under `features/`.

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
