#ifndef DISPLAY_H
#define DISPLAY_H

#include "types.h"

// OLED I2C 통신과 U8g2 출력 설정을 초기화합니다.
void initDisplay();

// 영문 단일 문장을 OLED 중앙에 표시합니다.
// 시작 화면처럼 한 줄 영문 안내가 필요할 때 사용합니다.
void showEnglishText(const char* text);

// UTF-8 문자열 두 줄을 OLED 중앙 정렬로 표시합니다.
// 한글 폰트를 사용하므로 한글/영문 혼합 안내 화면에 사용합니다.
void showKorean2Lines(const char* line1, const char* line2);

// 현재 판별 결과를 OLED에 표시합니다.
void showStateScreen(SafetyState safetyState);

// 알코올 센서에서 측정된 최종/최대값을 OLED에 표시합니다.
void showAlcoholValueScreen(float maxAlcoholValue);

// 현재 BPM 값을 OLED에 표시합니다.
void showHeartRateScreen(int currentBpm);

// 알코올 측정 중 현재값과 최대값을 함께 보여주는 화면입니다.
// 현재 메인 흐름에서는 ZE-29A 상태 안내 화면을 주로 사용합니다.
void showBreathMeasuringScreen(float currentValue, float maxValue);

// 장치 리셋 안내 문구를 OLED에 표시합니다.
void showResetMessageScreen();

#endif
