#include <Arduino.h>
#include <esp_system.h>
#include "sensors.h"

int Bpm() {
  // TODO: 실제 심박 센서 알고리즘으로 교체.
  return 80 + (esp_random() % 21);  // 80~100 bpm
}

float alcohol() {
  // TODO: 실제 알코올 센서 측정/보정 알고리즘으로 교체.
  return (esp_random() % 1001) / 1000.0;  // 0.000~1.000%
}

SafetyState judgeSafetyState(float maxAlcoholValue, int currentBpm) {
  // 아직 사용하지 않는 매개변수 경고 방지.
  // 실제 판정식이 들어오면 아래 두 값을 사용하면 된다.
  (void)maxAlcoholValue;
  (void)currentBpm;

  // TODO: 실제 판정식으로 교체.
  // 예: 알코올 최고값, 현재 심박수, 심박 변화량 등을 종합한다.
  int randomValue = esp_random() % 3;

  if (randomValue == 0) {
    return SAFETY_GOOD;
  }

  if (randomValue == 1) {
    return SAFETY_CAUTION;
  }

  return SAFETY_DANGER;
}
