#include <Arduino.h>
#include "config.h"
#include "buttons.h"
#include "device.h"

// 모든 버튼은 내부 풀업을 사용합니다.
// 버튼 한쪽은 GPIO, 반대쪽은 GND에 연결되어야 합니다.
void initButtons() {
  pinMode(BTN_START_RESET, INPUT_PULLUP);
  pinMode(BTN_NEXT, INPUT_PULLUP);
  pinMode(BTN_BREATH, INPUT_PULLUP);
}

// 버튼 입력을 이벤트처럼 다루기 위한 함수입니다.
// 짧은 디바운스 시간을 거친 뒤 버튼에서 손을 뗄 때까지 기다려 중복 입력을 줄입니다.
//
// 기다리는 동안에도 runBackgroundTasks()를 호출하므로
// BLE, 심박 센서, 알코올 센서, 알림 패턴 처리가 완전히 멈추지 않습니다.
bool isButtonPressed(int pin) {
  if (digitalRead(pin) != LOW) {
    return false;
  }

  // 버튼 접점 튐을 줄이기 위해 짧게 안정화 시간을 둡니다.
  unsigned long start = millis();
  while (millis() - start < DEBOUNCE_DELAY_MS) {
      runBackgroundTasks();
      delay(1);
  }

  // 디바운스 후에도 LOW일 때만 실제 눌림으로 인정합니다.
  if (digitalRead(pin) != LOW) {
    return false;
  }

  // 버튼에서 손을 뗄 때까지 기다립니다.
  // 길게 누르고 있어도 같은 버튼 이벤트가 반복 발생하지 않도록 하기 위한 처리입니다.
  while (digitalRead(pin) == LOW) {
    runBackgroundTasks();
    delay(BUTTON_RELEASE_CHECK_MS);
  }

  return true;
}
