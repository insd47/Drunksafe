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

enum AlcoholSensorStatus {
    ALCOHOL_SENSOR_IDLE,
    ALCOHOL_SENSOR_WARMING,
    ALCOHOL_SENSOR_READY_TO_BLOW,
    ALCOHOL_SENSOR_BLOWING,
    ALCOHOL_SENSOR_BLOW_WEAK,
    ALCOHOL_SENSOR_ANALYZING,
    ALCOHOL_SENSOR_DONE,
    ALCOHOL_SENSOR_TIMEOUT,
    ALCOHOL_SENSOR_ERROR
};

void initAlcoholSensor();
void startAlcoholMeasurement();
void updateAlcoholSensor();
bool isAlcoholMeasurementFinished();
AlcoholSensorStatus getAlcoholSensorStatus();
float alcohol();

SafetyState judgeSafetyState(float maxAlcoholValue, int currentBpm);

#endif
