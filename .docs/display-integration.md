# Display Integration

This records the Rust firmware integration of the Arduino `origin/Screen` display work.

## Source Branch

`origin/Screen` contains the display prototype under `HWsketch/HWMAIN`.

The Arduino display code uses:

- OLED: SH1106 128x64 I2C
- Library: U8g2
- SDA: GPIO21
- SCL: GPIO22
- I2C address in U8g2 notation: `0x3C * 2`
- I2C address in esp-rs 7-bit notation: `0x3c`

## Rust Mapping

The Rust firmware maps this into:

- `firmware/src/devices/display`: SH1106 I2C driver and pixel rendering
- `firmware/src/features/screen`: screen policy and result-page state
- `firmware/src/devices/mod.rs`: hardware pin ownership

The current supported pages are:

- Home
- Measuring
- Done summary
- Alcohol value
- Pulse value
- Error

Korean U8g2 font rendering is not ported yet. The first Rust integration uses an ASCII 5x7 font so it can build without adding a display/font dependency.

## Pin Mapping

Current Rust firmware pins:

| Purpose | Rust pin | Notes |
| --- | --- | --- |
| Alcohol UART TX | GPIO17 | Conflicts with Arduino `BTN_NEXT` |
| Alcohol UART RX | GPIO16 | Conflicts with Arduino `BTN_START_RESET` |
| OLED SDA | GPIO21 | Same as Screen branch |
| OLED SCL | GPIO22 | Same as Screen branch |
| Pulse ADC | GPIO36 | Same PPG input family |
| Measurement trigger | GPIO0 | Uses the ESP32 BOOT button for now |
| Result page cycle | GPIO18 | Repurposed from Arduino `BTN_BREATH` because GPIO16/17 are occupied |

Arduino `HWsketch/HWMAIN/config.h` used:

- `BTN_START_RESET = 16`
- `BTN_NEXT = 17`
- `BTN_BREATH = 18`

GPIO16 and GPIO17 cannot be copied directly because the Rust firmware already uses them for the alcohol UART. GPIO18 is therefore wired as a temporary result-page cycle button in Rust:

`Done -> Alcohol -> Pulse -> Done`

## Hardware Checks

On the physical OLED, verify:

- Display responds at `0x3c`
- SH1106 initialization sequence wakes the panel
- `COLUMN_OFFSET = 2` correctly aligns the image
- GPIO18 button is wired as active-low with pull-up

If the display is blank, check address and initialization first. If content is shifted horizontally, tune `COLUMN_OFFSET`.
