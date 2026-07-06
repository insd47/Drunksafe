#include <Arduino.h>
#include <esp_system.h>
#include "sensors.h"

namespace {
const int PPG_PIN = 36;
const int ZE29A_RXD2 = 16;
const int ZE29A_TXD2 = 17;

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

// 추가된 특징값 관련 변수들
int time_counter = 0;
float current_bpm_val = 0.0;
float current_ibi_stdev_val = 0.0;
float current_peak_amp_val = 0.0;
int stabilized_val = 1;

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
  if (count == 0) return 0.0;
  float sum = 0.0;
  for (int i = 0; i < count; i++) {
    sum += values[i];
  }
  return sum / count;
}

float calculateStdev(float values[], int count, float mean) {
  if (count == 0) return 0.0;
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
  
  current_bpm_val = currentBpm;
  current_ibi_stdev_val = currentIbiStdev;
  current_peak_amp_val = currentPeakAmp;
  stabilized_val = unstable ? 1 : 0;

  if (!unstable) {
    latestBpm = (int)(currentBpm + 0.5);
    bpmReady = true;
  }

  // 이동평균 갱신
  push_trend(currentBpm, q_20s, Q_20S_SIZE, q_20s_count, head_20s, sum_20s, bpm_20s_val, bpm_20s_d_val, prev_bpm_20s);
  push_trend(currentBpm, q_1m, Q_1M_SIZE, q_1m_count, head_1m, sum_1m, bpm_1m_val, bpm_1m_d_val, prev_bpm_1m);
  push_trend(currentBpm, q_5m, Q_5M_SIZE, q_5m_count, head_5m, sum_5m, bpm_5m_val, bpm_5m_d_val, prev_bpm_5m);

  time_counter += 5;
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

const int RAW_BUFFER_SIZE = 100; 
int raw_vals[RAW_BUFFER_SIZE];
unsigned long raw_times[RAW_BUFFER_SIZE];
int raw_head = 0;
int raw_tail = 0;

byte zeCmdState[9]  = {0xFF, 0x01, 0x85, 0x00, 0x00, 0x00, 0x00, 0x00, 0x7A};
byte zeCmdResult[9] = {0xFF, 0x01, 0x86, 0x00, 0x00, 0x00, 0x00, 0x00, 0x79};
byte zeCmdStart[9]  = {0xFF, 0x01, 0x87, 0x32, 0x00, 0x00, 0x00, 0x00, 0x46};
byte zeCmdIdle[9]   = {0xFF, 0x01, 0x87, 0x31, 0x00, 0x00, 0x00, 0x00, 0x47};

const unsigned long ZE29A_POLL_INTERVAL_MS = 500;
const unsigned long ZE29A_PACKET_TIMEOUT_MS = 100;
const unsigned long ZE29A_MEASURE_TIMEOUT_MS = 45000;

byte zeLastState = 0x00;
unsigned long zeLastPollTime = 0;
unsigned long zeMeasurementStartTime = 0;
float latestAlcoholValue = 0.0;
bool alcoholMeasurementRunning = false;
bool alcoholMeasurementFinished = true;
AlcoholSensorStatus alcoholStatus = ALCOHOL_SENSOR_IDLE;

byte checkZe29aSum(byte* packet) {
  byte sum = 0;
  for (int i = 1; i < 8; i++) {
    sum += packet[i];
  }

  return (~sum) + 1;
}

void setZe29aStatusFromState(byte state) {
  zeLastState = state;

  switch (state) {
    case 0x31:
      alcoholStatus = ALCOHOL_SENSOR_IDLE;
      break;
    case 0x32:
      alcoholStatus = ALCOHOL_SENSOR_WARMING;
      break;
    case 0x33:
      alcoholStatus = ALCOHOL_SENSOR_READY_TO_BLOW;
      break;
    case 0x34:
      alcoholStatus = ALCOHOL_SENSOR_BLOWING;
      break;
    case 0x35:
      alcoholStatus = ALCOHOL_SENSOR_BLOW_WEAK;
      break;
    case 0x36:
      alcoholStatus = ALCOHOL_SENSOR_ANALYZING;
      break;
    case 0x37:
      alcoholStatus = ALCOHOL_SENSOR_ANALYZING;
      Serial2.write(zeCmdResult, 9);
      break;
    default:
      alcoholStatus = ALCOHOL_SENSOR_ERROR;
      break;
  }
}

bool readZe29aPacket(byte* packet) {
  while (Serial2.available()) {
    if (Serial2.read() != 0xFF) {
      continue;
    }

    packet[0] = 0xFF;
    unsigned long startTime = millis();
    int index = 1;

    while (index < 9 && millis() - startTime < ZE29A_PACKET_TIMEOUT_MS) {
      if (Serial2.available()) {
        packet[index++] = Serial2.read();
      }
    }

    if (index == 9 && checkZe29aSum(packet) == packet[8]) {
      return true;
    }
  }

  return false;
}

void handleZe29aPacket(byte* packet) {
  if (packet[1] == 0x85) {
    setZe29aStatusFromState(packet[2]);
    return;
  }

  if (packet[1] == 0x86) {
    int value = (packet[2] << 8) | packet[3];
    float mg100ml = (float)value;

    latestAlcoholValue = mg100ml / 1000.0;
    alcoholStatus = ALCOHOL_SENSOR_DONE;
    alcoholMeasurementRunning = false;
    alcoholMeasurementFinished = true;
    Serial2.write(zeCmdIdle, 9);
  }
}
}  // namespace

void initBpmSensor() {
  analogReadResolution(12);
}

void initAlcoholSensor() {
  Serial2.begin(9600, SERIAL_8N1, ZE29A_RXD2, ZE29A_TXD2);
  Serial2.write(zeCmdIdle, 9);
  alcoholStatus = ALCOHOL_SENSOR_IDLE;
  alcoholMeasurementRunning = false;
  alcoholMeasurementFinished = true;
}

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

int Bpm() {
  return bpmReady ? latestBpm : 0;
}

int getRawDataAvailable() {
    return (raw_head >= raw_tail) ? (raw_head - raw_tail) : (RAW_BUFFER_SIZE - raw_tail + raw_head);
}

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

void startAlcoholMeasurement() {
  while (Serial2.available()) {
    Serial2.read();
  }

  latestAlcoholValue = 0.0;
  zeLastState = 0x00;
  zeLastPollTime = 0;
  zeMeasurementStartTime = millis();
  alcoholStatus = ALCOHOL_SENSOR_WARMING;
  alcoholMeasurementRunning = true;
  alcoholMeasurementFinished = false;

  Serial2.write(zeCmdStart, 9);
}

void updateAlcoholSensor() {
  if (!alcoholMeasurementRunning) {
    return;
  }

  unsigned long now = millis();
  if (now - zeMeasurementStartTime > ZE29A_MEASURE_TIMEOUT_MS) {
    alcoholStatus = ALCOHOL_SENSOR_TIMEOUT;
    alcoholMeasurementRunning = false;
    alcoholMeasurementFinished = true;
    Serial2.write(zeCmdIdle, 9);
    return;
  }

  if (now - zeLastPollTime >= ZE29A_POLL_INTERVAL_MS) {
    zeLastPollTime = now;
    Serial2.write(zeCmdState, 9);
  }

  byte packet[9];
  while (readZe29aPacket(packet)) {
    handleZe29aPacket(packet);
  }
}

bool isAlcoholMeasurementFinished() {
  return alcoholMeasurementFinished;
}

AlcoholSensorStatus getAlcoholSensorStatus() {
  return alcoholStatus;
}

float alcohol() {
  return latestAlcoholValue;
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
