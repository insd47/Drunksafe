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
static void runAlcoholMeasurement();
static void resetDevice();
static void startDevice();

static void updateBpmAndSend() {
  updateBpmSensor();

  if (!deviceStarted) {
    return;
  }

  if (millis() - lastBpmSendTime < BPM_SEND_INTERVAL_MS) {
    return;
  }

  currentBpm = Bpm();
  sendHeartRateToServer(currentBpm);
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

  unsigned long startTime = millis();
  maxAlcoholValue = 0.0;

  while (millis() - startTime < ALCOHOL_MEASURE_DURATION_MS) {
    updateBpmAndSend();

    float currentValue = alcohol();

    if (currentValue > maxAlcoholValue) {
      maxAlcoholValue = currentValue;
    }

    showBreathMeasuringScreen(currentValue, maxAlcoholValue);
    delay(ALCOHOL_SCREEN_REFRESH_MS);
  }

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

  sendHeartRateToServer(currentBpm);

  nextScreenIndex = 0;
  runAlcoholMeasurement();
  showNextMeasurementScreen();
}

void setupDevice() {
  randomSeed(esp_random());

  initButtons();
  initBpmSensor();
  initDisplay();

  currentScreen = SCREEN_HOME;
  showEnglishText("Drunksafe");
}

void loopDevice() {
  updateBpmSensor();

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
