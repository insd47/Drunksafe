#ifndef SENSORS_H
#define SENSORS_H

#include "types.h"

struct PpgFeatures {
    unsigned long t;
    int time_counter;
    float current_bpm;
    float current_ibi_stdev;
    float current_peak_amp;
    float bpm_20s;
    float bpm_20s_d;
    float bpm_1m;
    float bpm_1m_d;
    float bpm_5m;
    float bpm_5m_d;
    int stabilized;
};

void initBpmSensor();
void updateBpmSensor();

int getRawDataAvailable();
int popRawDataBatch(unsigned long& out_start_t, int* out_values, int max_count);

int Bpm();
PpgFeatures getLatestPpgFeatures();

float alcohol();
SafetyState judgeSafetyState(float maxAlcoholValue, int currentBpm);

#endif
