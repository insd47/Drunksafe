#ifndef COMMS_H
#define COMMS_H

#include "sensors.h"

// BLE 통신 초기화
void initComms();

// 스마트폰 앱으로 PPG 특징값 및 알코올 수치를 JSON으로 전송
void sendDataToApp(const PpgFeatures& features, float alcoholVal);

// 실시간 10ms Raw 데이터를 배열 형태로 앱에 전송
void sendRawDataToApp(unsigned long start_t, const int* values, int count);

#endif
