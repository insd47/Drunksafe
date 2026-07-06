#ifndef PPG_SENSOR_H
#define PPG_SENSOR_H

// PPG 심박 센서 모듈.

// 앱 전송용 심박 특징값.
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

// ADC 초기화.
void initBpmSensor();

// PPG 비차단 샘플링.
void updateBpmSensor();

// raw 샘플 개수 반환.
int getRawDataAvailable();

// raw 샘플 꺼내기.
int popRawDataBatch(unsigned long& out_start_t, int* out_values, int max_count);

// 최신 BPM 반환.
int Bpm();

// 최신 특징값 반환.
PpgFeatures getLatestPpgFeatures();

#endif
