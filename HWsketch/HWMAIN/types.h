#ifndef TYPES_H
#define TYPES_H

// OLED에 현재 어떤 화면을 표시하고 있는지 나타내는 상태값입니다.
// device.cpp에서 버튼 입력과 측정 흐름에 따라 이 값을 바꿉니다.
enum ScreenState {
  SCREEN_HOME,     // 초기 화면
  SCREEN_STATE,    // 안전/주의/위험 판별 화면
  SCREEN_ALCOHOL,  // 알코올 측정값 화면
  SCREEN_BPM,      // 심박수 화면
  SCREEN_BREATH,   // 알코올 측정 진행 화면
  SCREEN_RESET     // 리셋 안내 화면
};

// 사용자 위험도를 표현하는 최종 판별 결과입니다.
// 현재 judgeSafetyState()에서 사용하며, 추후 알코올/BPM/AI 특징값 기준으로 정교화할 수 있습니다.
enum SafetyState {
  SAFETY_GOOD,
  SAFETY_CAUTION,
  SAFETY_DANGER
};

#endif
