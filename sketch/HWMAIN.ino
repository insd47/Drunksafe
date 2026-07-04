#include <Wire.h>
#include <U8g2lib.h>
#include <esp_system.h>

// =====================================================
// Drunksafe OLED + button test firmware
// -----------------------------------------------------
// 현재 버전은 실제 센서 대신 랜덤값을 사용한다.
// 나중에 알코올 센서, 심박 센서, 서버 통신 코드가 확정되면
// 아래 "테스트용 값 생성" 함수들만 실제 측정 함수로 교체하면 된다.
// =====================================================

// =====================================================
// OLED 설정
// SH1106 128x64 I2C OLED
// 제품 설명의 0x78은 8-bit 주소이고, U8g2에는 8-bit 주소를 넣는다.
// 7-bit 주소 0x3C를 U8g2 형식으로 변환하면 0x3C * 2가 된다.
// =====================================================
const int OLED_SDA_PIN = 21;
const int OLED_SCL_PIN = 22;
const int OLED_WIDTH = 128;
const int OLED_I2C_ADDRESS = 0x3C * 2;

U8G2_SH1106_128X64_NONAME_F_HW_I2C oled(
  U8G2_R0,
  U8X8_PIN_NONE
);

// =====================================================
// 버튼 핀 설정
// INPUT_PULLUP 방식이므로 버튼을 누르면 LOW가 된다.
// =====================================================
const int BTN_START_RESET = 16;  // 시작 / 초기화
const int BTN_NEXT = 17;         // 측정값 화면 넘기기
const int BTN_BREATH = 18;       // 알코올 측정 시작

// =====================================================
// 시간 설정
// =====================================================
const unsigned long DEBOUNCE_DELAY_MS = 30;
const unsigned long BUTTON_RELEASE_CHECK_MS = 5;
const unsigned long BPM_SEND_INTERVAL_MS = 500;
const unsigned long ALCOHOL_MEASURE_DURATION_MS = 3000;
const unsigned long ALCOHOL_SCREEN_REFRESH_MS = 200;
const unsigned long RESET_MESSAGE_DURATION_MS = 3000;

// =====================================================
// 프로그램 상태
// =====================================================
bool deviceStarted = false;
float maxAlcoholValue = 0.0;
int currentBpm = 0;
unsigned long lastBpmSendTime = 0;

// 버튼으로 넘기는 측정 화면 순서:
// 상태 판정 -> 알코올 최고값 -> 심박수 -> 상태 판정 ...
int nextScreenIndex = 0;

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

ScreenState currentScreen = SCREEN_HOME;

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

SafetyState currentSafetyState = SAFETY_GOOD;

// =====================================================
// 함수 선언
// Arduino IDE가 자동 선언을 해주기도 하지만,
// 함수 간 호출 관계가 명확하게 보이도록 직접 선언한다.
// =====================================================
// 버튼이 눌렸다가 떼어졌는지 확인
bool isButtonPressed(int pin);
// 테스트용 심박수 생성
int generateRandomBpm();
// 테스트용 알코올 값 생성
float generateRandomAlcoholValue();
// 현재 상태를 양호/주의/위험 중 하나로 판정
SafetyState judgeSafetyState();
// 심박수를 서버나 통신 장치로 전송
void sendHeartRateToServer(int bpm);
// 일정 시간마다 심박수를 갱신하고 전송
void updateBpmAndSend();
// OLED에 영어 문구를 가운데 출력
void showEnglishText(const char* text);
// OLED 한 줄에 한글/UTF-8 문구를 가운데 출력
void drawCenteredUTF8(const char* text, int y);
// OLED에 한글 2줄 출력
void showKorean2Lines(const char* line1, const char* line2);
// 판정된 사용자 상태 화면 출력
void showState();
// 알코올 최고 측정값 화면 출력
void showAlcoholValue();
// 현재 심박수 화면 출력
void showHeartRate();
// 알코올 측정 중 안내 화면 출력
void showBreathMeasuringScreen(float currentValue, float maxValue);
// 초기화 안내 화면 출력
void showResetMessage();
// 버튼 입력에 따라 다음 측정 화면으로 전환
void showNextMeasurementScreen();
// 일정 시간 동안 알코올 값을 측정하고 최고값 저장
void runAlcoholMeasurement();
// 측정값과 상태를 초기화하고 홈 화면으로 복귀
void resetDevice();
// 기기를 시작하고 첫 측정을 실행
void startDevice();

// =====================================================
// 테스트용 값 생성
// -----------------------------------------------------
// 실제 센서 연동 시 이 부분을 교체한다.
// =====================================================
int generateRandomBpm() {
  return 80 + (esp_random() % 21);  // 80~100 bpm
}

float generateRandomAlcoholValue() {
  return (esp_random() % 1001) / 1000.0;  // 0.000~1.000%
}

SafetyState judgeSafetyState() {
  // TODO: 실제 판정식으로 교체.
  // 예: 알코올 최고값, 현재 심박수, 심박 변화량 등을 종합한다.
  int randomValue = esp_random() % 3;

  if (randomValue == 0) {
    return SAFETY_GOOD;
  }

  if (randomValue == 1) {
    return SAFETY_CAUTION;
  }

  return SAFETY_DANGER;
}

// =====================================================
// 서버 전송 자리
// -----------------------------------------------------
// 아직 통신 방식이 확정되지 않았으므로 빈 함수로 둔다.
// 나중에 HTTP, MQTT, Firebase, BLE, Serial 중 하나를 붙이면 된다.
// =====================================================
void sendHeartRateToServer(int bpm) {
  (void)bpm;  // 아직 사용하지 않는 매개변수 경고 방지
}

void updateBpmAndSend() {
  if (!deviceStarted) {
    return;
  }

  if (millis() - lastBpmSendTime < BPM_SEND_INTERVAL_MS) {
    return;
  }

  currentBpm = generateRandomBpm();
  sendHeartRateToServer(currentBpm);
  lastBpmSendTime = millis();

  // 심박수 화면을 보고 있을 때만 OLED 값을 즉시 갱신한다.
  if (currentScreen == SCREEN_BPM) {
    showHeartRate();
  }
}

// =====================================================
// 버튼 입력
// -----------------------------------------------------
// 간단한 채터링 방지 후, 버튼에서 손을 뗄 때까지 기다린다.
// 이 방식은 구현이 단순하지만 누르고 있는 동안 loop가 잠시 멈춘다.
// =====================================================
bool isButtonPressed(int pin) {
  if (digitalRead(pin) != LOW) {
    return false;
  }

  delay(DEBOUNCE_DELAY_MS);

  if (digitalRead(pin) != LOW) {
    return false;
  }

  while (digitalRead(pin) == LOW) {
    delay(BUTTON_RELEASE_CHECK_MS);
  }

  return true;
}

// =====================================================
// OLED 출력 헬퍼
// =====================================================
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

void drawCenteredUTF8(const char* text, int y) {
  int textWidth = oled.getUTF8Width(text);
  int x = (OLED_WIDTH - textWidth) / 2;

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

// =====================================================
// 화면 출력 함수
// =====================================================
void showState() {
  currentScreen = SCREEN_STATE;
  currentSafetyState = judgeSafetyState();

  if (currentSafetyState == SAFETY_GOOD) {
    showKorean2Lines("지금 상태는", "양호입니다");
    return;
  }

  if (currentSafetyState == SAFETY_CAUTION) {
    showKorean2Lines("지금 상태는", "주의입니다");
    return;
  }

  showKorean2Lines("지금 상태는", "위험입니다");
}

void showAlcoholValue() {
  currentScreen = SCREEN_ALCOHOL;

  char valueText[20];
  snprintf(valueText, sizeof(valueText), "%.3f%%", maxAlcoholValue);

  showKorean2Lines("알코올 측정량:", valueText);
}

void showHeartRate() {
  currentScreen = SCREEN_BPM;

  if (currentBpm == 0) {
    currentBpm = generateRandomBpm();
  }

  char bpmText[20];
  snprintf(bpmText, sizeof(bpmText), "%dbpm", currentBpm);

  showKorean2Lines("심박수:", bpmText);
}

void showBreathMeasuringScreen(float currentValue, float maxValue) {
  currentScreen = SCREEN_BREATH;
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
  currentScreen = SCREEN_RESET;
  showKorean2Lines("기기를", "초기화합니다");
}

void showNextMeasurementScreen() {
  switch (nextScreenIndex) {
    case 0:
      showState();
      nextScreenIndex = 1;
      break;

    case 1:
      showAlcoholValue();
      nextScreenIndex = 2;
      break;

    default:
      showHeartRate();
      nextScreenIndex = 0;
      break;
  }
}

// =====================================================
// 알코올 측정 흐름
// -----------------------------------------------------
// 3초 동안 값을 읽고, 그중 최고값을 저장한다.
// 현재는 랜덤값이지만 실제 센서에서는 analogRead 결과를 변환해서 넣는다.
// =====================================================
void runAlcoholMeasurement() {
  unsigned long startTime = millis();
  maxAlcoholValue = 0.0;

  while (millis() - startTime < ALCOHOL_MEASURE_DURATION_MS) {
    updateBpmAndSend();

    float currentValue = generateRandomAlcoholValue();

    if (currentValue > maxAlcoholValue) {
      maxAlcoholValue = currentValue;
    }

    showBreathMeasuringScreen(currentValue, maxAlcoholValue);
    delay(ALCOHOL_SCREEN_REFRESH_MS);
  }

  nextScreenIndex = 0;
}

// =====================================================
// 기기 상태 전환
// =====================================================
void resetDevice() {
  showResetMessage();
  delay(RESET_MESSAGE_DURATION_MS);

  deviceStarted = false;
  nextScreenIndex = 0;
  maxAlcoholValue = 0.0;
  currentBpm = 0;
  currentScreen = SCREEN_HOME;

  showEnglishText("Drunksafe");
}

void startDevice() {
  deviceStarted = true;
  currentBpm = generateRandomBpm();
  lastBpmSendTime = millis();

  sendHeartRateToServer(currentBpm);

  nextScreenIndex = 0;
  runAlcoholMeasurement();
  showNextMeasurementScreen();
}

// =====================================================
// Arduino 기본 진입점
// =====================================================
void setup() {
  randomSeed(esp_random());

  pinMode(BTN_START_RESET, INPUT_PULLUP);
  pinMode(BTN_NEXT, INPUT_PULLUP);
  pinMode(BTN_BREATH, INPUT_PULLUP);

  Wire.begin(OLED_SDA_PIN, OLED_SCL_PIN);

  oled.setI2CAddress(OLED_I2C_ADDRESS);
  oled.begin();
  oled.enableUTF8Print();

  currentScreen = SCREEN_HOME;
  showEnglishText("Drunksafe");
}

void loop() {
  if (!deviceStarted) {
    if (isButtonPressed(BTN_START_RESET)) {
      startDevice();
    }

    return;
  }

  updateBpmAndSend();

  if (isButtonPressed(BTN_START_RESET)) {
    resetDevice();
    return;
  }

  if (isButtonPressed(BTN_BREATH)) {
    nextScreenIndex = 0;
    runAlcoholMeasurement();
    showNextMeasurementScreen();
    return;
  }

  if (isButtonPressed(BTN_NEXT)) {
    showNextMeasurementScreen();
    return;
  }
}
