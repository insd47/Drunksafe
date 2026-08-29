#include <Arduino.h>
#include <math.h>

// Arduino Uno (ATmega328P): PPG OUT -> A0, GND -> GND.
// Power the sensor only at a voltage supported by its datasheet.
// No BLE, display, buttons, or alcohol sensor.
// Both sketches share the same tracking logic; only filtering/threshold differ.
#define PPG_BUTTERWORTH 0

constexpr uint8_t PPG_PIN = A0;
constexpr uint32_t SAMPLE_PERIOD_US = 10000UL;
constexpr bool OUTPUT_RAW_SIGNAL = false; // Optional S rows at 20 Hz, sampling stays 100 Hz.
constexpr uint32_t LIVE_WINDOW_MS = 15000UL;
constexpr uint16_t MIN_IBI_MS = 334; // 40..180 BPM; reject individual invalid intervals.
constexpr uint16_t MAX_IBI_MS = 1500;
constexpr uint16_t NO_BEAT_TIMEOUT_MS = 1600;
constexpr uint16_t WARMUP_MS = 2000;
constexpr uint8_t IBI_CAPACITY = 48; // Enough for 15 s at 180 BPM.
constexpr uint16_t MIN_SIGNAL_RANGE = 3; // Uno 10-bit ADC; tune using saved raw.
constexpr uint16_t MAX_RAW_STEP = 160; // Gross contact/motion transient, not a contact sensor.

// Exact coefficients from firmware/src/devices/pulse/params.rs, designed for 100 Hz.
constexpr float FILTER_B[5] = {
    0.006867866F, 0.0F, -0.013735732F, 0.0F, 0.006867866F};
constexpr float FILTER_A[5] = {
    1.0F, -3.7340894F, 5.2501354F, -3.2957025F, 0.77973944F};

class SignalFilter {
 public:
  float z[4] = {};
  float reference = 0, lowpass = 0, envelope = 0;
  bool initialized = false;

  void reset() {
    for (uint8_t i = 0; i < 4; ++i) z[i] = 0;
    reference = lowpass = envelope = 0;
    initialized = false;
  }

  float push(uint16_t raw) {
    if (!initialized) {
      reference = raw;
      initialized = true;
    }
#if PPG_BUTTERWORTH
    // Remove only the initial constant offset to limit startup transients.
    // Do not add an EMA high-pass ahead of the project's Butterworth.
    const float x = float(raw) - reference;
    const float y = FILTER_B[0] * x + z[0];
    z[0] = FILTER_B[1] * x - FILTER_A[1] * y + z[1];
    z[1] = FILTER_B[2] * x - FILTER_A[2] * y + z[2];
    z[2] = FILTER_B[3] * x - FILTER_A[3] * y + z[3];
    z[3] = FILTER_B[4] * x - FILTER_A[4] * y;
#else
    reference += (float(raw) - reference) * 0.01F;
    lowpass = lowpass * 0.80F + (float(raw) - reference) * 0.20F;
    const float y = lowpass;
#endif
    envelope = envelope * 0.995F + fabsf(y) * 0.005F;
    return y;
  }

  float threshold() const {
#if PPG_BUTTERWORTH
    return 5.0F; // Preserve the user's current Uno Butterworth threshold.
#else
    // Original envelope threshold with minimum 6 / 4 for Uno's 10-bit ADC.
    return fmaxf(1.5F, envelope * 1.15F);
#endif
  }
};

struct Estimate {
  float bpm = 0;
  uint8_t valid = 0, total = 0;
  uint32_t coveredMs = 0;
};

enum ContactState : uint8_t { WAITING, WARMING, COLLECTING };
enum ResetReason : uint8_t { BOOT, SIGNAL_LOST, NO_BEAT, RAW_STEP, CADENCE_GAP };
enum QualityCode : uint8_t { PENDING, QUALITY_OK, FLAT_SIGNAL, CLIPPED_SIGNAL, SPARSE_SAMPLES };

class PulseTracker {
 public:
  SignalFilter filter;
  ContactState state = WAITING;
  ResetReason reason = BOOT;
  uint32_t intervalEnd[IBI_CAPACITY] = {};
  uint16_t intervals[IBI_CAPACITY] = {};
  uint8_t count = 0, head = 0;
  uint32_t lastPeakMs = 0, warmupStartedMs = 0;
  bool hasPeak = false;
  float previous2 = 0, previous1 = 0;
  uint32_t previousMs = 0;
  uint8_t previousCount = 0;
  uint16_t rawPrevious = 0;
  bool hasRaw = false;

  uint16_t qMin = 1023, qMax = 0, qSamples = 0, qClipped = 0;
  uint32_t qualityStartedMs = 0;
  uint8_t goodWindows = 0, badWindows = 0;
  QualityCode qualityCode = PENDING;
  uint16_t lastRange = 0, lastSamples = 0, lastClipped = 0;
  uint16_t latestRaw = 0;
  float latestFiltered = 0;
  uint32_t resetCount = 0;

  uint32_t minuteStartedMs = 0;
  uint8_t binIndex = 0;
  uint16_t binBpm10[6] = {};
  uint16_t minuteBpm10 = 0;
  uint32_t minuteCompletedMs = 0;
  Estimate live;

  static void sort(uint16_t* values, uint8_t n) {
    for (uint8_t i = 1; i < n; ++i) {
      const uint16_t value = values[i];
      uint8_t j = i;
      while (j > 0 && values[j - 1] > value) {
        values[j] = values[j - 1];
        --j;
      }
      values[j] = value;
    }
  }

  static float median(const uint16_t* sorted, uint8_t n) {
    if (!n) return 0;
    return n % 2 ? sorted[n / 2]
                 : (uint32_t(sorted[n / 2 - 1]) + sorted[n / 2]) / 2.0F;
  }

  void resetQuality(uint32_t now) {
    qMin = 1023; qMax = qSamples = qClipped = 0;
    qualityStartedMs = now;
  }

  void clearHistory(uint32_t now) {
    count = head = 0;
    hasPeak = false;
    lastPeakMs = 0;
    previousCount = 0;
    previous1 = previous2 = 0;
    live = Estimate();
    minuteStartedMs = now;
    binIndex = 0;
    minuteBpm10 = 0;
    minuteCompletedMs = 0;
    for (uint8_t i = 0; i < 6; ++i) binBpm10[i] = 0;
  }

  void loseSignal(uint32_t now, ResetReason why) {
    clearHistory(now); // Never bridge two contact periods with an IBI.
    state = WAITING;
    reason = why;
    goodWindows = badWindows = 0;
    ++resetCount;
    filter.reset();
    hasRaw = false;
    resetQuality(now);
  }

  void loseBeats(uint32_t now) {
    clearHistory(now);
    reason = NO_BEAT;
    ++resetCount;
    // Peak loss is not proof of removal. Keep the settled filter and quality state.
    // No old peak anchor survives, so a long gap can never become an IBI.
    warmupStartedMs = now;
  }

  Estimate estimate(uint32_t end, uint32_t windowMs,
                    uint8_t minimumCount, uint16_t minimumCoveredMs) const {
    Estimate result;
    uint16_t sorted[IBI_CAPACITY];
    for (uint8_t i = 0; i < count; ++i) {
      const uint32_t age = end - intervalEnd[i];
      // Entire IBI must be inside the window. Unsigned ages also reject future entries.
      if (age <= windowMs && intervals[i] <= windowMs - age) {
        sorted[result.total++] = intervals[i];
      }
    }
    if (!result.total) return result;
    sort(sorted, result.total);
    const float center = median(sorted, result.total);
    // Recompute from the current window, not the previous BPM: no permanent lock-in.
    for (uint8_t i = 0; i < result.total; ++i) {
      if (fabsf(float(sorted[i]) - center) <= center * 0.25F) {
        result.coveredMs += sorted[i];
        sorted[result.valid++] = sorted[i];
      }
    }
    if (result.valid >= minimumCount &&
        result.coveredMs >= minimumCoveredMs &&
        uint16_t(result.valid) * 4 >= uint16_t(result.total) * 3) {
      result.bpm = 60000.0F / median(sorted, result.valid);
    }
    return result;
  }

  void refreshLive(uint32_t now) {
    live = state == COLLECTING && hasPeak && now - lastPeakMs <= NO_BEAT_TIMEOUT_MS
               ? estimate(now, LIVE_WINDOW_MS, 8, 8000)
               : Estimate();
  }

  void advanceMinute(uint32_t now) {
    if (state != COLLECTING) return;
    while (now - minuteStartedMs >= uint32_t(binIndex + 1) * 10000UL) {
      const uint32_t boundary = minuteStartedMs + uint32_t(binIndex + 1) * 10000UL;
      // Non-overlapping 10 s bins: do not count rolling live outputs repeatedly.
      const Estimate bin = estimate(boundary, 10000UL, 5, 7000);
      binBpm10[binIndex++] = uint16_t(bin.bpm * 10.0F + 0.5F);
      if (binIndex < 6) continue;
      uint16_t validBins[6];
      uint8_t n = 0;
      bool consecutiveMissing = false;
      for (uint8_t i = 0; i < 6; ++i) {
        if (binBpm10[i]) validBins[n++] = binBpm10[i];
        if (i && !binBpm10[i] && !binBpm10[i - 1]) consecutiveMissing = true;
      }
      const bool coverage = n >= 4 && (binBpm10[0] || binBpm10[1]) &&
                            (binBpm10[4] || binBpm10[5]) && !consecutiveMissing;
      sort(validBins, n);
      minuteBpm10 = coverage ? uint16_t(median(validBins, n) + 0.5F) : 0;
      minuteCompletedMs = boundary;
      minuteStartedMs = boundary;
      binIndex = 0;
      for (uint8_t i = 0; i < 6; ++i) binBpm10[i] = 0;
    }
  }

  void acceptPeak(uint32_t at) {
    if (!hasPeak) {
      hasPeak = true;
      lastPeakMs = at; // First new peak is an anchor, never an interval.
      return;
    }
    const uint32_t ibi = at - lastPeakMs;
    if (ibi < MIN_IBI_MS) return; // Ignore early extra peak without moving the anchor.
    if (ibi > MAX_IBI_MS) {
      loseBeats(at);
      return;
    }
    lastPeakMs = at;
    intervalEnd[head] = at;
    intervals[head] = uint16_t(ibi);
    head = (head + 1) % IBI_CAPACITY;
    if (count < IBI_CAPACITY) ++count;
    refreshLive(at);
  }

  void checkQuality(uint16_t raw, uint32_t now) {
    if (raw < qMin) qMin = raw;
    if (raw > qMax) qMax = raw;
    ++qSamples;
    if (raw <= 1 || raw >= 1022) ++qClipped;
    if (now - qualityStartedMs < 1000UL) return;
    // Preserve diagnostics before resetting accumulators. A short timing slip
    // must not restart the contact detector every second.
    lastRange = qMax - qMin;
    lastSamples = qSamples;
    lastClipped = qClipped;
    const uint32_t elapsed = now - qualityStartedMs;
    qualityCode = uint32_t(qSamples) * 1000UL < elapsed * 80UL ? SPARSE_SAMPLES
        : uint32_t(qClipped) * 20 > qSamples ? CLIPPED_SIGNAL
        : lastRange < MIN_SIGNAL_RANGE ? FLAT_SIGNAL : QUALITY_OK;
    resetQuality(now);
    if (qualityCode != QUALITY_OK) {
      goodWindows = 0;
      ++badWindows;
      // Invalidate BPM immediately; tolerate one flat window before restarting
      // the filter. Clipping/sparse acquisition still require immediate recovery.
      clearHistory(now);
      reason = SIGNAL_LOST;
      if (qualityCode != FLAT_SIGNAL || badWindows >= 2)
        loseSignal(now, SIGNAL_LOST);
      return;
    }
    badWindows = 0;
    if (state == WAITING && ++goodWindows >= 1) {
      clearHistory(now);
      filter.reset();
      state = WARMING;
      warmupStartedMs = now;
    }
  }

  float process(uint16_t raw, uint32_t now) {
    latestRaw = raw;
    if (hasRaw && abs(int(raw) - int(rawPrevious)) > MAX_RAW_STEP)
      loseSignal(now, RAW_STEP);
    rawPrevious = raw;
    hasRaw = true;
    checkQuality(raw, now);
    const float filtered = filter.push(raw);
    latestFiltered = filtered;
    if (!isfinite(filtered)) {
      loseSignal(now, SIGNAL_LOST);
      return 0;
    }
    if (state == WARMING && now - warmupStartedMs >= WARMUP_MS) {
      clearHistory(now);
      state = COLLECTING;
      warmupStartedMs = now;
    }
    if (state == COLLECTING) {
      if (hasPeak && now - lastPeakMs > NO_BEAT_TIMEOUT_MS) {
        loseBeats(now);
      }
      advanceMinute(now);
      if (previousCount >= 2 && previous1 > previous2 && previous1 >= filtered &&
          previous1 >= filter.threshold()) acceptPeak(previousMs);
    }
    previous2 = previous1;
    previous1 = filtered;
    previousMs = now;
    if (previousCount < 2) ++previousCount;
    return filtered;
  }
};

PulseTracker tracker;
uint32_t nextSampleUs = 0, lastReportMs = 0, lastWaveMs = 0, lastQualityReportMs = 0;
uint32_t missedDeadlines = 0;

void printBpm(float bpm) {
  if (bpm > 0) Serial.print(bpm, 1);
  else Serial.print(F("NA"));
}

void printReport(uint32_t now) {
  tracker.refreshLive(now);
  Serial.print(F("R,"));
  Serial.print(now);
  Serial.print(',');
  if (tracker.state == WAITING) Serial.print(F("waiting"));
  else if (tracker.state == WARMING) Serial.print(F("warmup"));
  else if (!tracker.hasPeak && now - tracker.warmupStartedMs > 3000UL)
    Serial.print(F("no_peaks"));
  else Serial.print(tracker.live.bpm > 0 ? F("valid") : F("collecting"));
  Serial.print(',');
  printBpm(tracker.live.bpm);
  Serial.print(',');
  Serial.print(tracker.live.valid);
  Serial.print('/');
  Serial.print(tracker.live.total);
  Serial.print(',');
  printBpm(tracker.minuteBpm10 / 10.0F);
  Serial.print(',');
  if (tracker.minuteBpm10) Serial.print(now - tracker.minuteCompletedMs);
  else Serial.print(F("NA"));
  Serial.print(',');
  Serial.print(uint8_t(tracker.reason));
  Serial.print(',');
  Serial.println(missedDeadlines);
}

void printQuality() {
  Serial.print(F("Q,"));
  switch (tracker.qualityCode) {
    case QUALITY_OK: Serial.print(F("ok")); break;
    case FLAT_SIGNAL: Serial.print(F("flat")); break;
    case CLIPPED_SIGNAL: Serial.print(F("clipped")); break;
    case SPARSE_SAMPLES: Serial.print(F("sparse")); break;
    default: Serial.print(F("pending")); break;
  }
  Serial.print(','); Serial.print(tracker.latestRaw);
  Serial.print(','); Serial.print(tracker.lastRange);
  Serial.print(','); Serial.print(tracker.lastSamples);
  Serial.print(','); Serial.print(tracker.lastClipped);
  Serial.print(','); Serial.print(tracker.latestFiltered, 2);
  Serial.print(','); Serial.print(tracker.filter.threshold(), 2);
  Serial.print(','); Serial.println(tracker.resetCount);
}

void setup() {
  pinMode(PPG_PIN, INPUT);
  Serial.begin(115200);
  Serial.println(F("R,ms,state,bpm,valid_ibi/total,minute_bpm,minute_age_ms,last_reset,missed"));
  Serial.println(F("# reset:0=boot,1=signal,2=no_beat,3=raw_step,4=cadence"));
  Serial.println(F("# S,ms,raw,filtered (optional 20Hz waveform)"));
  Serial.println(F("# Q,quality,raw,range,samples,clipped,filtered,threshold,resets"));
  Serial.flush(); // Startup only; no sample timing has started yet.
  tracker.loseSignal(millis(), BOOT);
  nextSampleUs = micros();
}

void loop() {
  const uint32_t nowUs = micros();
  const int32_t lateUs = int32_t(nowUs - nextSampleUs);
  if (lateUs < 0) return;
  if (lateUs >= int32_t(SAMPLE_PERIOD_US)) {
    missedDeadlines += uint32_t(lateUs) / SAMPLE_PERIOD_US;
    // Small stalls are counted, not mistaken for sensor removal. A gap of
    // 50 ms or more invalidates the filter/IBI history.
    if (lateUs >= 50000L) tracker.loseSignal(millis(), CADENCE_GAP);
    nextSampleUs = nowUs + SAMPLE_PERIOD_US; // Do not fabricate catch-up samples.
  } else {
    nextSampleUs += SAMPLE_PERIOD_US;
  }

  const uint32_t now = millis();
  const uint16_t raw = analogRead(PPG_PIN);
  const float filtered = tracker.process(raw, now);
  if (now - lastReportMs >= 1000UL) {
    lastReportMs = now;
    printReport(now);
  } else if (now - lastQualityReportMs >= 1000UL && now - lastReportMs >= 400UL) {
    lastQualityReportMs = now;
    printQuality(); // Separate from R so printing does not block sampling in a burst.
  } else if (OUTPUT_RAW_SIGNAL && now - lastWaveMs >= 50UL) {
    lastWaveMs = now;
    Serial.print(F("S,"));
    Serial.print(now);
    Serial.print(',');
    Serial.print(raw);
    Serial.print(',');
    Serial.println(filtered, 3);
  }
}
