#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>

// =====================================================
// HWMAIN 공통 설정값
// -----------------------------------------------------
// 핀 번호와 시간 상수는 여러 모듈에서 함께 사용하므로 이 파일에서 관리합니다.
// 실제 배선을 바꾸면 PIN_WIRING.txt도 함께 갱신해야 합니다.
// =====================================================

// OLED: SH1106 128x64 I2C 모듈입니다.
// U8g2 라이브러리는 8-bit I2C 주소를 사용하므로 7-bit 주소 0x3C에 2를 곱합니다.
const int OLED_SDA_PIN = 21;
const int OLED_SCL_PIN = 22;
const int OLED_WIDTH = 128;
const int OLED_I2C_ADDRESS = 0x3C * 2;

// 버튼은 INPUT_PULLUP 방식입니다.
// 평상시 HIGH, 버튼을 눌러 GND와 연결되면 LOW로 읽힙니다.
// GPIO16/GPIO17은 ZE-29A UART2 통신용으로 예약되어 있어 버튼은 32/33으로 이동했습니다.
const int BTN_START_RESET = 32;
const int BTN_NEXT = 33;
const int BTN_BREATH = 18;

// 알림 출력 장치입니다.
// 부저와 진동 모터는 5V 모듈을 전제로 하며, 제어선만 ESP32 GPIO에 연결합니다.
const int SPEAKER_PIN = 25;
const int VIBRATION_PIN = 26;

// 버튼 디바운스와 화면/전송 갱신 주기입니다.
// 심박/알코올 센서의 내부 주기는 sensors.cpp에서 별도로 관리합니다.
const unsigned long DEBOUNCE_DELAY_MS = 30;
const unsigned long BUTTON_RELEASE_CHECK_MS = 5;
const unsigned long BPM_SEND_INTERVAL_MS = 500;
const unsigned long ALCOHOL_SCREEN_REFRESH_MS = 200;
const unsigned long RESET_MESSAGE_DURATION_MS = 3000;

#endif
