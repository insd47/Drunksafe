#ifndef DEVICE_H
#define DEVICE_H

// Arduino setup()에서 호출되는 전체 장치 초기화 함수입니다.
// 버튼, 심박 센서, 알코올 센서, OLED, 진동/부저 출력, BLE 통신을 준비합니다.
void setupDevice();

// 화면 전환 대기나 알코올 측정 중에도 계속 돌아야 하는 백그라운드 작업입니다.
// 심박 샘플링, 알코올 센서 polling, 진동/부저 패턴, raw PPG 전송을 처리합니다.
void runBackgroundTasks();

// Arduino loop()에서 반복 호출되는 메인 상태 처리 함수입니다.
// 시작/리셋 버튼, 알코올 측정 버튼, 다음 화면 버튼 입력을 기준으로 장치 흐름을 제어합니다.
void loopDevice();

#endif
