#include <Arduino.h>
#include "config.h"
#include "alert.h"

namespace {
// 알림 상태.
// 0 대기, 1 ON, 2 OFF, 3 ON.
int patternState = 0;
unsigned long patternTimer = 0;

// 부저 제어.
// 2 켜짐, 1 꺼짐.
void beep(int type) {
    switch (type) {
        case 1: digitalWrite(SPEAKER_PIN, HIGH); break;
        case 2: digitalWrite(SPEAKER_PIN, LOW); break;
        default: digitalWrite(SPEAKER_PIN, HIGH); break;
    }
}

// 진동 제어.
void vibe(int type) {
    switch (type) {
        case 1: digitalWrite(VIBRATION_PIN, LOW); break;
        case 2: digitalWrite(VIBRATION_PIN, HIGH); break;
        default: digitalWrite(VIBRATION_PIN, LOW); break;
    }
}
}  // namespace

// 출력핀 설정.
void initAlert() {
  pinMode(SPEAKER_PIN, OUTPUT);
  pinMode(VIBRATION_PIN, OUTPUT);
  beep(1);
  vibe(1);
}

// 알림 패턴 진행.
// 지연 함수 사용 안 함.
void updateAlertPattern() {
    switch (patternState) {
      case 1:
        if (millis() - patternTimer >= 100) {
          patternState = 2;
          patternTimer = millis();
          beep(1); vibe(1);
        }
        break;

      case 2:
        if (millis() - patternTimer >= 50) {
          patternState = 3;
          patternTimer = millis();
          beep(2); vibe(2);
        }
        break;

      case 3:
        if (millis() - patternTimer >= 100) {
          patternState = 0;
          beep(1); vibe(1);
        }
        break;
    }
}

// 알림 시작.
void triggerAlert() {
    if (patternState == 0) {
        patternState = 1;
        patternTimer = millis();
        beep(2); vibe(2);
    }
}
