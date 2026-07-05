#ifndef SENSORS_H
#define SENSORS_H

#include "types.h"

void initBpmSensor();
void updateBpmSensor();

int Bpm();
float alcohol();
SafetyState judgeSafetyState(float maxAlcoholValue, int currentBpm);

#endif
