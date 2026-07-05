#include <Arduino.h>
#include <Wire.h>
#include <U8g2lib.h>
#include "config.h"
#include "display.h"

U8G2_SH1106_128X64_NONAME_F_HW_I2C oled(
  U8G2_R0,
  U8X8_PIN_NONE
);

static void drawCenteredUTF8(const char* text, int y) {
  int textWidth = oled.getUTF8Width(text);
  int x = (OLED_WIDTH - textWidth) / 2;

  if (x < 0) {
    x = 0;
  }

  oled.setCursor(x, y);
  oled.print(text);
}

void initDisplay() {
  Wire.begin(OLED_SDA_PIN, OLED_SCL_PIN);

  oled.setI2CAddress(OLED_I2C_ADDRESS);
  oled.begin();
  oled.enableUTF8Print();
}

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

void showKorean2Lines(const char* line1, const char* line2) {
  oled.clearBuffer();
  oled.setFont(u8g2_font_unifont_t_korean2);
  oled.enableUTF8Print();

  drawCenteredUTF8(line1, 25);
  drawCenteredUTF8(line2, 52);

  oled.sendBuffer();
}

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

void showAlcoholValueScreen(float maxAlcoholValue) {
  char valueText[20];
  snprintf(valueText, sizeof(valueText), "%.3f%%", maxAlcoholValue);

  showKorean2Lines("알코올 측정량:", valueText);
}

void showHeartRateScreen(int currentBpm) {
  char bpmText[20];
  snprintf(bpmText, sizeof(bpmText), "%dbpm", currentBpm);

  showKorean2Lines("심박수:", bpmText);
}

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

void showResetMessageScreen() {
  showKorean2Lines("기기를", "초기화합니다");
}
