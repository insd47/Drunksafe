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
// 전체 장치 상태값
// =====================================================
// deviceStarted가 false이면 홈 화면에서 시작 버튼을 기다리는 상태입니다.
static bool deviceStarted = false;

// 최근 알코올 측정 결과입니다. 변수명은 기존 흐름 호환을 위해 maxAlcoholValue를 유지합니다.
static float maxAlcoholValue = 0.0;

// OLED 표시용 최신 BPM 값입니다. 아직 안정 계산 전이면 0일 수 있습니다.
static int currentBpm = 0;

// BLE 특징값 전송 간격을 맞추기 위한 마지막 전송 시각입니다.
static unsigned long lastBpmSendTime = 0;

// BTN_NEXT로 보여줄 화면 순서입니다.
// 0: 판별 상태, 1: 알코올 수치, 2: BPM
static int nextScreenIndex = 0;

// 현재 OLED에 표시 중인 화면 종류입니다.
static ScreenState currentScreen = SCREEN_HOME;

// 마지막으로 계산한 안전 판별 상태입니다.
static SafetyState currentSafetyState = SAFETY_GOOD;

static void updateBpmAndSend();
static void showNextMeasurementScreen();
static void showAlcoholSensorStatus();
static void runAlcoholMeasurement();
static void resetDevice();
static void startDevice();

// =====================================================
// 진동/부저 알림 패턴 상태
// =====================================================
// patternState:
// 0 = 대기, 1 = 첫 ON 구간, 2 = 중간 OFF 구간, 3 = 두 번째 ON 구간
static int patternState = 0;
static unsigned long patternTimer = 0;

// 부저 출력 상태를 제어합니다.
// 현재 회로 기준으로 type 2가 ON, type 1이 OFF 역할입니다.
static void beep(int type) {
    switch (type) {
        case 1: digitalWrite(SPEAKER_PIN, HIGH); break;
        case 2: digitalWrite(SPEAKER_PIN, LOW); break;
        default: digitalWrite(SPEAKER_PIN, HIGH); break;
    }
}

// 진동모터 출력 상태를 제어합니다.
// 현재 회로 기준으로 type 2가 ON, type 1이 OFF 역할입니다.
static void vibe(int type) {
    switch (type) {
        case 1: digitalWrite(VIBRATION_PIN, LOW); break;
        case 2: digitalWrite(VIBRATION_PIN, HIGH); break;
        default: digitalWrite(VIBRATION_PIN, LOW); break;
    }
}

// delay() 없이 millis()로 짧은 알림 패턴을 진행합니다.
// 이 함수가 non-blocking이라 심박 샘플링과 알코올 센서 polling을 막지 않습니다.
static void updateAlertPattern() {
    switch (patternState) {
      case 1:
        if (millis() - patternTimer >= 100) {
          patternState = 2;
          patternTimer = millis();
          beep(1); vibe(1);
        }
        break;

      case 2:
        if (millis() - patternTimer >= 50) {
          patternState = 3;
          patternTimer = millis();
          beep(2); vibe(2);
        }
        break;

      case 3:
        if (millis() - patternTimer >= 100) {
          patternState = 0;
          beep(1); vibe(1);
        }
        break;
    }
}

// 다른 알림이 진행 중이 아닐 때만 새 알림 패턴을 시작합니다.
static void triggerAlert() {
    if (patternState == 0) {
        patternState = 1;
        patternTimer = millis();
        beep(2); vibe(2);
    }
}

void runBackgroundTasks() {
    // 측정/대기 중에도 심박과 알코올 센서 상태는 계속 갱신되어야 합니다.
    updateBpmSensor();
    updateAlcoholSensor();
    updateAlertPattern();

    // 장치가 시작된 뒤에는 raw PPG 샘플을 앱 전송용 버퍼에서 일정 개수씩 꺼냅니다.
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

// ZE-29A 상태값을 사용자가 이해할 수 있는 OLED 안내 문구로 바꿉니다.
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

// 심박 계산, BLE 특징값 전송, BPM 화면 갱신을 한 번에 처리합니다.
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

  // 사용자가 BPM 화면을 보고 있을 때만 OLED 숫자를 바로 갱신합니다.
  if (currentScreen == SCREEN_BPM) {
    showHeartRateScreen(currentBpm);
  }
}

// BTN_NEXT로 순환하는 결과 화면을 표시합니다.
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

// ZE-29A 알코올 측정을 시작하고 끝날 때까지 상태 화면을 갱신합니다.
// 내부 루프에서 updateBpmAndSend()를 계속 호출하므로 측정 중에도 심박 알고리즘이 멈추지 않습니다.
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

// 장치를 홈 상태로 되돌립니다.
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

// 시작 버튼을 눌렀을 때 최초 측정 흐름을 시작합니다.
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

  pinMode(SPEAKER_PIN, OUTPUT);
  pinMode(VIBRATION_PIN, OUTPUT);
  beep(1); vibe(1);

  initComms();

  currentScreen = SCREEN_HOME;
  showEnglishText("Drunksafe");
}

void loopDevice() {
  // 시작 전에도 심박 샘플링과 알림 패턴은 가볍게 갱신합니다.
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
