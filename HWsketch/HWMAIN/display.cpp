#include <Arduino.h>
#include <Wire.h>
#include <U8g2lib.h>
#include "config.h"
#include "display.h"

U8G2_SH1106_128X64_NONAME_F_HW_I2C oled(
  U8G2_R0,
  U8X8_PIN_NONE
);

// UTF-8 문자열의 화면 폭을 계산해서 OLED 가로 중앙에 배치합니다.
// 한글 폰트 출력 함수들이 공통으로 사용하는 내부 helper입니다.
static void drawCenteredUTF8(const char* text, int y) {
  int textWidth = oled.getUTF8Width(text);
  int x = (OLED_WIDTH - textWidth) / 2;

  if (x < 0) {
    x = 0;
  }

  oled.setCursor(x, y);
  oled.print(text);
}

// OLED I2C 핀, I2C 주소, UTF-8 출력 모드를 초기화합니다.
void initDisplay() {
  Wire.begin(OLED_SDA_PIN, OLED_SCL_PIN);

  oled.setI2CAddress(OLED_I2C_ADDRESS);
  oled.begin();
  oled.enableUTF8Print();
}

// 영문 단일 문구를 큰 글씨로 중앙에 표시합니다.
// 홈 화면의 "Drunksafe" 표시처럼 영어만 쓰는 화면에 적합합니다.
void showEnglishText(const char* text) {
  oled.clearBuffer();
  oled.setFont(u8g2_font_ncenB14_tr);

  int textWidth = oled.getStrWidth(text);
  int x = (OLED_WIDTH - textWidth) / 2;

  if (x < 0) {
    x = 0;
  }

  oled.drawStr(x, 36, text);
  oled.sendBuffer();
}

// 한글/영문 UTF-8 문자열 두 줄을 OLED 중앙에 표시합니다.
// 대부분의 안내 화면이 이 함수를 통해 구성됩니다.
void showKorean2Lines(const char* line1, const char* line2) {
  oled.clearBuffer();
  oled.setFont(u8g2_font_unifont_t_korean2);
  oled.enableUTF8Print();

  drawCenteredUTF8(line1, 25);
  drawCenteredUTF8(line2, 52);

  oled.sendBuffer();
}

// 안전 판별 결과 enum을 실제 사용자 안내 문구로 변환해 표시합니다.
void showStateScreen(SafetyState safetyState) {
  if (safetyState == SAFETY_GOOD) {
    showKorean2Lines("지금 상태는", "양호입니다");
    return;
  }

  if (safetyState == SAFETY_CAUTION) {
    showKorean2Lines("지금 상태는", "주의입니다");
    return;
  }

  showKorean2Lines("지금 상태는", "위험입니다");
}

// 알코올 측정값을 소수점 3자리 퍼센트 형식으로 표시합니다.
void showAlcoholValueScreen(float maxAlcoholValue) {
  char valueText[20];
  snprintf(valueText, sizeof(valueText), "%.3f%%", maxAlcoholValue);

  showKorean2Lines("알코올 측정량:", valueText);
}

// BPM 숫자를 "NNbpm" 형태로 만들어 표시합니다.
void showHeartRateScreen(int currentBpm) {
  char bpmText[20];
  snprintf(bpmText, sizeof(bpmText), "%dbpm", currentBpm);

  showKorean2Lines("심박수:", bpmText);
}

// 알코올 측정 중 현재값과 최대값을 함께 표시하는 화면입니다.
// ZE-29A 상태 기반 안내로 흐름이 바뀐 뒤에도, 필요 시 재사용할 수 있도록 유지합니다.
void showBreathMeasuringScreen(float currentValue, float maxValue) {
  oled.clearBuffer();
  oled.setFont(u8g2_font_unifont_t_korean2);
  oled.enableUTF8Print();

  char currentText[20];
  char maxText[20];

  snprintf(currentText, sizeof(currentText), "현재: %.3f%%", currentValue);
  snprintf(maxText, sizeof(maxText), "최고: %.3f%%", maxValue);

  drawCenteredUTF8("알코올 센서에", 14);
  drawCenteredUTF8("입김을 부세요!", 30);
  drawCenteredUTF8(currentText, 46);
  drawCenteredUTF8(maxText, 62);

  oled.sendBuffer();
}

// 리셋 버튼 처리 직후 사용자에게 초기화 중임을 알려줍니다.
void showResetMessageScreen() {
  showKorean2Lines("기기를", "초기화합니다");
}
