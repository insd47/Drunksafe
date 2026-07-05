#include <Arduino.h>
#include <esp_system.h>
#include "sensors.h"

namespace {
const int PPG_PIN = 36;

const unsigned long PPG_SAMPLE_INTERVAL_MS = 10;
const int PPG_SAMPLE_RATE_HZ = 100;
const int PPG_WINDOW_SECONDS = 5;
const int PPG_WINDOW_SIZE = PPG_SAMPLE_RATE_HZ * PPG_WINDOW_SECONDS;
const int PPG_START_DELAY_SAMPLES = PPG_SAMPLE_RATE_HZ * 10;
const int PPG_CALC_INTERVAL_SAMPLES = PPG_WINDOW_SIZE;

const float LOWPASS_CUTOFF_HZ = 3.5;
const float HIGHPASS_CUTOFF_HZ = 0.7;
const float PEAK_THRESHOLD = 50.0;
const int MIN_PEAK_DISTANCE_SAMPLES = 30;
const float UNSTABLE_IBI_STDEV_MS = 200.0;

float correctedBuffer[PPG_WINDOW_SIZE];
unsigned long timeBuffer[PPG_WINDOW_SIZE];
int bufferIndex = 0;
int bufferCount = 0;

unsigned long lastSampleTime = 0;
unsigned long totalSamples = 0;
int samplesSinceLastCalc = 0;

float lowpassState = 0.0;
float highpassState = 0.0;
float previousLowpassInput = 0.0;
bool filterInitialized = false;

int latestBpm = 0;
float lastValidIbiStdev = 0.0;
float lastValidPeakAmp = 0.0;
bool bpmReady = false;

float calculateLowpassAlpha(float cutoffHz) {
  const float dt = 1.0 / PPG_SAMPLE_RATE_HZ;
  const float rc = 1.0 / (2.0 * PI * cutoffHz);
  return dt / (rc + dt);
}

float calculateHighpassAlpha(float cutoffHz) {
  const float dt = 1.0 / PPG_SAMPLE_RATE_HZ;
  const float rc = 1.0 / (2.0 * PI * cutoffHz);
  return rc / (rc + dt);
}

int measurePpg() {
  int sum = 0;
  sum += analogRead(PPG_PIN);
  sum += analogRead(PPG_PIN);
  sum += analogRead(PPG_PIN);
  sum += analogRead(PPG_PIN);
  return sum >> 2;
}

float correctPpg(int rawValue) {
  const float lpAlpha = calculateLowpassAlpha(LOWPASS_CUTOFF_HZ);
  const float hpAlpha = calculateHighpassAlpha(HIGHPASS_CUTOFF_HZ);

  if (!filterInitialized) {
    lowpassState = rawValue;
    highpassState = 0.0;
    previousLowpassInput = rawValue;
    filterInitialized = true;
  }

  lowpassState = lowpassState + lpAlpha * (rawValue - lowpassState);
  highpassState = hpAlpha * (highpassState + lowpassState - previousLowpassInput);
  previousLowpassInput = lowpassState;

  return highpassState;
}

void saveCorrectedPpg(float correctedValue, unsigned long sampleTime) {
  correctedBuffer[bufferIndex] = correctedValue;
  timeBuffer[bufferIndex] = sampleTime;
  bufferIndex = (bufferIndex + 1) % PPG_WINDOW_SIZE;

  if (bufferCount < PPG_WINDOW_SIZE) {
    bufferCount++;
  }
}

int orderedIndex(int index) {
  if (bufferCount < PPG_WINDOW_SIZE) {
    return index;
  }

  return (bufferIndex + index) % PPG_WINDOW_SIZE;
}

float calculateMean(float values[], int count) {
  if (count == 0) {
    return 0.0;
  }

  float sum = 0.0;
  for (int i = 0; i < count; i++) {
    sum += values[i];
  }

  return sum / count;
}

float calculateStdev(float values[], int count, float mean) {
  if (count == 0) {
    return 0.0;
  }

  float sumSquares = 0.0;
  for (int i = 0; i < count; i++) {
    float diff = values[i] - mean;
    sumSquares += diff * diff;
  }

  return sqrt(sumSquares / count);
}

void findPpgPeaks(int peakIndexes[], int &peakCount) {
  peakCount = 0;

  for (int i = 1; i < PPG_WINDOW_SIZE - 1; i++) {
    int prevIdx = orderedIndex(i - 1);
    int currentIdx = orderedIndex(i);
    int nextIdx = orderedIndex(i + 1);

    float prevValue = correctedBuffer[prevIdx];
    float currentValue = correctedBuffer[currentIdx];
    float nextValue = correctedBuffer[nextIdx];

    if (currentValue <= PEAK_THRESHOLD) {
      continue;
    }

    if (currentValue > prevValue && currentValue >= nextValue) {
      if (peakCount > 0 && (i - peakIndexes[peakCount - 1]) < MIN_PEAK_DISTANCE_SAMPLES) {
        int lastPeakBufferIndex = orderedIndex(peakIndexes[peakCount - 1]);
        if (currentValue > correctedBuffer[lastPeakBufferIndex]) {
          peakIndexes[peakCount - 1] = i;
        }
      } else {
        peakIndexes[peakCount] = i;
        peakCount++;
      }
    }
  }
}

void calculateBpmFromPeaks(int peakIndexes[], int peakCount) {
  if (peakCount < 2) {
    return;
  }

  float ibis[PPG_WINDOW_SIZE];
  float peakAmps[PPG_WINDOW_SIZE];

  for (int i = 0; i < peakCount - 1; i++) {
    unsigned long t1 = timeBuffer[orderedIndex(peakIndexes[i])];
    unsigned long t2 = timeBuffer[orderedIndex(peakIndexes[i + 1])];
    ibis[i] = (float)(t2 - t1);
  }

  for (int i = 0; i < peakCount; i++) {
    peakAmps[i] = correctedBuffer[orderedIndex(peakIndexes[i])];
  }

  float meanIbi = calculateMean(ibis, peakCount - 1);
  if (meanIbi <= 0.0) {
    return;
  }

  float currentBpm = 60000.0 / meanIbi;
  float currentIbiStdev = calculateStdev(ibis, peakCount - 1, meanIbi);
  float currentPeakAmp = calculateMean(peakAmps, peakCount);
  bool unstable = currentIbiStdev > UNSTABLE_IBI_STDEV_MS;

  lastValidIbiStdev = currentIbiStdev;
  lastValidPeakAmp = currentPeakAmp;

  if (!unstable) {
    latestBpm = (int)(currentBpm + 0.5);
    bpmReady = true;
  }
}

void updateBpmCalculation() {
  if (bufferCount < PPG_WINDOW_SIZE) {
    return;
  }

  int peakIndexes[PPG_WINDOW_SIZE];
  int peakCount = 0;
  findPpgPeaks(peakIndexes, peakCount);
  calculateBpmFromPeaks(peakIndexes, peakCount);
}
}  // namespace

void initBpmSensor() {
  analogReadResolution(12);
}

void updateBpmSensor() {
  unsigned long now = millis();
  if (now - lastSampleTime < PPG_SAMPLE_INTERVAL_MS) {
    return;
  }

  lastSampleTime = now;

  int rawValue = measurePpg();
  float correctedValue = correctPpg(rawValue);
  saveCorrectedPpg(correctedValue, now);

  totalSamples++;
  if (totalSamples < PPG_START_DELAY_SAMPLES) {
    return;
  }

  samplesSinceLastCalc++;
  if (samplesSinceLastCalc >= PPG_CALC_INTERVAL_SAMPLES) {
    samplesSinceLastCalc = 0;
    updateBpmCalculation();
  }
}

int Bpm() {
  return bpmReady ? latestBpm : 0;
}

float alcohol() {
  return (esp_random() % 1001) / 1000.0;  // 0.000~1.000%
}

SafetyState judgeSafetyState(float maxAlcoholValue, int currentBpm) {
  (void)maxAlcoholValue;
  (void)currentBpm;

  int randomValue = esp_random() % 3;

  if (randomValue == 0) {
    return SAFETY_GOOD;
  }

  if (randomValue == 1) {
    return SAFETY_CAUTION;
  }

  return SAFETY_DANGER;
}
