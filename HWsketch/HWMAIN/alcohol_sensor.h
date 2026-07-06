#ifndef ALCOHOL_SENSOR_H
#define ALCOHOL_SENSOR_H

// ZE-29A 알코올 센서 모듈.

// 측정 진행 상태.
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

// Serial2 초기화.
void initAlcoholSensor();

// 새 측정 시작.
void startAlcoholMeasurement();

// 센서 상태 갱신.
void updateAlcoholSensor();

// 측정 종료 여부.
bool isAlcoholMeasurementFinished();

// 현재 측정 상태.
AlcoholSensorStatus getAlcoholSensorStatus();

// 최신 알코올값.
float alcohol();

#endif
