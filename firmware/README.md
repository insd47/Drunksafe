# Drunksafe Firmware

Rust firmware boilerplate for an ESP32 DevKitC V4 using the esp-rs ESP-IDF stack.

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
