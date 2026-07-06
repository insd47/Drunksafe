#ifndef DISPLAY_H
#define DISPLAY_H

#include "types.h"

// OLED 초기화.
void initDisplay();

// 영문 한 줄 출력.
void showEnglishText(const char* text);

// 두 줄 출력.
void showKorean2Lines(const char* line1, const char* line2);

// 판별 결과 출력.
void showStateScreen(SafetyState safetyState);

// 알코올값 출력.
void showAlcoholValueScreen(float maxAlcoholValue);

// BPM 출력.
void showHeartRateScreen(int currentBpm);

// 리셋 안내 출력.
void showResetMessageScreen();

#endif
