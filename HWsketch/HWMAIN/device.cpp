#include <Arduino.h>
#include <esp_system.h>
#include "config.h"
#include "types.h"
#include "sensors.h"
#include "comms.h"
#include "buttons.h"
#include "display.h"
#include "alert.h"
#include "device.h"

// 전체 상태값.
// 세부 로직은 부품별 파일에 있음.
static bool deviceStarted = false;
static float maxAlcoholValue = 0.0;
static int currentBpm = 0;
static unsigned long lastBpmSendTime = 0;

// 화면 순서: 상태 -> 알코올 -> BPM.
static int nextScreenIndex = 0;
static ScreenState currentScreen = SCREEN_HOME;
static SafetyState currentSafetyState = SAFETY_GOOD;

static void updateBpmAndSend();
static void showNextMeasurementScreen();
static void showAlcoholSensorStatus();
static void runAlcoholMeasurement();
static void resetDevice();
static void startDevice();

// 항상 돌아야 하는 작업.
// 알코올 측정 중에도 심박 유지.
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

// 알코올 상태를 OLED 문구로 변환.
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

// 심박 갱신 및 앱 전송.
static void updateBpmAndSend() {
  runBackgroundTasks();

  if (!deviceStarted) {
    return;
  }

  if (millis() - lastBpmSendTime < BPM_SEND_INTERVAL_MS) {
    return;
  }

  currentBpm = Bpm();

  PpgFeatures features = getLatestPpgFeatures();
  sendDataToApp(features, maxAlcoholValue);

  lastBpmSendTime = millis();

  if (currentScreen == SCREEN_BPM) {
    showHeartRateScreen(currentBpm);
  }
}

// 결과 화면 순환.
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

// 알코올 1회 측정.
// 측정 중에도 심박 갱신.
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
  }

  maxAlcoholValue = alcohol();
  showAlcoholSensorStatus();
  nextScreenIndex = 0;
}

// 홈 상태로 초기화.
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

// 최초 시작 흐름.
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

// 전체 초기화.
void setupDevice() {
  randomSeed(esp_random());

  initButtons();
  initBpmSensor();
  initAlcoholSensor();
  initDisplay();
  initAlert();
  initComms();

  currentScreen = SCREEN_HOME;
  showEnglishText("Drunksafe");
}

// 메인 반복 처리.
// 시작/리셋, 재측정, 화면 전환 처리.
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
