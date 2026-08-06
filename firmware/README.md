# Drunksafe Firmware

Rust firmware for an ESP32 DevKitC V4 using the esp-rs ESP-IDF stack.

The current hardware scope is:

- ZE29 C2H5OH alcohol module over UART.
- Analog PPG heart-rate sensor over ADC.
- SH1106 128x64 OLED display over I2C.
- Pull-up button for measurement trigger.

The measurement flow, BLE protocol model, and storage ERD are documented in [../.docs/measurement-communication-model.md](../.docs/measurement-communication-model.md).
Firmware 공개 표면은 [../.docs/firmware-public-surface.md](../.docs/firmware-public-surface.md)에 한국어로 정리되어 있다.
Screen 브랜치의 OLED 통합 내역과 핀 충돌은 [../.docs/display-integration.md](../.docs/display-integration.md)에 정리되어 있다.
MVP 실기기 검증 체크리스트는 [../.docs/mvp-verification.md](../.docs/mvp-verification.md)에 정리되어 있다.

Firmware modules keep their public surface narrow. `main.rs` initializes logging, devices, and the runtime loop directly. Board pin mapping and hardware handles live under `devices/`; measurement/screen/BLE policy lives under `features/`.

## Prerequisites

Install the ESP Rust toolchain, linker proxy, and flashing utility:

```sh
cargo +stable install espup ldproxy espflash --locked
espup install
. ~/export-esp.sh
```
**espup install 과정에서 windows의 경우 user variables와 system variables가 합쳐져 환경변수에 등록된 프로그램이 호출되지 않는 문제가 있다.**

다음 코드로 환경 변수를 백업해둔다.
```powershell
Get-Item -Path "HKCU:\Environment" | Select-Object -ExpandProperty Property | ForEach-Object {
    "$($_) = $((Get-ItemProperty -Path 'HKCU:\Environment').$_)"
} | Out-File "$env:USERPROFILE\User_Env.txt" -Encoding utf8
```
```powershell
Get-Item -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" | Select-Object -ExpandProperty Property | ForEach-Object {
    "$($_) = $((Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment').$_)"
} | Out-File "$env:USERPROFILE\System_Env.txt" -Encoding utf8
```

## Build

```sh
cargo build --target-dir "C:\dev"
```

firmware 폴더에서 build를 수행해 `C:\dev`에 결과를 남긴다.

The project is configured for the classic ESP32 chip with the `xtensa-esp32-espidf` target.

## Flash And Monitor

Connect the board over USB, then run:

```sh
#cargo run --release, windows 경로 길이 제한 발생
espflash flash "C:\dev\xtensa-esp32-espidf\debug\firmware" --monitor
```

`cargo run` uses `espflash flash --monitor` from `.cargo/config.toml`.
