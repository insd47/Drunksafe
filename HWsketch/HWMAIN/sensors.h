#ifndef SENSORS_H
#define SENSORS_H

#include "types.h"
#include "ppg_sensor.h"
#include "alcohol_sensor.h"

// 최종 상태 판별.
// 현재는 임시 랜덤값.
SafetyState judgeSafetyState(float maxAlcoholValue, int currentBpm);

#endif
