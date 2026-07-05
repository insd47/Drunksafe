#include <Arduino.h>
#include "config.h"
#include "buttons.h"

void initButtons() {
  pinMode(BTN_START_RESET, INPUT_PULLUP);
  pinMode(BTN_NEXT, INPUT_PULLUP);
  pinMode(BTN_BREATH, INPUT_PULLUP);
}

bool isButtonPressed(int pin) {
  if (digitalRead(pin) != LOW) {
    return false;
  }

  delay(DEBOUNCE_DELAY_MS);

  if (digitalRead(pin) != LOW) {
    return false;
  }

  // 버튼에서 손을 뗄 때까지 기다린다.
  // 구현은 단순하지만, 누르고 있는 동안 loop가 잠시 멈춘다.
  while (digitalRead(pin) == LOW) {
    delay(BUTTON_RELEASE_CHECK_MS);
  }

  return true;
}
