#include <Arduino.h>
#include <math.h>
#include <string.h>

// DrunkSafe continuous heart-rate monitor for:
// ESP32 DevKitC V4 + SZH-HWS001 analog pulse sensor
// Wiring: VCC -> 3V3, GND -> GND, SIGNAL -> VP / GPIO36.

const int PULSE_PIN = 36;
const int STATUS_LED = 2;

// Sampling and schedule.
const uint32_t SAMPLE_INTERVAL_US = 10000;       // 10 ms, 100 Hz
const uint32_t SLOT_INTERVAL_MS = 60000;         // fixed one-minute schedule
const uint32_t MEASUREMENT_TIME_MS = 20000;      // 20-second measurement
const uint32_t FILTER_SETTLE_MS = 2000;
const uint32_t START_MARGIN_MS = 250;
const uint32_t QUALITY_WINDOW_MS = 1500;
const uint32_t REWEAR_MESSAGE_INTERVAL_MS = 10000;

// Signal and BPM validation. Adjust only after observing real sensor data.
const int MIN_RAW_RANGE = 20;
const int MAX_RAW_RANGE = 1800;
const float MIN_FILTERED_RANGE = 8.0f;
const float MAX_FILTERED_RANGE = 1200.0f;
const uint8_t MAX_BAD_QUALITY_WINDOWS = 2;
const uint32_t MIN_IBI_MS = 333;                 // 180 BPM
const uint32_t MAX_IBI_MS = 1500;                // 40 BPM
const uint8_t MIN_VALID_INTERVALS = 8;
const float MAX_IBI_CV = 0.20f;
const float IBI_OUTLIER_FRACTION = 0.20f;
const float IBI_OUTLIER_MIN_MS = 100.0f;

// Alert policy: baseline +10%, then +15%, +20%, ...
const uint8_t FIRST_INCREASE_ALERT_PERCENT = 10;
const uint8_t INCREASE_ALERT_STEP_PERCENT = 5;
const uint8_t DECLINE_FROM_PEAK_PERCENT = 5;

// Keep false for readable messages in Serial Monitor.
// Set true only for raw signal inspection in Serial Plotter.
const bool OUTPUT_RAW_SIGNAL = false;

enum RunState {
  WAITING_FOR_FIRST_CONTACT,
  IDLE_UNTIL_SLOT,
  MEASURING,
  WAITING_FOR_REWEAR,
  SESSION_STOPPED
};

struct MeasurementResult {
  bool valid;
  float bpm;
  float ibiMeanMs;
  float ibiStddevMs;
  uint8_t acceptedIntervals;
};

RunState runState = WAITING_FOR_FIRST_CONTACT;

// 32-bit millisecond arithmetic is safe across millis() wrap when comparisons
// use signed differences. Five hours is far below the wrap interval.
uint32_t nextSampleTimeUs = 0;
uint32_t sessionStartMs = 0;
uint32_t slotIndex = 0;
bool slotOpen = false;
uint32_t measurementStartMs = 0;
uint32_t lastRewearMessageMs = 0;

// Contact quality, evaluated continuously.
bool contactGood = false;
bool contactQualityKnown = false;
uint8_t badQualityWindows = 0;
uint32_t qualityWindowStartMs = 0;
uint16_t rawMinimum = 4095;
uint16_t rawMaximum = 0;
float filteredMinimum = 1000000.0f;
float filteredMaximum = -1000000.0f;
uint16_t clippedSamples = 0;
uint16_t qualitySamples = 0;

// 4th-order direct-form II transposed Butterworth band-pass filter.
// scipy.signal.butter(2, [0.7, 3.5], btype="band", fs=100.0)
const float FILTER_B[5] = {
  0.006867866f, 0.0f, -0.013735732f, 0.0f, 0.006867866f
};
const float FILTER_A[5] = {
  1.0f, -3.7340894f, 5.2501354f, -3.2957025f, 0.77973944f
};
float filterState[4] = {0.0f, 0.0f, 0.0f, 0.0f};

// Beat detector and interval collection.
float previousFiltered2 = 0.0f;
float previousFiltered1 = 0.0f;
float signalEnvelope = 0.0f;
uint32_t lastPeakMs = 0;
const uint8_t MAX_INTERVALS = 96;
uint32_t ibiValues[MAX_INTERVALS];
uint8_t ibiCount = 0;

// Session baseline and alerts.
bool baselineReady = false;
bool baselineFirstSampleReady = false;
float baselineFirstBpm = 0.0f;
float baselineBpm = 0.0f;
float peakBpm = 0.0f;
uint16_t nextIncreaseAlertPercent = FIRST_INCREASE_ALERT_PERCENT;
bool declineAlertSent = false;
bool previousTrendSampleReady = false;
uint32_t previousTrendSlot = 0;
float previousTrendBpm = 0.0f;

// Non-blocking Serial commands: START, STOP, STATUS.
char commandBuffer[16];
uint8_t commandLength = 0;

bool timeReached(uint32_t nowMs, uint32_t targetMs) {
  return (int32_t)(nowMs - targetMs) >= 0;
}

uint32_t currentSlotDueMs() {
  return sessionStartMs + slotIndex * SLOT_INTERVAL_MS;
}

uint32_t currentSlotDeadlineMs() {
  return currentSlotDueMs() + SLOT_INTERVAL_MS;
}

bool enoughTimeForMeasurement(uint32_t nowMs) {
  uint32_t deadlineMs = currentSlotDeadlineMs();

  if (timeReached(nowMs, deadlineMs)) {
    return false;
  }

  return (deadlineMs - nowMs) >=
    (MEASUREMENT_TIME_MS + START_MARGIN_MS);
}

void setLed(bool on) {
  digitalWrite(STATUS_LED, on ? HIGH : LOW);
}

const char *stateName() {
  switch (runState) {
    case WAITING_FOR_FIRST_CONTACT: return "WAITING_FIRST_CONTACT";
    case IDLE_UNTIL_SLOT: return "IDLE";
    case MEASURING: return "MEASURING";
    case WAITING_FOR_REWEAR: return "WAITING_REWEAR";
    case SESSION_STOPPED: return "STOPPED";
  }

  return "UNKNOWN";
}

void resetQualityWindow(uint32_t nowMs) {
  qualityWindowStartMs = nowMs;
  rawMinimum = 4095;
  rawMaximum = 0;
  filteredMinimum = 1000000.0f;
  filteredMaximum = -1000000.0f;
  clippedSamples = 0;
  qualitySamples = 0;
}

void resetFilter() {
  for (uint8_t i = 0; i < 4; i++) {
    filterState[i] = 0.0f;
  }

  previousFiltered2 = 0.0f;
  previousFiltered1 = 0.0f;
  signalEnvelope = 0.0f;
}

float filterSample(float sample) {
  float output = FILTER_B[0] * sample + filterState[0];

  filterState[0] = FILTER_B[1] * sample - FILTER_A[1] * output + filterState[1];
  filterState[1] = FILTER_B[2] * sample - FILTER_A[2] * output + filterState[2];
  filterState[2] = FILTER_B[3] * sample - FILTER_A[3] * output + filterState[3];
  filterState[3] = FILTER_B[4] * sample - FILTER_A[4] * output;

  return output;
}

uint16_t readAveragedSample() {
  uint32_t sum = 0;

  for (uint8_t i = 0; i < 4; i++) {
    sum += analogRead(PULSE_PIN);
  }

  return (uint16_t)(sum / 4);
}

void resetBeatCollection() {
  ibiCount = 0;
  lastPeakMs = 0;
  resetFilter();
}

void appendIbi(uint32_t intervalMs) {
  if (ibiCount < MAX_INTERVALS) {
    ibiValues[ibiCount++] = intervalMs;
  }
}

void sortFloatValues(float *values, uint8_t count) {
  for (uint8_t i = 1; i < count; i++) {
    float value = values[i];
    int8_t position = (int8_t)i - 1;

    while (position >= 0 && values[position] > value) {
      values[position + 1] = values[position];
      position--;
    }

    values[position + 1] = value;
  }
}

MeasurementResult analyzeIntervals() {
  MeasurementResult result = {false, 0.0f, 0.0f, 0.0f, 0};

  if (ibiCount < MIN_VALID_INTERVALS) {
    return result;
  }

  float sorted[MAX_INTERVALS];

  for (uint8_t i = 0; i < ibiCount; i++) {
    sorted[i] = (float)ibiValues[i];
  }

  sortFloatValues(sorted, ibiCount);

  float median;
  if ((ibiCount & 1U) == 0U) {
    median = (sorted[ibiCount / 2 - 1] + sorted[ibiCount / 2]) * 0.5f;
  } else {
    median = sorted[ibiCount / 2];
  }

  float tolerance = median * IBI_OUTLIER_FRACTION;
  if (tolerance < IBI_OUTLIER_MIN_MS) {
    tolerance = IBI_OUTLIER_MIN_MS;
  }

  float sum = 0.0f;
  uint8_t accepted = 0;

  for (uint8_t i = 0; i < ibiCount; i++) {
    if (fabsf((float)ibiValues[i] - median) <= tolerance) {
      sum += ibiValues[i];
      accepted++;
    }
  }

  uint8_t minimumAccepted = (uint8_t)ceilf(ibiCount * 0.60f);
  if (minimumAccepted < MIN_VALID_INTERVALS) {
    minimumAccepted = MIN_VALID_INTERVALS;
  }

  if (accepted < minimumAccepted) {
    return result;
  }

  float mean = sum / accepted;
  float varianceSum = 0.0f;

  for (uint8_t i = 0; i < ibiCount; i++) {
    if (fabsf((float)ibiValues[i] - median) <= tolerance) {
      float difference = ibiValues[i] - mean;
      varianceSum += difference * difference;
    }
  }

  float stddev = sqrtf(varianceSum / accepted);
  float coefficientOfVariation = stddev / mean;

  if (coefficientOfVariation > MAX_IBI_CV) {
    return result;
  }

  result.valid = true;
  result.bpm = 60000.0f / mean;
  result.ibiMeanMs = mean;
  result.ibiStddevMs = stddev;
  result.acceptedIntervals = accepted;
  return result;
}

void printRewearMessage(uint32_t nowMs) {
  if (
    lastRewearMessageMs == 0 ||
    nowMs - lastRewearMessageMs >= REWEAR_MESSAGE_INTERVAL_MS
  ) {
    Serial.println("ALERT,REWEAR,센서 착용 상태를 확인하고 다시 밀착해 주세요.");
    lastRewearMessageMs = nowMs;
  }
}

void emitMissedSlot(const char *reason, uint32_t nowMs) {
  Serial.print("DATA,slot=");
  Serial.print(slotIndex);
  Serial.print(",scheduled_ms=");
  Serial.print(currentSlotDueMs() - sessionStartMs);
  Serial.print(",measured_ms=");
  Serial.print(nowMs - sessionStartMs);
  Serial.print(",bpm=,status=MISSED,reason=");
  Serial.println(reason);
}

void closeCurrentSlot() {
  slotOpen = false;
  slotIndex++;

  if (runState != SESSION_STOPPED) {
    runState = IDLE_UNTIL_SLOT;
  }

  setLed(false);
}

void resetConsecutiveTrendSample() {
  previousTrendSampleReady = false;
  previousTrendSlot = 0;
  previousTrendBpm = 0.0f;
}

void rememberTrendSample(float bpm, uint32_t resultSlotIndex) {
  previousTrendSampleReady = true;
  previousTrendSlot = resultSlotIndex;
  previousTrendBpm = bpm;
}

void markCurrentSlotMissed(const char *reason, uint32_t nowMs) {
  if (!slotOpen) {
    return;
  }

  emitMissedSlot(reason, nowMs);
  // A missing scheduled slot breaks the two-consecutive-slot confirmation.
  resetConsecutiveTrendSample();
  closeCurrentSlot();
}

void processBpmAlerts(float bpm, uint32_t resultSlotIndex) {
  if (!baselineReady) {
    if (!baselineFirstSampleReady) {
      baselineFirstSampleReady = true;
      baselineFirstBpm = bpm;

      Serial.print("BASELINE_PENDING,sample=1_of_2,bpm=");
      Serial.println(baselineFirstBpm, 1);
      return;
    }

    baselineReady = true;
    baselineBpm = (baselineFirstBpm + bpm) * 0.5f;
    peakBpm = baselineBpm;
    nextIncreaseAlertPercent = FIRST_INCREASE_ALERT_PERCENT;
    declineAlertSent = false;
    resetConsecutiveTrendSample();

    Serial.print("BASELINE,sample_count=2,first_bpm=");
    Serial.print(baselineFirstBpm, 1);
    Serial.print(",second_bpm=");
    Serial.print(bpm, 1);
    Serial.print(",bpm=");
    Serial.println(baselineBpm, 1);
    return;
  }

  bool consecutiveSlot =
    previousTrendSampleReady &&
    resultSlotIndex == previousTrendSlot + 1U;

  if (consecutiveSlot) {
    // The lower of the pair must exceed an increase threshold. Therefore both
    // adjacent one-minute results have crossed that threshold.
    float confirmedHighBpm = fminf(previousTrendBpm, bpm);
    float confirmedIncreasePercent =
      ((confirmedHighBpm - baselineBpm) / baselineBpm) * 100.0f;

    while (confirmedIncreasePercent >= nextIncreaseAlertPercent) {
      Serial.print("ALERT,BPM_INCREASE,level_percent=");
      Serial.print(nextIncreaseAlertPercent);
      Serial.print(",baseline_bpm=");
      Serial.print(baselineBpm, 1);
      Serial.print(",previous_bpm=");
      Serial.print(previousTrendBpm, 1);
      Serial.print(",current_bpm=");
      Serial.print(bpm, 1);
      Serial.println(",confirmation=2_CONSECUTIVE_SLOTS");

      nextIncreaseAlertPercent += INCREASE_ALERT_STEP_PERCENT;
    }

    // A one-slot spike is not accepted as the peak either.
    if (confirmedHighBpm > peakBpm) {
      peakBpm = confirmedHighBpm;
    }

    float minimumPeakForDecline =
      baselineBpm * (1.0f + FIRST_INCREASE_ALERT_PERCENT / 100.0f);
    float declineThreshold =
      peakBpm * (1.0f - DECLINE_FROM_PEAK_PERCENT / 100.0f);
    // The higher of the pair must be below the decline threshold, so both
    // adjacent results confirm the fall from the peak.
    float confirmedLowBpm = fmaxf(previousTrendBpm, bpm);

    if (
      !declineAlertSent &&
      peakBpm >= minimumPeakForDecline &&
      confirmedLowBpm <= declineThreshold
    ) {
      declineAlertSent = true;

      Serial.print("ALERT,BPM_DECLINE_FROM_PEAK,drop_percent=");
      Serial.print(DECLINE_FROM_PEAK_PERCENT);
      Serial.print(",peak_bpm=");
      Serial.print(peakBpm, 1);
      Serial.print(",previous_bpm=");
      Serial.print(previousTrendBpm, 1);
      Serial.print(",current_bpm=");
      Serial.print(bpm, 1);
      Serial.println(",confirmation=2_CONSECUTIVE_SLOTS");
    }
  }

  rememberTrendSample(bpm, resultSlotIndex);
}

void emitSuccessfulSlot(const MeasurementResult &result, uint32_t nowMs) {
  Serial.print("DATA,slot=");
  Serial.print(slotIndex);
  Serial.print(",scheduled_ms=");
  Serial.print(currentSlotDueMs() - sessionStartMs);
  Serial.print(",measured_ms=");
  Serial.print(nowMs - sessionStartMs);
  Serial.print(",bpm=");
  Serial.print(result.bpm, 1);
  Serial.print(",status=OK,ibi_mean_ms=");
  Serial.print(result.ibiMeanMs, 1);
  Serial.print(",ibi_stddev_ms=");
  Serial.print(result.ibiStddevMs, 1);
  Serial.print(",intervals=");
  Serial.println(result.acceptedIntervals);
}

void startMeasurement(uint32_t nowMs) {
  if (!slotOpen || !enoughTimeForMeasurement(nowMs)) {
    markCurrentSlotMissed("INSUFFICIENT_TIME_FOR_RETRY", nowMs);
    return;
  }

  measurementStartMs = nowMs;
  badQualityWindows = 0;
  lastRewearMessageMs = 0;
  resetBeatCollection();
  resetQualityWindow(nowMs);
  runState = MEASURING;
  setLed(true);

  Serial.print("MEASUREMENT_START,slot=");
  Serial.print(slotIndex);
  Serial.print(",scheduled_ms=");
  Serial.println(currentSlotDueMs() - sessionStartMs);
}

void waitForRewear(uint32_t nowMs, const char *reason) {
  resetBeatCollection();
  setLed(false);
  runState = WAITING_FOR_REWEAR;
  contactGood = false;
  contactQualityKnown = false;
  resetQualityWindow(nowMs);

  Serial.print("MEASUREMENT_RETRY_REQUIRED,slot=");
  Serial.print(slotIndex);
  Serial.print(",reason=");
  Serial.println(reason);
  printRewearMessage(nowMs);

  if (!enoughTimeForMeasurement(nowMs)) {
    markCurrentSlotMissed("REWEAR_EXCEEDED_SLOT", nowMs);
  }
}

void finishMeasurement(uint32_t nowMs) {
  // A result belongs to the original slot only when it completes before the
  // next fixed one-minute boundary.
  if (timeReached(nowMs, currentSlotDeadlineMs())) {
    markCurrentSlotMissed("MEASUREMENT_FINISHED_AFTER_DEADLINE", nowMs);
    return;
  }

  MeasurementResult result = analyzeIntervals();

  if (!result.valid) {
    waitForRewear(nowMs, "INVALID_PULSE_SIGNAL");
    return;
  }

  emitSuccessfulSlot(result, nowMs);
  processBpmAlerts(result.bpm, slotIndex);
  closeCurrentSlot();
}

void detectBeat(float filtered, uint32_t nowMs) {
  float absoluteSignal = fabsf(filtered);
  signalEnvelope = signalEnvelope * 0.995f + absoluteSignal * 0.005f;

  float threshold = signalEnvelope * 1.30f;
  if (threshold < 6.0f) {
    threshold = 6.0f;
  }

  bool localPeak =
    previousFiltered1 > previousFiltered2 &&
    previousFiltered1 >= filtered &&
    previousFiltered1 > threshold;

  previousFiltered2 = previousFiltered1;
  previousFiltered1 = filtered;

  if (
    runState != MEASURING ||
    nowMs - measurementStartMs < FILTER_SETTLE_MS ||
    !localPeak
  ) {
    return;
  }

  uint32_t peakMs = nowMs - (SAMPLE_INTERVAL_US / 1000);

  if (lastPeakMs == 0) {
    lastPeakMs = peakMs;
    return;
  }

  uint32_t intervalMs = peakMs - lastPeakMs;

  if (intervalMs < MIN_IBI_MS) {
    return;
  }

  lastPeakMs = peakMs;

  if (intervalMs <= MAX_IBI_MS) {
    appendIbi(intervalMs);
  }
}

void startSession(uint32_t nowMs) {
  sessionStartMs = nowMs;
  slotIndex = 0;
  slotOpen = true;
  baselineReady = false;
  baselineFirstSampleReady = false;
  baselineFirstBpm = 0.0f;
  baselineBpm = 0.0f;
  peakBpm = 0.0f;
  nextIncreaseAlertPercent = FIRST_INCREASE_ALERT_PERCENT;
  declineAlertSent = false;
  resetConsecutiveTrendSample();

  Serial.println("SESSION_START");
  startMeasurement(nowMs);
}

void stopSession(uint32_t nowMs) {
  if (slotOpen && runState != SESSION_STOPPED) {
    emitMissedSlot("SESSION_STOPPED", nowMs);
  }

  slotOpen = false;
  runState = SESSION_STOPPED;
  setLed(false);

  Serial.print("SESSION_STOP,elapsed_ms=");
  Serial.println(nowMs - sessionStartMs);
}

void restartSessionWait(uint32_t nowMs) {
  slotOpen = false;
  baselineReady = false;
  baselineFirstSampleReady = false;
  baselineFirstBpm = 0.0f;
  baselineBpm = 0.0f;
  resetConsecutiveTrendSample();
  contactGood = false;
  contactQualityKnown = false;
  runState = WAITING_FOR_FIRST_CONTACT;
  setLed(false);
  resetBeatCollection();
  resetQualityWindow(nowMs);

  Serial.println("SESSION_READY,센서를 착용하면 새 세션을 시작합니다.");
}

void printStatus(uint32_t nowMs) {
  Serial.print("STATUS,state=");
  Serial.print(stateName());
  Serial.print(",contact=");
  Serial.print(contactGood ? "GOOD" : "POOR");
  Serial.print(",slot=");
  Serial.print(slotIndex);
  Serial.print(",elapsed_ms=");
  Serial.print(sessionStartMs == 0 ? 0 : nowMs - sessionStartMs);
  Serial.print(",baseline_bpm=");

  if (baselineReady) {
    Serial.println(baselineBpm, 1);
  } else {
    Serial.println();
  }

  if (!baselineReady && baselineFirstSampleReady) {
    Serial.print("STATUS,baseline_pending=1_of_2,first_bpm=");
    Serial.println(baselineFirstBpm, 1);
  }
}

void executeCommand(uint32_t nowMs) {
  commandBuffer[commandLength] = '\0';

  for (uint8_t i = 0; i < commandLength; i++) {
    if (commandBuffer[i] >= 'a' && commandBuffer[i] <= 'z') {
      commandBuffer[i] -= ('a' - 'A');
    }
  }

  if (strcmp(commandBuffer, "STOP") == 0) {
    stopSession(nowMs);
  } else if (strcmp(commandBuffer, "START") == 0) {
    restartSessionWait(nowMs);
  } else if (strcmp(commandBuffer, "STATUS") == 0) {
    printStatus(nowMs);
  }

  commandLength = 0;
}

void serviceSerialCommands(uint32_t nowMs) {
  while (Serial.available() > 0) {
    char character = (char)Serial.read();

    if (character == '\r' || character == '\n') {
      if (commandLength > 0) {
        executeCommand(nowMs);
      }
      continue;
    }

    if (commandLength < sizeof(commandBuffer) - 1) {
      commandBuffer[commandLength++] = character;
    }
  }
}

void evaluateQualityWindow(uint32_t nowMs) {
  if (
    qualitySamples == 0 ||
    nowMs - qualityWindowStartMs < QUALITY_WINDOW_MS
  ) {
    return;
  }

  uint16_t rawRange = rawMaximum - rawMinimum;
  float filteredRange = filteredMaximum - filteredMinimum;
  bool clippingAcceptable = clippedSamples <= qualitySamples / 20;
  bool newContactGood =
    rawRange >= MIN_RAW_RANGE &&
    rawRange <= MAX_RAW_RANGE &&
    filteredRange >= MIN_FILTERED_RANGE &&
    filteredRange <= MAX_FILTERED_RANGE &&
    clippingAcceptable;

  bool changed = !contactQualityKnown || newContactGood != contactGood;
  contactQualityKnown = true;
  contactGood = newContactGood;

  if (changed) {
    Serial.print("CONTACT,state=");
    Serial.print(contactGood ? "GOOD" : "POOR");
    Serial.print(",raw_range=");
    Serial.print(rawRange);
    Serial.print(",filtered_range=");
    Serial.println(filteredRange, 1);
  }

  if (runState == MEASURING) {
    if (contactGood) {
      badQualityWindows = 0;
    } else {
      badQualityWindows++;

      if (badQualityWindows >= MAX_BAD_QUALITY_WINDOWS) {
        waitForRewear(nowMs, "POOR_CONTACT");
      }
    }
  } else if (
    runState != SESSION_STOPPED &&
    runState != WAITING_FOR_FIRST_CONTACT &&
    !contactGood
  ) {
    printRewearMessage(nowMs);
  }

  resetQualityWindow(nowMs);
}

void updateQuality(uint16_t raw, float filtered, uint32_t nowMs) {
  if (raw < rawMinimum) rawMinimum = raw;
  if (raw > rawMaximum) rawMaximum = raw;
  if (filtered < filteredMinimum) filteredMinimum = filtered;
  if (filtered > filteredMaximum) filteredMaximum = filtered;

  if (raw <= 3 || raw >= 4092) {
    clippedSamples++;
  }

  qualitySamples++;
  evaluateQualityWindow(nowMs);
}

void openScheduledSlot(uint32_t nowMs) {
  slotOpen = true;

  if (contactGood && enoughTimeForMeasurement(nowMs)) {
    startMeasurement(nowMs);
  } else {
    runState = WAITING_FOR_REWEAR;
    printRewearMessage(nowMs);

    if (!enoughTimeForMeasurement(nowMs)) {
      markCurrentSlotMissed("NO_TIME_AFTER_POOR_CONTACT", nowMs);
    }
  }
}

void serviceSchedule(uint32_t nowMs) {
  if (
    runState == WAITING_FOR_FIRST_CONTACT ||
    runState == SESSION_STOPPED
  ) {
    return;
  }

  if (slotOpen) {
    if (timeReached(nowMs, currentSlotDeadlineMs())) {
      markCurrentSlotMissed("SLOT_DEADLINE", nowMs);
      return;
    }

    if (runState == WAITING_FOR_REWEAR) {
      if (contactGood) {
        if (enoughTimeForMeasurement(nowMs)) {
          startMeasurement(nowMs);
        } else {
          markCurrentSlotMissed("REWEAR_TOO_LATE", nowMs);
        }
      } else {
        printRewearMessage(nowMs);
      }
    }

    return;
  }

  // Catch up without moving the original one-minute schedule.
  while (timeReached(nowMs, currentSlotDeadlineMs())) {
    slotOpen = true;
    emitMissedSlot("SCHEDULER_LAG", nowMs);
    closeCurrentSlot();
  }

  if (timeReached(nowMs, currentSlotDueMs())) {
    openScheduledSlot(nowMs);
  }
}

void processSample(uint32_t nowMs) {
  uint16_t raw = readAveragedSample();
  float filtered = filterSample((float)raw);

  updateQuality(raw, filtered, nowMs);
  detectBeat(filtered, nowMs);

  if (OUTPUT_RAW_SIGNAL) {
    Serial.print("raw:");
    Serial.print(raw);
    Serial.print("\tfiltered:");
    Serial.println(filtered);
  }

  if (
    runState == WAITING_FOR_FIRST_CONTACT &&
    contactQualityKnown &&
    contactGood
  ) {
    startSession(nowMs);
  }

  if (
    runState == MEASURING &&
    nowMs - measurementStartMs >= MEASUREMENT_TIME_MS
  ) {
    finishMeasurement(nowMs);
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(STATUS_LED, OUTPUT);
  setLed(false);

  analogReadResolution(12);
  analogSetPinAttenuation(PULSE_PIN, ADC_11db);

  uint32_t nowMs = millis();
  resetQualityWindow(nowMs);
  resetBeatCollection();
  nextSampleTimeUs = micros();

  Serial.println("DrunkSafe 연속 심박 모니터 준비 완료");
  Serial.println("센서를 착용하면 첫 측정과 고정 1분 일정을 시작합니다.");
  Serial.println("종료하려면 시리얼 모니터에서 STOP을 보내세요.");
}

void loop() {
  uint32_t nowMs = millis();
  serviceSerialCommands(nowMs);

  uint32_t nowUs = micros();

  if ((int32_t)(nowUs - nextSampleTimeUs) >= 0) {
    nextSampleTimeUs += SAMPLE_INTERVAL_US;

    // If another operation delayed the loop, resume from the current time.
    if ((int32_t)(nowUs - nextSampleTimeUs) > 100000) {
      nextSampleTimeUs = nowUs + SAMPLE_INTERVAL_US;
    }

    processSample(nowMs);
  }

  serviceSchedule(nowMs);
}
