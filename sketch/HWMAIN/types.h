#ifndef TYPES_H
#define TYPES_H

// =====================================================
// 화면 상태
// =====================================================
enum ScreenState {
  SCREEN_HOME,
  SCREEN_STATE,
  SCREEN_ALCOHOL,
  SCREEN_BPM,
  SCREEN_BREATH,
  SCREEN_RESET
};

// =====================================================
// 사용자 상태 판정값
// 현재는 랜덤 테스트용이며, 실제 제품에서는
// 알코올 수치 + 심박수 + 추가 특징값을 기준으로 판정한다.
// =====================================================
enum SafetyState {
  SAFETY_GOOD,
  SAFETY_CAUTION,
  SAFETY_DANGER
};

#endif
