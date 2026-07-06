#ifndef COMMS_H
#define COMMS_H

#include "sensors.h"

// BLE 통신 모듈을 초기화합니다.
// - ESP32의 Bluetooth MAC 뒤 2바이트를 이용해 장치 이름을 만듭니다.
// - 앱이 찾을 수 있는 BLE service/characteristic을 생성합니다.
// - setupDevice()에서 한 번만 호출됩니다.
void initComms();

// 앱으로 보낼 심박 특징값과 알코올 측정값을 JSON 형태로 구성합니다.
// 현재 comms.cpp에서는 실제 BLE notify 전송 줄이 비활성화되어 있으므로,
// 앱 연동을 켤 때 pCharacteristic->setValue()/notify() 주석을 해제해야 합니다.
void sendDataToApp(const PpgFeatures& features, float alcoholVal);

// 앱 그래프 표시용 원본 PPG ADC 샘플 묶음을 JSON 형태로 구성합니다.
// runBackgroundTasks()가 raw buffer에 쌓인 값을 일정 개수씩 꺼내 이 함수를 호출합니다.
void sendRawDataToApp(unsigned long start_t, const int* values, int count);

#endif
