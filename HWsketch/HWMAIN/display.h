#ifndef DISPLAY_H
#define DISPLAY_H

#include "types.h"

// OLED 초기화
void initDisplay();

// OLED에 영어 문구를 가운데 출력
void showEnglishText(const char* text);

// OLED에 한글 2줄 출력
void showKorean2Lines(const char* line1, const char* line2);

// 판정된 사용자 상태 화면 출력
void showStateScreen(SafetyState safetyState);

// 알코올 최고 측정값 화면 출력
void showAlcoholValueScreen(float maxAlcoholValue);

// 현재 심박수 화면 출력
void showHeartRateScreen(int currentBpm);

// 알코올 측정 중 안내 화면 출력
void showBreathMeasuringScreen(float currentValue, float maxValue);

// 초기화 안내 화면 출력
void showResetMessageScreen();

#endif
