#include <Arduino.h>
#include <esp_system.h>
#include "config.h"
#include "types.h"
#include "sensors.h"
#include "comms.h"
#include "buttons.h"
#include "display.h"
#include "device.h"

// =====================================================
// 프로그램 상태
// =====================================================
static bool deviceStarted = false;
static float maxAlcoholValue = 0.0;
static int currentBpm = 0;
static unsigned long lastBpmSendTime = 0;

// 버튼으로 넘기는 측정 화면 순서:
// 상태 판정 -> 알코올 최고값 -> 심박수 -> 상태 판정 ...
static int nextScreenIndex = 0;
static ScreenState currentScreen = SCREEN_HOME;
static SafetyState currentSafetyState = SAFETY_GOOD;

static void updateBpmAndSend();
static void showNextMeasurementScreen();
static void showAlcoholSensorStatus();
static void runAlcoholMeasurement();
static void resetDevice();
static void startDevice();

// 진동 및 부저 알림 관련 변수 및 함수
static int patternState = 0; 
static unsigned long patternTimer = 0;

static void beep(int type) {
    switch (type) {
        case 1: digitalWrite(SPEAKER_PIN, HIGH); break;
        case 2: digitalWrite(SPEAKER_PIN, LOW); break;
        default: digitalWrite(SPEAKER_PIN, HIGH); break;
    }
}

static void vibe(int type) {
    switch (type) {
        case 1: digitalWrite(VIBRATION_PIN, LOW); break;
        case 2: digitalWrite(VIBRATION_PIN, HIGH); break;
        default: digitalWrite(VIBRATION_PIN, LOW); break;
    }
}

static void updateAlertPattern() {
    switch (patternState) {
      case 1: // 첫 번째 ON (100ms 대기)
        if (millis() - patternTimer >= 100) {
          patternState = 2;        
          patternTimer = millis(); 
          beep(1); vibe(1); // OFF
        }
        break;
      case 2: // 중간 OFF (50ms 대기)
        if (millis() - patternTimer >= 50) {
          patternState = 3;        
          patternTimer = millis();
          beep(2); vibe(2);        
        }
        break;
      case 3: // 두 번째 ON 종료
        if (millis() - patternTimer >= 100) {
          patternState = 0;        
          beep(1); vibe(1); // 완전 OFF
        }
        break;
    }
}

static void triggerAlert() {
    if (patternState == 0) {
        patternState = 1;        
        patternTimer = millis(); 
        beep(2); vibe(2); // ON
    }
}

void runBackgroundTasks() {
    updateBpmSensor();
    updateAlcoholSensor();
    updateAlertPattern();

    if (deviceStarted) {
        if (getRawDataAvailable() >= 40) {
            unsigned long start_t;
            int batch[40];
            int popped = popRawDataBatch(start_t, batch, 40);
            if (popped > 0) {
                sendRawDataToApp(start_t, batch, popped);
            }
        }
    }
}

static void showAlcoholSensorStatus() {
  switch (getAlcoholSensorStatus()) {
    case ALCOHOL_SENSOR_WARMING:
      showKorean2Lines("ZE-29A", "Warming...");
      break;
    case ALCOHOL_SENSOR_READY_TO_BLOW:
      showKorean2Lines("Blow", "4 sec long");
      break;
    case ALCOHOL_SENSOR_BLOWING:
      showKorean2Lines("Keep", "Blowing");
      break;
    case ALCOHOL_SENSOR_BLOW_WEAK:
      showKorean2Lines("Too weak", "Try again");
      break;
    case ALCOHOL_SENSOR_ANALYZING:
      showKorean2Lines("Alcohol", "Analyzing");
      break;
    case ALCOHOL_SENSOR_DONE: {
      char valueText[20];
      snprintf(valueText, sizeof(valueText), "%.3f%%", alcohol());
      showKorean2Lines("Complete", valueText);
      break;
    }
    case ALCOHOL_SENSOR_TIMEOUT:
      showKorean2Lines("Alcohol", "Timeout");
      break;
    case ALCOHOL_SENSOR_ERROR:
      showKorean2Lines("Sensor", "Error");
      break;
    default:
      showKorean2Lines("Alcohol", "Ready");
      break;
  }
}

static void updateBpmAndSend() {
  runBackgroundTasks();

  if (!deviceStarted) {
    return;
  }

  // runBackgroundTasks()에서 처리하므로 삭제
  // if (getRawDataAvailable() >= 40) { ... }

  if (millis() - lastBpmSendTime < BPM_SEND_INTERVAL_MS) {
    return;
  }

  currentBpm = Bpm();
  
  // 변경점: 기존 sendHeartRateToServer() 대신 최신 특징값과 함께 JSON 형태로 앱에 전송
  PpgFeatures features = getLatestPpgFeatures();
  sendDataToApp(features, maxAlcoholValue);

  lastBpmSendTime = millis();

  // 심박수 화면을 보고 있을 때만 OLED 값을 즉시 갱신한다.
  if (currentScreen == SCREEN_BPM) {
    showHeartRateScreen(currentBpm);
  }
}

static void showNextMeasurementScreen() {
  switch (nextScreenIndex) {
    case 0:
      currentScreen = SCREEN_STATE;
      currentSafetyState = judgeSafetyState(maxAlcoholValue, currentBpm);
      showStateScreen(currentSafetyState);
      nextScreenIndex = 1;
      break;

    case 1:
      currentScreen = SCREEN_ALCOHOL;
      showAlcoholValueScreen(maxAlcoholValue);
      nextScreenIndex = 2;
      break;

    default:
      currentScreen = SCREEN_BPM;

      if (currentBpm == 0) {
        currentBpm = Bpm();
      }

      showHeartRateScreen(currentBpm);
      nextScreenIndex = 0;
      break;
  }
}

static void runAlcoholMeasurement() {
  currentScreen = SCREEN_BREATH;
  maxAlcoholValue = 0.0;
  startAlcoholMeasurement();

  unsigned long lastScreenUpdateTime = 0;

  while (!isAlcoholMeasurementFinished()) {
    updateBpmAndSend();

    unsigned long now = millis();
    if (now - lastScreenUpdateTime >= ALCOHOL_SCREEN_REFRESH_MS) {
      lastScreenUpdateTime = now;
      showAlcoholSensorStatus();
    }

    delay(1);
  }

  maxAlcoholValue = alcohol();
  showAlcoholSensorStatus();
  delay(ALCOHOL_SCREEN_REFRESH_MS);
  nextScreenIndex = 0;
}

static void resetDevice() {
  currentScreen = SCREEN_RESET;
  showResetMessageScreen();
  delay(RESET_MESSAGE_DURATION_MS);

  deviceStarted = false;
  nextScreenIndex = 0;
  maxAlcoholValue = 0.0;
  currentBpm = 0;
  currentSafetyState = SAFETY_GOOD;
  currentScreen = SCREEN_HOME;

  showEnglishText("Drunksafe");
}

static void startDevice() {
  deviceStarted = true;
  currentBpm = Bpm();
  lastBpmSendTime = millis();

  PpgFeatures features = getLatestPpgFeatures();
  sendDataToApp(features, maxAlcoholValue);

  nextScreenIndex = 0;
  runAlcoholMeasurement();
  showNextMeasurementScreen();
}

void setupDevice() {
  randomSeed(esp_random());

  initButtons();
  initBpmSensor();
  initAlcoholSensor();
  initDisplay();
  
  // 알림(진동/부저) 핀 초기화
  pinMode(SPEAKER_PIN, OUTPUT);
  pinMode(VIBRATION_PIN, OUTPUT);
  beep(1); vibe(1); // 초기 상태 (OFF)
  
  // 통신 모듈(BLE) 초기화
  initComms();

  currentScreen = SCREEN_HOME;
  showEnglishText("Drunksafe");
}

void loopDevice() {
  updateBpmSensor();
  updateAlertPattern();

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
