#include <Arduino.h>
#include "ppg_sensor.h"

namespace {
// PPG ADC 핀.
const int PPG_PIN = 36;

// 샘플링 기준.
// 10ms, 5초 창, 10초 안정화.
const unsigned long PPG_SAMPLE_INTERVAL_MS = 10;
const int PPG_SAMPLE_RATE_HZ = 100;
const int PPG_WINDOW_SECONDS = 5;
const int PPG_WINDOW_SIZE = PPG_SAMPLE_RATE_HZ * PPG_WINDOW_SECONDS;
const int PPG_START_DELAY_SAMPLES = PPG_SAMPLE_RATE_HZ * 10;
const int PPG_CALC_INTERVAL_SAMPLES = PPG_WINDOW_SIZE;

// 필터/피크 기준값.
const float LOWPASS_CUTOFF_HZ = 3.5;
const float HIGHPASS_CUTOFF_HZ = 0.7;
const float PEAK_THRESHOLD = 50.0;
const int MIN_PEAK_DISTANCE_SAMPLES = 30;
const float UNSTABLE_IBI_STDEV_MS = 200.0;

// 5초 보정값 버퍼.
float correctedBuffer[PPG_WINDOW_SIZE];
unsigned long timeBuffer[PPG_WINDOW_SIZE];
int bufferIndex = 0;
int bufferCount = 0;

// 샘플링 카운터.
unsigned long lastSampleTime = 0;
unsigned long totalSamples = 0;
int samplesSinceLastCalc = 0;

// 필터 상태값.
float lowpassState = 0.0;
float highpassState = 0.0;
float previousLowpassInput = 0.0;
bool filterInitialized = false;

// 최신 출력값.
int latestBpm = 0;
bool bpmReady = false;

// 최근 5초 특징값.
int time_counter = 0;
float current_bpm_val = 0.0;
float current_ibi_stdev_val = 0.0;
float current_peak_amp_val = 0.0;
int stabilized_val = 1;

// 이동평균 큐.
// 20초, 1분, 5분.
const int Q_20S_SIZE = 4;
const int Q_1M_SIZE = 12;
const int Q_5M_SIZE = 60;
float q_20s[4];
float q_1m[12];
float q_5m[60];
int q_20s_count = 0, q_1m_count = 0, q_5m_count = 0;
int head_20s = 0, head_1m = 0, head_5m = 0;
float sum_20s = 0.0, sum_1m = 0.0, sum_5m = 0.0;
float prev_bpm_20s = 0.0, prev_bpm_1m = 0.0, prev_bpm_5m = 0.0;
float bpm_20s_val = 0.0, bpm_20s_d_val = 0.0;
float bpm_1m_val = 0.0, bpm_1m_d_val = 0.0;
float bpm_5m_val = 0.0, bpm_5m_d_val = 0.0;

// raw 전송 버퍼.
const int RAW_BUFFER_SIZE = 100;
int raw_vals[RAW_BUFFER_SIZE];
unsigned long raw_times[RAW_BUFFER_SIZE];
int raw_head = 0;
int raw_tail = 0;

// 저역 필터 계수.
float calculateLowpassAlpha(float cutoffHz) {
  const float dt = 1.0 / PPG_SAMPLE_RATE_HZ;
  const float rc = 1.0 / (2.0 * PI * cutoffHz);
  return dt / (rc + dt);
}

// 고역 필터 계수.
float calculateHighpassAlpha(float cutoffHz) {
  const float dt = 1.0 / PPG_SAMPLE_RATE_HZ;
  const float rc = 1.0 / (2.0 * PI * cutoffHz);
  return rc / (rc + dt);
}

// ADC 4회 평균.
int measurePpg() {
  int sum = 0;
  sum += analogRead(PPG_PIN);
  sum += analogRead(PPG_PIN);
  sum += analogRead(PPG_PIN);
  sum += analogRead(PPG_PIN);
  return sum >> 2;
}

// PPG 보정.
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

// 보정값 저장.
void saveCorrectedPpg(float correctedValue, unsigned long sampleTime) {
  correctedBuffer[bufferIndex] = correctedValue;
  timeBuffer[bufferIndex] = sampleTime;
  bufferIndex = (bufferIndex + 1) % PPG_WINDOW_SIZE;

  if (bufferCount < PPG_WINDOW_SIZE) {
    bufferCount++;
  }
}

// 버퍼 인덱스 변환.
int orderedIndex(int index) {
  if (bufferCount < PPG_WINDOW_SIZE) {
    return index;
  }
  return (bufferIndex + index) % PPG_WINDOW_SIZE;
}

// 평균 계산.
float calculateMean(float values[], int count) {
  if (count == 0) return 0.0;
  float sum = 0.0;
  for (int i = 0; i < count; i++) {
    sum += values[i];
  }
  return sum / count;
}

// 표준편차 계산.
float calculateStdev(float values[], int count, float mean) {
  if (count == 0) return 0.0;
  float sumSquares = 0.0;
  for (int i = 0; i < count; i++) {
    float diff = values[i] - mean;
    sumSquares += diff * diff;
  }
  return sqrt(sumSquares / count);
}

// 심박 피크 검출.
// 가까운 피크는 큰 값만 유지.
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

// 이동평균 갱신.
void push_trend(float bpm, float* q, int size, int& count, int& head, float& sum, float& out_bpm, float& out_bpm_d, float& prev_bpm) {
    if (count == size) { sum -= q[head]; } else { count++; }
    q[head] = bpm;
    sum += bpm;
    head = (head + 1) % size;
    if (count == size) {
        out_bpm = sum / size;
        out_bpm_d = (prev_bpm > 0.0) ? (out_bpm - prev_bpm) : 0.0;
        prev_bpm = out_bpm;
    } else {
        out_bpm = 0.0; out_bpm_d = 0.0;
    }
}

// 피크 간격으로 BPM 계산.
// 불안정하면 표시값 보류.
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

  current_bpm_val = currentBpm;
  current_ibi_stdev_val = currentIbiStdev;
  current_peak_amp_val = currentPeakAmp;
  stabilized_val = unstable ? 1 : 0;

  if (!unstable) {
    latestBpm = (int)(currentBpm + 0.5);
    bpmReady = true;
  }

  push_trend(currentBpm, q_20s, Q_20S_SIZE, q_20s_count, head_20s, sum_20s, bpm_20s_val, bpm_20s_d_val, prev_bpm_20s);
  push_trend(currentBpm, q_1m, Q_1M_SIZE, q_1m_count, head_1m, sum_1m, bpm_1m_val, bpm_1m_d_val, prev_bpm_1m);
  push_trend(currentBpm, q_5m, Q_5M_SIZE, q_5m_count, head_5m, sum_5m, bpm_5m_val, bpm_5m_d_val, prev_bpm_5m);

  time_counter += 5;
}

// BPM 계산 실행.
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

// ADC 설정.
void initBpmSensor() {
  analogReadResolution(12);
}

// PPG 샘플링.
// 내부에서 10ms 제한.
void updateBpmSensor() {
  unsigned long now = millis();
  if (now - lastSampleTime < PPG_SAMPLE_INTERVAL_MS) {
    return;
  }

  lastSampleTime = now;

  int rawValue = measurePpg();

  int next_head = (raw_head + 1) % RAW_BUFFER_SIZE;
  if (next_head != raw_tail) {
      raw_vals[raw_head] = rawValue;
      raw_times[raw_head] = now;
      raw_head = next_head;
  }

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

// 최신 BPM 반환.
int Bpm() {
  return bpmReady ? latestBpm : 0;
}

// raw 개수 반환.
int getRawDataAvailable() {
    return (raw_head >= raw_tail) ? (raw_head - raw_tail) : (RAW_BUFFER_SIZE - raw_tail + raw_head);
}

// raw 묶음 반환.
int popRawDataBatch(unsigned long& out_start_t, int* out_values, int max_count) {
    int available = getRawDataAvailable();
    if (available == 0) return 0;

    int to_pop = (available > max_count) ? max_count : available;
    out_start_t = raw_times[raw_tail];
    for (int i = 0; i < to_pop; i++) {
        out_values[i] = raw_vals[raw_tail];
        raw_tail = (raw_tail + 1) % RAW_BUFFER_SIZE;
    }
    return to_pop;
}

// 특징값 묶음 반환.
PpgFeatures getLatestPpgFeatures() {
    PpgFeatures f;
    f.t = millis();
    f.time_counter = time_counter;
    f.current_bpm = current_bpm_val;
    f.current_ibi_stdev = current_ibi_stdev_val;
    f.current_peak_amp = current_peak_amp_val;
    f.bpm_20s = bpm_20s_val;
    f.bpm_20s_d = bpm_20s_d_val;
    f.bpm_1m = bpm_1m_val;
    f.bpm_1m_d = bpm_1m_d_val;
    f.bpm_5m = bpm_5m_val;
    f.bpm_5m_d = bpm_5m_d_val;
    f.stabilized = stabilized_val;
    return f;
}
