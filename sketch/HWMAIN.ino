#include <Wire.h>
#include <U8g2lib.h>

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

  oled.setFont(u8g2_font_unifont_t_korean1);
  oled.enableUTF8Print();

  drawCenteredUTF8(line1, 25);
  drawCenteredUTF8(line2, 52);

  oled.sendBuffer();
}

void showKorean3Lines(const char* line1, const char* line2, const char* line3) {
  oled.clearBuffer();

  oled.setFont(u8g2_font_unifont_t_korean1);
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

void showAlcoholValue() {
  showKorean2Lines("알코올 측정량:", "5%");
}

void showHeartRate() {
  showKorean2Lines("심박수:", "150bpm");
}

void showBreathMessage() {
  showKorean2Lines("알코올 센서에", "입김을 부세요!");
}

void showResetMessage() {
  showKorean2Lines("기기를", "초기화합니다");
}

// =====================================================
// GPIO17 버튼을 누를 때마다 화면을 바꾸는 함수
// 알코올 → 심박수 → 양호 → 알코올 → ...
// =====================================================
void showNextMeasurementScreen() {
  if (nextScreenIndex == 0) {
    showAlcoholValue();
    nextScreenIndex = 1;
  }
  else if (nextScreenIndex == 1) {
    showHeartRate();
    nextScreenIndex = 2;
  }
  else {
    showNormalState();
    nextScreenIndex = 0;
  }
}

void setup() {
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

      // GPIO16 입력이 들어오면 양호 상태 출력
      showNormalState();

      // 이후 GPIO17 반복은 알코올 측정량부터 시작
      nextScreenIndex = 0;
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

    showEnglishText("Drunksafe");
    return;
  }

  // GPIO18 입력: 알코올 센서 안내
  if (isButtonPressed(BTN_BREATH)) {
    showBreathMessage();
    delay(3000);

    // 이후 GPIO17 반복을 알코올 측정량부터 다시 시작
    nextScreenIndex = 0;
    return;
  }

  // GPIO17 입력: 측정값 화면 반복
  if (isButtonPressed(BTN_NEXT)) {
    showNextMeasurementScreen();
    return;
  }
}