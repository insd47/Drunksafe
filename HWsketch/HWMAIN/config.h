#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>

// =====================================================
// OLED 설정
// SH1106 128x64 I2C OLED
// 제품 설명의 0x78은 8-bit 주소이고, U8g2에는 8-bit 주소를 넣는다.
// 7-bit 주소 0x3C를 U8g2 형식으로 변환하면 0x3C * 2가 된다.
// =====================================================
const int OLED_SDA_PIN = 21;
const int OLED_SCL_PIN = 22;
const int OLED_WIDTH = 128;
const int OLED_I2C_ADDRESS = 0x3C * 2;

// =====================================================
// 버튼 핀 설정
// INPUT_PULLUP 방식이므로 버튼을 누르면 LOW가 된다.
// =====================================================
const int BTN_START_RESET = 16;  // 시작 / 초기화
const int BTN_NEXT = 17;         // 측정값 화면 넘기기
const int BTN_BREATH = 18;       // 알코올 측정 시작

// =====================================================
// 시간 설정
// =====================================================
const unsigned long DEBOUNCE_DELAY_MS = 30;
const unsigned long BUTTON_RELEASE_CHECK_MS = 5;
const unsigned long BPM_SEND_INTERVAL_MS = 500;
const unsigned long ALCOHOL_MEASURE_DURATION_MS = 3000;
const unsigned long ALCOHOL_SCREEN_REFRESH_MS = 200;
const unsigned long RESET_MESSAGE_DURATION_MS = 3000;

#endif
