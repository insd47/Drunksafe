#include <Wire.h>
#include <U8g2lib.h>
#include <esp_system.h> //테스트용 랜덤코드 생성용

// =====================================================
// OLED 설정
// SH1106 128x64 I2C OLED
// SDA = GPIO21
// SCL = GPIO22
// =====================================================
U8G2_SH1106_128X64_NONAME_F_HW_I2C oled(
  U8G2_R0,
  U8X8_PIN_NONE
);

// =====================================================
// 버튼 핀 설정
// =====================================================
const int BTN_START_RESET = 16;  // 시작 / 초기화
const int BTN_NEXT        = 17;  // 측정값 화면 넘기기
const int BTN_BREATH      = 18;  // 알코올 센서 안내

// =====================================================
// 측정값이 저장될 변수
// =====================================================
float maxAlcoholValue = 0.0;  // 알코올 측정 최고값 저장

// =====================================================
// 프로그램 상태 변수
// =====================================================
bool deviceStarted = false;   // false면 최초 대기 상태
int nextScreenIndex = 0;      // GPIO17을 누를 때마다 바뀌는 화면 번호

// =====================================================
// 버튼 입력 확인 함수
// INPUT_PULLUP 방식이므로 버튼을 누르면 LOW
// =====================================================
bool isButtonPressed(int pin) {
  if (digitalRead(pin) == LOW) {
    delay(30);  // 채터링 방지

    if (digitalRead(pin) == LOW) {
      // 버튼에서 손을 뗄 때까지 대기
      while (digitalRead(pin) == LOW) {
        delay(5);
      }

      return true;
    }
  }

  return false;
}

// =====================================================
// 영어 문구 출력 함수
// Drunksafe 출력용
// =====================================================
void showEnglishText(const char* text) {
  oled.clearBuffer();

  oled.setFont(u8g2_font_ncenB14_tr);

  int textWidth = oled.getStrWidth(text);
  int x = (128 - textWidth) / 2;
  int y = 36;

  oled.drawStr(x, y, text);

  oled.sendBuffer();
}

// =====================================================
// 한글 출력용 함수
// 한글은 한 줄에 길게 쓰면 OLED 폭을 넘기므로
// 2줄 또는 3줄로 나누어 출력
// =====================================================
void drawCenteredUTF8(const char* text, int y) {
  int textWidth = oled.getUTF8Width(text);
  int x = (128 - textWidth) / 2;

  if (x < 0) {
    x = 0;
  }

  oled.setCursor(x, y);
  oled.print(text);
}

void showKorean2Lines(const char* line1, const char* line2) {
  oled.clearBuffer();

  oled.setFont(u8g2_font_unifont_t_korean2);
  oled.enableUTF8Print();

  drawCenteredUTF8(line1, 25);
  drawCenteredUTF8(line2, 52);

  oled.sendBuffer();
}

void showKorean3Lines(const char* line1, const char* line2, const char* line3) {
  oled.clearBuffer();

  oled.setFont(u8g2_font_unifont_t_korean2);
  oled.enableUTF8Print();

  drawCenteredUTF8(line1, 16);
  drawCenteredUTF8(line2, 37);
  drawCenteredUTF8(line3, 58);

  oled.sendBuffer();
}

// =====================================================
// 각 화면 출력 함수
// =====================================================
void showNormalState() {
  showKorean2Lines("지금 상태는", "양호입니다");
}

//알코올센서 측정값 출력용 함수
void showAlcoholValue() {
  char valueText[20];

  // 최고 알코올 값을 소수점 셋째 자리까지 문자열로 변환
  snprintf(valueText, sizeof(valueText), "%.3f%%", maxAlcoholValue);

  showKorean2Lines("알코올 측정량:", valueText);
}

void showHeartRate() {
  showKorean2Lines("심박수:", "150bpm");
}
//알코올센서 측정값 화면 출력용 함수
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

void showResetMessage() {
  showKorean2Lines("기기를", "초기화합니다");
}

// =====================================================
// GPIO17 버튼을 누를 때마다 화면을 바꾸는 함수
// 알코올 → 심박수 → 양호 → 알코올 → ...
// =====================================================
void showNextMeasurementScreen() {
  if (nextScreenIndex == 1) {
    showAlcoholValue();
    nextScreenIndex = 2;
  }
  else if (nextScreenIndex == 2) {
    showHeartRate();
    nextScreenIndex = 0;
  }
  else {
    showNormalState();
    nextScreenIndex = 1;
  }
}

// =====================================================
// 랜덤 생성함수, 실제제품에는 수정 필요
// =====================================================
void runAlcoholMeasurement() {
  unsigned long startTime = millis();

  // 3초 동안 측정하는 척함
  while (millis() - startTime < 3000) {
    // 0.000 ~ 1.000 사이 난수 생성
    float currentValue = (esp_random() % 1001) / 1000.0;

    // 최고값만 저장
    if (currentValue > maxAlcoholValue) {
      maxAlcoholValue = currentValue;
    }

    // OLED에 현재값과 최고값 표시
    showBreathMeasuringScreen(currentValue, maxAlcoholValue);

    // 너무 빠르게 바뀌면 보기 힘드니까 0.2초마다 갱신
    delay(200);
  }

  // 측정 후 GPIO17 반복 순서를 알코올 측정량부터 시작
  nextScreenIndex = 0;
}

void setup() {
  randomSeed(esp_random());//테스트용 랜덤 생성용
  // 버튼 입력 설정
  pinMode(BTN_START_RESET, INPUT_PULLUP);
  pinMode(BTN_NEXT, INPUT_PULLUP);
  pinMode(BTN_BREATH, INPUT_PULLUP);

  // I2C 시작
  Wire.begin(21, 22);

  // OLED 주소 설정
  // 제품 설명의 0x78은 8-bit 주소
  // 보통 7-bit 주소로는 0x3C
  oled.setI2CAddress(0x3C * 2);

  // OLED 시작
  oled.begin();
  oled.enableUTF8Print();

  // 최초 실행 화면
  showEnglishText("Drunksafe");
}

void loop() {
  // =====================================================
  // 최초 상태
  // Drunksafe 출력 후 GPIO16 입력이 들어올 때까지 대기
  // =====================================================
  if (deviceStarted == false) {
    if (isButtonPressed(BTN_START_RESET)) {
      deviceStarted = true;

      // GPIO16 입력이 들어오면 측정
      nextScreenIndex = 0;
      runAlcoholMeasurement();
      showNextMeasurementScreen();
    }

    return;
  }

  // =====================================================
  // 작동 상태
  // GPIO16: 초기화
  // GPIO17: 측정값 화면 넘기기
  // GPIO18: 입김 안내 3초 출력
  // =====================================================

  // GPIO16 입력: 초기화
  if (isButtonPressed(BTN_START_RESET)) {
    showResetMessage();
    delay(3000);

    deviceStarted = false;
    nextScreenIndex = 0;
    maxAlcoholValue = 0.0;
    showEnglishText("Drunksafe");
    return;
  }

  // GPIO18 입력: 알코올 입력 센서 안내
  if (isButtonPressed(BTN_BREATH)) {
    nextScreenIndex = 0;
    runAlcoholMeasurement();
    showNextMeasurementScreen();
   return;
  }

  // GPIO17 입력: 측정값 화면 반복
  if (isButtonPressed(BTN_NEXT)) {
    showNextMeasurementScreen();
    return;
  }
}