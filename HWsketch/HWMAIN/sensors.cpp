#include <Arduino.h>
#include <esp_system.h>
#include "sensors.h"

SafetyState judgeSafetyState(float maxAlcoholValue, int currentBpm) {
  (void)maxAlcoholValue;
  (void)currentBpm;

  int randomValue = esp_random() % 3;

  if (randomValue == 0) {
    return SAFETY_GOOD;
  }

  if (randomValue == 1) {
    return SAFETY_CAUTION;
  }

  return SAFETY_DANGER;
}
