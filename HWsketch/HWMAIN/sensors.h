#ifndef SENSORS_H
#define SENSORS_H

#include "types.h"

// 앱 전송용 심박 특징값 묶음입니다.
// 5초 단위 계산값과 20초/1분/5분 이동평균 추세값을 함께 담습니다.
struct PpgFeatures {
    unsigned long t;              // millis() 기준 현재 시간
    int time_counter;             // 심박 특징값이 누적된 시간 카운터(초)
    float current_bpm;            // 최근 5초 창에서 계산한 BPM
    float current_ibi_stdev;      // 박동 간격(IBI)의 표준편차, 흔들림 판단에 사용
    float current_peak_amp;       // 최근 창에서 검출된 PPG 피크 평균 크기
    float bpm_20s;                // 20초 이동평균 BPM
    float bpm_20s_d;              // 이전 20초 이동평균 대비 변화량
    float bpm_1m;                 // 1분 이동평균 BPM
    float bpm_1m_d;               // 이전 1분 이동평균 대비 변화량
    float bpm_5m;                 // 5분 이동평균 BPM
    float bpm_5m_d;               // 이전 5분 이동평균 대비 변화량
    int stabilized;               // 0이면 안정, 1이면 흔들림/불안정
};

// PPG 심박 센서 ADC 설정을 초기화합니다.
void initBpmSensor();

// PPG를 주기적으로 샘플링하고, 충분한 데이터가 모이면 BPM을 갱신합니다.
void updateBpmSensor();

// 앱 그래프 전송용 raw PPG 샘플이 몇 개 쌓였는지 반환합니다.
int getRawDataAvailable();

// raw PPG 샘플을 최대 max_count개 꺼냅니다.
// out_start_t에는 꺼낸 첫 샘플의 측정 시간이 저장됩니다.
int popRawDataBatch(unsigned long& out_start_t, int* out_values, int max_count);

// OLED 표시용 최신 BPM 값을 반환합니다. 아직 안정 계산 전이면 0을 반환합니다.
int Bpm();

// BLE 앱 전송용 최신 심박 특징값 묶음을 반환합니다.
PpgFeatures getLatestPpgFeatures();

// ZE-29A 알코올 센서의 현재 진행 상태입니다.
enum AlcoholSensorStatus {
    ALCOHOL_SENSOR_IDLE,           // 대기 상태
    ALCOHOL_SENSOR_WARMING,        // 센서 예열 중
    ALCOHOL_SENSOR_READY_TO_BLOW,  // 사용자가 숨을 불 준비 완료
    ALCOHOL_SENSOR_BLOWING,        // 숨을 불고 있는 중
    ALCOHOL_SENSOR_BLOW_WEAK,      // 숨 세기가 부족함
    ALCOHOL_SENSOR_ANALYZING,      // 센서가 결과를 분석 중
    ALCOHOL_SENSOR_DONE,           // 측정 완료
    ALCOHOL_SENSOR_TIMEOUT,        // 제한 시간 초과
    ALCOHOL_SENSOR_ERROR           // 알 수 없는 상태/패킷 오류
};

// ZE-29A용 Serial2 통신을 초기화하고 센서를 idle 상태로 둡니다.
void initAlcoholSensor();

// 새 알코올 측정을 시작합니다.
void startAlcoholMeasurement();

// ZE-29A 상태를 주기적으로 조회하고 들어온 패킷을 처리합니다.
void updateAlcoholSensor();

// 현재 알코올 측정이 끝났는지 반환합니다.
bool isAlcoholMeasurementFinished();

// OLED 안내에 사용할 ZE-29A 현재 상태를 반환합니다.
AlcoholSensorStatus getAlcoholSensorStatus();

// 가장 최근 알코올 측정 결과를 반환합니다.
float alcohol();

// 알코올 수치와 BPM을 바탕으로 최종 안전 상태를 판별합니다.
// 현재 구현은 임시 랜덤 판별이며, 실제 판별 알고리즘을 넣을 위치입니다.
SafetyState judgeSafetyState(float maxAlcoholValue, int currentBpm);

#endif
