#include <Arduino.h>
#include <math.h>

// SZH-HWS001 wiring for ESP32 DevKitC V4:
// VCC -> 3V3, GND -> GND, SIGNAL -> VP / GPIO36.
const int PULSE_PIN = 36;
const int STATUS_LED = 2;

// Sample the analog PPG signal every 10 ms (100 Hz).
const uint32_t SAMPLE_INTERVAL_US = 10000;
const uint32_t QUALITY_WINDOW_MS = 1500;
const uint32_t MEASUREMENT_TIME_MS = 12000;

const int MIN_SIGNAL_RANGE = 20;
const int MIN_BPM = 40;
const int MAX_BPM = 180;
const float MAX_BPM_STDDEV = 20.0;

// Keep false for readable status/BPM messages in Serial Monitor.
// Set true only when inspecting raw and filtered signals in Serial Plotter.
const bool OUTPUT_RAW_SIGNAL = false;

enum MeasureState {
  WAITING_FOR_FINGER,
  MEASURING,
  WAITING_FOR_REMOVE
};

MeasureState state = WAITING_FOR_FINGER;

uint32_t nextSampleTimeUs = 0;
uint32_t qualityWindowStartedMs = 0;
uint32_t measurementStartedMs = 0;
uint32_t lastMessageMs = 0;

float dcBaseline = 0.0;
float filteredSignal = 0.0;
float previousSignal1 = 0.0;
float previousSignal2 = 0.0;
float signalEnvelope = 0.0;

int signalMinimum = 4095;
int signalMaximum = 0;
int clippedSamples = 0;
int qualitySamples = 0;
int bestSignalRange = 0;

uint32_t lastBeatTimeMs = 0;
float bpmValues[32];
int bpmCount = 0;

void setLed(bool on) {
  digitalWrite(STATUS_LED, on ? HIGH : LOW);
}

void resetQualityWindow() {
  signalMinimum = 4095;
  signalMaximum = 0;
  clippedSamples = 0;
  qualitySamples = 0;
  qualityWindowStartedMs = millis();
}

void resetMeasurement() {
  measurementStartedMs = millis();
  lastBeatTimeMs = 0;
  bpmCount = 0;
  bestSignalRange = 0;

  for (int i = 0; i < 32; i++) {
    bpmValues[i] = 0;
  }
}

void startMeasurement() {
  resetMeasurement();

  state = MEASURING;
  setLed(true);

  Serial.println();
  Serial.println("착용 상태가 확인되었습니다.");
  Serial.println("심박 측정을 시작합니다.");
  Serial.println("손가락을 움직이지 마세요.");

  resetQualityWindow();
}

void failMeasurement() {
  state = WAITING_FOR_REMOVE;
  setLed(false);

  Serial.println();
  Serial.println("측정 실패");
  Serial.println("센서 착용 상태가 좋지 않거나 신호가 불안정합니다.");
  Serial.println("손가락을 센서에서 뗀 뒤 다시 정확히 올려주세요.");
  Serial.println("측정 중에는 움직이지 마세요.");
}

float calculateMeanBpm() {
  if (bpmCount == 0) {
    return 0.0;
  }

  float sum = 0.0;

  for (int i = 0; i < bpmCount; i++) {
    sum += bpmValues[i];
  }

  return sum / bpmCount;
}

float calculateBpmStdDev(float mean) {
  if (bpmCount < 2) {
    return 999.0;
  }

  float sum = 0.0;

  for (int i = 0; i < bpmCount; i++) {
    float difference = bpmValues[i] - mean;
    sum += difference * difference;
  }

  return sqrtf(sum / bpmCount);
}

void addBpm(float bpm) {
  if (bpmCount < 32) {
    bpmValues[bpmCount] = bpm;
    bpmCount++;
    return;
  }

  for (int i = 0; i < 31; i++) {
    bpmValues[i] = bpmValues[i + 1];
  }

  bpmValues[31] = bpm;
}

void finishMeasurement() {
  float meanBpm = calculateMeanBpm();
  float stddev = calculateBpmStdDev(meanBpm);

  bool valid =
    bpmCount >= 5 &&
    meanBpm >= MIN_BPM &&
    meanBpm <= MAX_BPM &&
    bestSignalRange >= MIN_SIGNAL_RANGE &&
    stddev <= MAX_BPM_STDDEV;

  if (!valid) {
    failMeasurement();
    return;
  }

  state = WAITING_FOR_REMOVE;
  setLed(false);

  Serial.println();
  Serial.println("정상적으로 측정되었습니다.");
  Serial.print("심박수: ");
  Serial.print(meanBpm, 1);
  Serial.println(" BPM");

  Serial.print("감지된 심박 수: ");
  Serial.println(bpmCount);

  Serial.print("신호 품질: ");
  Serial.println(bestSignalRange);

  Serial.println("다음 측정을 하려면 손가락을 센서에서 떼세요.");
}

void checkSignalQuality(uint16_t rawValue, uint32_t nowMs) {
  if (rawValue < signalMinimum) {
    signalMinimum = rawValue;
  }

  if (rawValue > signalMaximum) {
    signalMaximum = rawValue;
  }

  if (rawValue <= 3 || rawValue >= 4092) {
    clippedSamples++;
  }

  qualitySamples++;

  int currentRange = signalMaximum - signalMinimum;

  if (currentRange > bestSignalRange) {
    bestSignalRange = currentRange;
  }

  if (nowMs - qualityWindowStartedMs < QUALITY_WINDOW_MS) {
    return;
  }

  bool enoughSignal =
    currentRange >= MIN_SIGNAL_RANGE &&
    qualitySamples > 0 &&
    clippedSamples <= qualitySamples / 20;

  if (state == WAITING_FOR_FINGER) {
    if (enoughSignal) {
      startMeasurement();
      return;
    }
  } else if (state == MEASURING) {
    if (!enoughSignal) {
      failMeasurement();
      resetQualityWindow();
      return;
    }
  } else if (state == WAITING_FOR_REMOVE) {
    if (!enoughSignal) {
      state = WAITING_FOR_FINGER;
      lastMessageMs = 0;

      Serial.println();
      Serial.println("센서가 초기화되었습니다.");
      Serial.println("손가락을 센서에 올려주세요.");
    }
  }

  resetQualityWindow();
}

void detectBeat(float currentSignal, uint32_t nowMs) {
  float absoluteSignal = fabsf(currentSignal);

  signalEnvelope =
    signalEnvelope * 0.995f +
    absoluteSignal * 0.005f;

  float beatThreshold = signalEnvelope * 1.15f;

  if (beatThreshold < 6.0f) {
    beatThreshold = 6.0f;
  }

  bool localPeak =
    previousSignal1 > previousSignal2 &&
    previousSignal1 >= currentSignal &&
    previousSignal1 > beatThreshold;

  if (localPeak && state == MEASURING) {
    uint32_t peakTimeMs = nowMs - 10;

    if (lastBeatTimeMs == 0) {
      lastBeatTimeMs = peakTimeMs;
    } else {
      uint32_t intervalMs = peakTimeMs - lastBeatTimeMs;

      if (intervalMs >= 300) {
        lastBeatTimeMs = peakTimeMs;

        float bpm = 60000.0f / intervalMs;

        if (bpm >= MIN_BPM && bpm <= MAX_BPM) {
          addBpm(bpm);

          Serial.print("현재 BPM: ");
          Serial.println(bpm, 1);
        }
      }
    }
  }

  previousSignal2 = previousSignal1;
  previousSignal1 = currentSignal;
}

void processSample(uint32_t nowMs) {
  uint16_t rawValue = analogRead(PULSE_PIN);

  if (dcBaseline == 0.0) {
    dcBaseline = rawValue;
  }

  dcBaseline += (rawValue - dcBaseline) * 0.01f;

  float acSignal = rawValue - dcBaseline;

  filteredSignal =
    filteredSignal * 0.80f +
    acSignal * 0.20f;

  checkSignalQuality(rawValue, nowMs);
  detectBeat(filteredSignal, nowMs);

  if (OUTPUT_RAW_SIGNAL) {
    Serial.print("raw:");
    Serial.print(rawValue);
    Serial.print("\tfiltered:");
    Serial.println(filteredSignal);
  }

  if (
    state == MEASURING &&
    nowMs - measurementStartedMs >= MEASUREMENT_TIME_MS
  ) {
    finishMeasurement();
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(STATUS_LED, OUTPUT);
  setLed(false);

  analogReadResolution(12);
  analogSetPinAttenuation(PULSE_PIN, ADC_11db);

  resetQualityWindow();
  nextSampleTimeUs = micros();

  Serial.println("DrunkSafe 심박 센서 준비 완료");
  Serial.println("센서에 손가락을 올려주세요.");
}

void loop() {
  uint32_t nowUs = micros();

  if ((int32_t)(nowUs - nextSampleTimeUs) >= 0) {
    nextSampleTimeUs += SAMPLE_INTERVAL_US;

    if ((int32_t)(nowUs - nextSampleTimeUs) > 100000) {
      nextSampleTimeUs = nowUs + SAMPLE_INTERVAL_US;
    }

    processSample(millis());
  }

  if (
    state == WAITING_FOR_FINGER &&
    millis() - lastMessageMs >= 3000
  ) {
    Serial.println("센서에 손가락을 올려주세요.");
    lastMessageMs = millis();
  }
}
