#include <Arduino.h>

// Drunksafe PPG-only test sketch.
// - PPG pin: GPIO36 (same as the Rust firmware)
// - No BLE, display, button, alcohol sensor, or Butterworth filter
// - Keeps the existing 100 Hz sampling, 20 s window, 5 s analysis interval,
//   local-maximum peak detection, amplitude threshold, 300 ms refractory,
//   IBI standard deviation, and BPM calculation.

constexpr uint8_t PPG_PIN = 36;

constexpr uint32_t SERIAL_BAUD = 115200;
constexpr uint32_t SAMPLE_RATE_HZ = 100;
constexpr uint32_t SAMPLE_PERIOD_US = 1000000UL / SAMPLE_RATE_HZ;
constexpr uint8_t SAMPLE_AVERAGE_READS = 4;

constexpr size_t WINDOW_SAMPLES = 20 * SAMPLE_RATE_HZ;
constexpr size_t START_DELAY_SAMPLES = 20 * SAMPLE_RATE_HZ;
constexpr size_t ANALYSIS_INTERVAL_SAMPLES = 5 * SAMPLE_RATE_HZ;

// Butterworth 대신 raw DC offset만 제거하는 1초 이동평균 기준선이다.
// PEAK_THRESHOLD는 이 기준선에서 위로 솟은 ADC count 단위 진폭이다.
constexpr size_t BASELINE_SAMPLES = SAMPLE_RATE_HZ;
constexpr float PEAK_THRESHOLD = 50.0F;
constexpr uint32_t MIN_PEAK_DISTANCE_MS = 300;
constexpr float IBI_STDEV_UNSTABLE_MS = 300.0F;

struct Sample {
  uint32_t elapsedMs;
  uint16_t raw;
  float centered;
};

struct Peak {
  uint32_t elapsedMs;
  float amplitude;
};

Sample samples[WINDOW_SAMPLES];
Peak candidates[WINDOW_SAMPLES / 2];
Peak peaks[WINDOW_SAMPLES / 2];

size_t writeIndex = 0;
size_t windowCount = 0;
uint32_t totalSamples = 0;
uint32_t samplesSinceAnalysis = 0;

uint16_t baselineRaw[BASELINE_SAMPLES];
size_t baselineIndex = 0;
size_t baselineCount = 0;
uint32_t baselineSum = 0;

uint32_t startedMs = 0;
uint32_t nextSampleUs = 0;

uint16_t readPpgRaw();
float removeDcBaseline(uint16_t raw);
void pushSample(uint32_t elapsedMs, uint16_t raw, float centered);
void analyzeWindow();
Sample sampleAt(size_t chronologicalIndex);
size_t findPeaks();
void sortCandidateIndicesByAmplitude(size_t count, uint16_t *indices);
float mean(const float *values, size_t count);
float standardDeviation(const float *values, size_t count, float average);

void setup() {
  Serial.begin(SERIAL_BAUD);
  analogReadResolution(12);
  analogSetPinAttenuation(PPG_PIN, ADC_11db);

  delay(300);
  startedMs = millis();
  nextSampleUs = micros();

  Serial.println();
  Serial.println("PPG-only BPM test (GPIO36, no Butterworth)");
  Serial.println("Warming up for 20 seconds...");
  Serial.println("elapsed_ms,bpm,ibi_stddev_ms,peak_count,stable,latest_raw");
}

void loop() {
  const uint32_t nowUs = micros();
  if (static_cast<int32_t>(nowUs - nextSampleUs) < 0) {
    return;
  }

  // 고정 주기 기준점을 누적해 loop 실행시간 때문에 주기가 계속 밀리지 않게 한다.
  nextSampleUs += SAMPLE_PERIOD_US;

  // 한 주기 이상 크게 밀린 경우 과거 sample을 몰아서 읽지 않고 현재부터 재동기화한다.
  if (static_cast<int32_t>(nowUs - nextSampleUs) >= static_cast<int32_t>(SAMPLE_PERIOD_US)) {
    nextSampleUs = nowUs + SAMPLE_PERIOD_US;
  }

  const uint16_t raw = readPpgRaw();
  const float centered = removeDcBaseline(raw);
  const uint32_t elapsedMs = millis() - startedMs;
  pushSample(elapsedMs, raw, centered);

  ++totalSamples;
  ++samplesSinceAnalysis;

  if (totalSamples < START_DELAY_SAMPLES) {
    return;
  }

  if (totalSamples == START_DELAY_SAMPLES) {
    samplesSinceAnalysis = 0;
    Serial.println("Warm-up complete; BPM analysis starts in 5 seconds.");
    return;
  }

  if (samplesSinceAnalysis >= ANALYSIS_INTERVAL_SAMPLES) {
    samplesSinceAnalysis = 0;
    analyzeWindow();
  }
}

uint16_t readPpgRaw() {
  uint32_t sum = 0;
  for (uint8_t i = 0; i < SAMPLE_AVERAGE_READS; ++i) {
    sum += analogRead(PPG_PIN);
  }
  return static_cast<uint16_t>(sum / SAMPLE_AVERAGE_READS);
}

float removeDcBaseline(uint16_t raw) {
  if (baselineCount < BASELINE_SAMPLES) {
    baselineRaw[baselineIndex] = raw;
    baselineSum += raw;
    ++baselineCount;
  } else {
    baselineSum -= baselineRaw[baselineIndex];
    baselineRaw[baselineIndex] = raw;
    baselineSum += raw;
  }

  baselineIndex = (baselineIndex + 1) % BASELINE_SAMPLES;
  const float baseline = static_cast<float>(baselineSum) / baselineCount;
  return static_cast<float>(raw) - baseline;
}

void pushSample(uint32_t elapsedMs, uint16_t raw, float centered) {
  samples[writeIndex] = {elapsedMs, raw, centered};
  writeIndex = (writeIndex + 1) % WINDOW_SAMPLES;
  if (windowCount < WINDOW_SAMPLES) {
    ++windowCount;
  }
}

Sample sampleAt(size_t chronologicalIndex) {
  const size_t oldest = windowCount == WINDOW_SAMPLES ? writeIndex : 0;
  return samples[(oldest + chronologicalIndex) % WINDOW_SAMPLES];
}

size_t findPeaks() {
  size_t candidateCount = 0;

  for (size_t i = 1; i + 1 < windowCount; ++i) {
    const Sample previous = sampleAt(i - 1);
    const Sample current = sampleAt(i);
    const Sample next = sampleAt(i + 1);

    if (current.centered > previous.centered &&
        current.centered >= next.centered &&
        current.centered >= PEAK_THRESHOLD &&
        candidateCount < WINDOW_SAMPLES / 2) {
      candidates[candidateCount++] = {current.elapsedMs, current.centered};
    }
  }

  if (candidateCount == 0) {
    return 0;
  }

  // 기존 Rust 코드처럼 큰 peak부터 선택하고, 선택된 peak의 ±300ms 안 후보는 제거한다.
  static uint16_t order[WINDOW_SAMPLES / 2];
  static bool keep[WINDOW_SAMPLES / 2];
  for (size_t i = 0; i < candidateCount; ++i) {
    order[i] = static_cast<uint16_t>(i);
    keep[i] = true;
  }
  sortCandidateIndicesByAmplitude(candidateCount, order);

  for (size_t orderIndex = 0; orderIndex < candidateCount; ++orderIndex) {
    const size_t selected = order[orderIndex];
    if (!keep[selected]) {
      continue;
    }

    const uint32_t selectedAt = candidates[selected].elapsedMs;
    for (size_t i = 0; i < candidateCount; ++i) {
      if (i == selected || !keep[i]) {
        continue;
      }

      const uint32_t otherAt = candidates[i].elapsedMs;
      const uint32_t distance = selectedAt > otherAt ? selectedAt - otherAt : otherAt - selectedAt;
      if (distance < MIN_PEAK_DISTANCE_MS) {
        keep[i] = false;
      }
    }
  }

  size_t peakCount = 0;
  for (size_t i = 0; i < candidateCount; ++i) {
    if (keep[i]) {
      peaks[peakCount++] = candidates[i];
    }
  }
  return peakCount;
}

void sortCandidateIndicesByAmplitude(size_t count, uint16_t *indices) {
  // 최대 1000개, 5초마다 한 번뿐인 테스트 분석이라 단순 insertion sort로 충분하다.
  for (size_t i = 1; i < count; ++i) {
    const uint16_t key = indices[i];
    size_t j = i;
    while (j > 0 && candidates[indices[j - 1]].amplitude < candidates[key].amplitude) {
      indices[j] = indices[j - 1];
      --j;
    }
    indices[j] = key;
  }
}

void analyzeWindow() {
  const size_t peakCount = findPeaks();
  const Sample latest = sampleAt(windowCount - 1);

  if (peakCount < 2) {
    Serial.printf("%lu,NA,NA,%u,false,%u\n",
                  latest.elapsedMs,
                  static_cast<unsigned>(peakCount),
                  latest.raw);
    return;
  }

  static float ibis[WINDOW_SAMPLES / 2];
  const size_t ibiCount = peakCount - 1;
  for (size_t i = 0; i < ibiCount; ++i) {
    ibis[i] = static_cast<float>(peaks[i + 1].elapsedMs - peaks[i].elapsedMs);
  }

  const float meanIbi = mean(ibis, ibiCount);
  const float ibiStddev = standardDeviation(ibis, ibiCount, meanIbi);
  const float bpm = meanIbi > 0.0F ? 60000.0F / meanIbi : 0.0F;
  const bool stable = ibiStddev <= IBI_STDEV_UNSTABLE_MS;

  Serial.printf("%lu,%.1f,%.1f,%u,%s,%u\n",
                latest.elapsedMs,
                bpm,
                ibiStddev,
                static_cast<unsigned>(peakCount),
                stable ? "true" : "false",
                latest.raw);
}

float mean(const float *values, size_t count) {
  float sum = 0.0F;
  for (size_t i = 0; i < count; ++i) {
    sum += values[i];
  }
  return count > 0 ? sum / count : 0.0F;
}

float standardDeviation(const float *values, size_t count, float average) {
  float variance = 0.0F;
  for (size_t i = 0; i < count; ++i) {
    const float difference = values[i] - average;
    variance += difference * difference;
  }
  return count > 0 ? sqrtf(variance / count) : 0.0F;
}
