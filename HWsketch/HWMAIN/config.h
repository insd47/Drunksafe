#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>

// OLED: SH1106 128x64 I2C
const int OLED_SDA_PIN = 21;
const int OLED_SCL_PIN = 22;
const int OLED_WIDTH = 128;
const int OLED_I2C_ADDRESS = 0x3C * 2;

// Buttons use INPUT_PULLUP. Pressed state is LOW.
// GPIO16/GPIO17 are reserved for ZE-29A RX2/TX2, so buttons moved to 32/33.
const int BTN_START_RESET = 32;
const int BTN_NEXT = 33;
const int BTN_BREATH = 18;

const int SPEAKER_PIN = 25;
const int VIBRATION_PIN = 26;

const unsigned long DEBOUNCE_DELAY_MS = 30;
const unsigned long BUTTON_RELEASE_CHECK_MS = 5;
const unsigned long BPM_SEND_INTERVAL_MS = 500;
const unsigned long ALCOHOL_MEASURE_DURATION_MS = 3000;
const unsigned long ALCOHOL_SCREEN_REFRESH_MS = 200;
const unsigned long RESET_MESSAGE_DURATION_MS = 3000;

#endif
