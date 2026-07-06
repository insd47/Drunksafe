#include "device.h"

// Arduino 스케치의 진입점 파일입니다.
// 실제 기능 구현은 device/buttons/display/sensors/comms 모듈에 나뉘어 있습니다.
// 이 파일은 Arduino 런타임의 setup()/loop()를 프로젝트 함수로 연결하는 역할만 합니다.

void setup() {
  // 보드 전원 인가 또는 리셋 직후 한 번만 실행되는 초기화 흐름입니다.
  setupDevice();
}

void loop() {
  // 보드가 켜져 있는 동안 계속 반복되는 메인 동작 흐름입니다.
  loopDevice();
}
