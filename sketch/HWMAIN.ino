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
int currentBpm = 0;  // 현재 심박수 저장

unsigned long lastBpmSendTime = 0;          // 마지막 심박수 전송 시간
const unsigned long BPM_SEND_INTERVAL = 500; // 0.5초

// =====================================================
// 프로그램 상태 변수
// =====================================================
bool deviceStarted = false;   // false면 최초 대기 상태
int nextScreenIndex = 0;      // GPIO17을 누를 때마다 바뀌는 화면 번호

// =====================================================
// 현재 OLED에 표시 중인 화면 상태
// =====================================================
enum ScreenState {
  SCREEN_HOME,
  SCREEN_NORMAL,
  SCREEN_ALCOHOL,
  SCREEN_BPM,
  SCREEN_BREATH,
  SCREEN_RESET
};

ScreenState currentScreen = SCREEN_HOME;

// =====================================================
// 심박정보 전송 함수
// 차후 통신방식 결정 후 추가 예정
// =====================================================
void sendHeartRateToServer(int bpm) {
  /*
    나중에 여기에 서버 전송 코드 추가

    예시 후보:
    - HTTP POST
    - MQTT publish
    - Firebase
    - WebSocket
    - BLE
    - Serial 통신
  */
}

// =====================================================
// 심박정보 생성 및 전달함수
// 랜덤상태이므로 차후 수정 필요
// =====================================================
//랜덤생성함수
int generateRandomBpm() {
  return 80 + (esp_random() % 21);
}

void updateBpmAndSend() {
  // 기기가 시작되지 않았으면 아무것도 안 함
  if (deviceStarted == false) {
    return;
  }

  // 0.5초가 지났는지 확인
  if (millis() - lastBpmSendTime >= BPM_SEND_INTERVAL) {
    
    currentBpm = generateRandomBpm(); //실제 계측값으로 수정필요(랜덤제거)

    // 서버 전송 함수 호출
    sendHeartRateToServer(currentBpm);

    // 마지막 전송 시간 갱신
    lastBpmSendTime = millis();

    // 현재 OLED가 심박수 화면이면 즉시 화면도 갱신
    if (currentScreen == SCREEN_BPM) {
      showHeartRate();
    }
  }
}

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
  currentScreen = SCREEN_NORMAL;
  showKorean2Lines("지금 상태는", "양호입니다");
}

//알코올센서 측정값 출력용 함수
void showAlcoholValue() {
  currentScreen = SCREEN_ALCOHOL;
  char valueText[20];

  // 최고 알코올 값을 소수점 셋째 자리까지 문자열로 변환
  snprintf(valueText, sizeof(valueText), "%.3f%%", maxAlcoholValue);

  showKorean2Lines("알코올 측정량:", valueText);
}

//심박센서 측정값 화면 출력함수
void showHeartRate() {
  currentScreen = SCREEN_BPM;
  char bpmText[20];

  // 아직 값이 없으면 하나 생성
  if (currentBpm == 0) {
    currentBpm = generateRandomBpm();
  }

  snprintf(bpmText, sizeof(bpmText), "%dbpm", currentBpm);

  showKorean2Lines("심박수:", bpmText);
}

//알코올센서 측정값 화면 출력용 함수
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
// 알코올센서 랜덤 생성함수, 실제제품에는 수정 필요
// =====================================================
void runAlcoholMeasurement() {
  unsigned long startTime = millis();

  maxAlcoholValue = 0.0;

  while (millis() - startTime < 3000) {
    // 알코올 측정 중에도 심박수는 계속 전송
    updateBpmAndSend();

    float currentValue = (esp_random() % 1001) / 1000.0; //랜덤파트

    if (currentValue > maxAlcoholValue) {
      maxAlcoholValue = currentValue;
    }

    showBreathMeasuringScreen(currentValue, maxAlcoholValue);

    delay(200);
  }

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
  currentScreen = SCREEN_HOME;
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

      // 시작 시 심박수 초기 생성
      currentBpm = generateRandomBpm();

      // 지금부터 0.5초마다 전송되도록 기준 시간 설정
      lastBpmSendTime = millis();

      // 필요하면 시작 직후 1회 전송
      sendHeartRateToServer(currentBpm);

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

  // 기기가 켜져 있는 동안 0.5초마다 심박수 전송
  updateBpmAndSend();

  // GPIO16 입력: 초기화
  if (isButtonPressed(BTN_START_RESET)) {
    showResetMessage();
    delay(3000);

    deviceStarted = false;
    nextScreenIndex = 0;
    maxAlcoholValue = 0.0;
    currentScreen = SCREEN_HOME;
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