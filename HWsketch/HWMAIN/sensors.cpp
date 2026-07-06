#include <Arduino.h>
#include <esp_system.h>
#include "sensors.h"

namespace {
// =====================================================
// 센서 핀과 PPG 샘플링/계산 기준값
// =====================================================
// PPG_PIN은 ESP32 ADC 입력입니다. ZE29A_RXD2/TXD2는 Serial2 연결 핀입니다.
const int PPG_PIN = 36;
const int ZE29A_RXD2 = 16;
const int ZE29A_TXD2 = 17;

// PPG는 10ms마다 샘플링해서 100Hz로 취급합니다.
// BPM 계산은 최근 5초 창을 기준으로 하며, 시작 후 10초는 안정화 시간으로 둡니다.
const unsigned long PPG_SAMPLE_INTERVAL_MS = 10;
const int PPG_SAMPLE_RATE_HZ = 100;
const int PPG_WINDOW_SECONDS = 5;
const int PPG_WINDOW_SIZE = PPG_SAMPLE_RATE_HZ * PPG_WINDOW_SECONDS;
const int PPG_START_DELAY_SAMPLES = PPG_SAMPLE_RATE_HZ * 10;
const int PPG_CALC_INTERVAL_SAMPLES = PPG_WINDOW_SIZE;

// PPG 신호 보정용 필터와 피크 검출 기준입니다.
// 저역/고역 통과 필터로 심박 성분만 남기고, 일정 크기 이상인 봉우리를 박동 후보로 봅니다.
const float LOWPASS_CUTOFF_HZ = 3.5;
const float HIGHPASS_CUTOFF_HZ = 0.7;
const float PEAK_THRESHOLD = 50.0;
const int MIN_PEAK_DISTANCE_SAMPLES = 30;
const float UNSTABLE_IBI_STDEV_MS = 200.0;

// 최근 5초 보정 PPG 값과 각 샘플의 시간을 저장하는 원형 버퍼입니다.
float correctedBuffer[PPG_WINDOW_SIZE];
unsigned long timeBuffer[PPG_WINDOW_SIZE];
int bufferIndex = 0;
int bufferCount = 0;

// 샘플링 주기와 BPM 계산 주기를 관리하는 카운터입니다.
unsigned long lastSampleTime = 0;
unsigned long totalSamples = 0;
int samplesSinceLastCalc = 0;

// 필터 내부 상태값입니다. 이전 상태가 있어야 다음 보정값을 계산할 수 있습니다.
float lowpassState = 0.0;
float highpassState = 0.0;
float previousLowpassInput = 0.0;
bool filterInitialized = false;

// OLED와 앱으로 넘길 최신 심박 계산 결과입니다.
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

// 1차 저역 통과 필터 alpha를 계산합니다.
float calculateLowpassAlpha(float cutoffHz) {
  const float dt = 1.0 / PPG_SAMPLE_RATE_HZ;
  const float rc = 1.0 / (2.0 * PI * cutoffHz);
  return dt / (rc + dt);
}

// 1차 고역 통과 필터 alpha를 계산합니다.
float calculateHighpassAlpha(float cutoffHz) {
  const float dt = 1.0 / PPG_SAMPLE_RATE_HZ;
  const float rc = 1.0 / (2.0 * PI * cutoffHz);
  return rc / (rc + dt);
}

// PPG ADC를 4번 읽어 평균을 냅니다.
// 비트 시프트로 4로 나누어 순간 잡음을 조금 줄입니다.
int measurePpg() {
  int sum = 0;
  sum += analogRead(PPG_PIN);
  sum += analogRead(PPG_PIN);
  sum += analogRead(PPG_PIN);
  sum += analogRead(PPG_PIN);
  return sum >> 2;
}

// raw PPG 값에 저역/고역 통과 필터를 적용해 박동 성분을 강조합니다.
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

// 보정된 PPG 값을 5초 원형 버퍼에 저장합니다.
void saveCorrectedPpg(float correctedValue, unsigned long sampleTime) {
  correctedBuffer[bufferIndex] = correctedValue;
  timeBuffer[bufferIndex] = sampleTime;
  bufferIndex = (bufferIndex + 1) % PPG_WINDOW_SIZE;

  if (bufferCount < PPG_WINDOW_SIZE) {
    bufferCount++;
  }
}

// 원형 버퍼를 시간 순서대로 읽기 위한 실제 배열 인덱스를 계산합니다.
int orderedIndex(int index) {
  if (bufferCount < PPG_WINDOW_SIZE) {
    return index;
  }
  return (bufferIndex + index) % PPG_WINDOW_SIZE;
}

// 배열 평균 계산 helper입니다.
float calculateMean(float values[], int count) {
  if (count == 0) return 0.0;
  float sum = 0.0;
  for (int i = 0; i < count; i++) {
    sum += values[i];
  }
  return sum / count;
}

// 배열 표준편차 계산 helper입니다.
float calculateStdev(float values[], int count, float mean) {
  if (count == 0) return 0.0;
  float sumSquares = 0.0;
  for (int i = 0; i < count; i++) {
    float diff = values[i] - mean;
    sumSquares += diff * diff;
  }
  return sqrt(sumSquares / count);
}

// 최근 5초 보정 PPG 창에서 피크 후보를 찾습니다.
// 너무 가까운 피크가 겹치면 더 큰 값을 남겨 중복 박동을 줄입니다.
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

// 20초/1분/5분 이동평균 큐를 공통 처리하는 helper입니다.
// out_bpm은 이동평균, out_bpm_d는 직전 이동평균 대비 변화량입니다.
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

// 검출된 피크 사이 간격(IBI)으로 BPM과 안정도 지표를 계산합니다.
// IBI 표준편차가 크면 움직임/접촉 불안정으로 판단해 latestBpm 갱신을 보류합니다.
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

// 5초 버퍼가 충분히 찼을 때 피크 검출과 BPM 계산을 수행합니다.
void updateBpmCalculation() {
  if (bufferCount < PPG_WINDOW_SIZE) {
    return;
  }

  int peakIndexes[PPG_WINDOW_SIZE];
  int peakCount = 0;
  findPpgPeaks(peakIndexes, peakCount);
  calculateBpmFromPeaks(peakIndexes, peakCount);
}

// =====================================================
// 앱 전송용 raw PPG 원형 버퍼
// =====================================================
const int RAW_BUFFER_SIZE = 100; 
int raw_vals[RAW_BUFFER_SIZE];
unsigned long raw_times[RAW_BUFFER_SIZE];
int raw_head = 0;
int raw_tail = 0;

// =====================================================
// ZE-29A 알코올 센서 명령/상태값
// =====================================================
// ZE-29A는 9바이트 명령 패킷으로 상태 조회, 결과 요청, 측정 시작/대기를 제어합니다.
byte zeCmdState[9]  = {0xFF, 0x01, 0x85, 0x00, 0x00, 0x00, 0x00, 0x00, 0x7A};
byte zeCmdResult[9] = {0xFF, 0x01, 0x86, 0x00, 0x00, 0x00, 0x00, 0x00, 0x79};
byte zeCmdStart[9]  = {0xFF, 0x01, 0x87, 0x32, 0x00, 0x00, 0x00, 0x00, 0x46};
byte zeCmdIdle[9]   = {0xFF, 0x01, 0x87, 0x31, 0x00, 0x00, 0x00, 0x00, 0x47};

const unsigned long ZE29A_POLL_INTERVAL_MS = 500;
const unsigned long ZE29A_MEASURE_TIMEOUT_MS = 45000;

// 알코올 측정 진행 상태입니다.
byte zeLastState = 0x00;
unsigned long zeLastPollTime = 0;
unsigned long zeMeasurementStartTime = 0;
float latestAlcoholValue = 0.0;
bool alcoholMeasurementRunning = false;
bool alcoholMeasurementFinished = true;
AlcoholSensorStatus alcoholStatus = ALCOHOL_SENSOR_IDLE;

// ZE-29A 패킷의 checksum을 계산합니다.
byte checkZe29aSum(byte* packet) {
  byte sum = 0;
  for (int i = 1; i < 8; i++) {
    sum += packet[i];
  }

  return (~sum) + 1;
}

// ZE-29A 상태 바이트를 내부 AlcoholSensorStatus로 변환합니다.
// 0x37은 결과 준비 상태라 결과 요청 명령을 즉시 보냅니다.
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

// Serial2 수신 버퍼에서 완전한 9바이트 ZE-29A 패킷을 읽습니다.
// 이 함수는 기다리지 않고, 지금 들어와 있는 데이터만 확인합니다.
bool readZe29aPacket(byte* packet) {
  while (Serial2.available() >= 9) {
    if (Serial2.read() != 0xFF) {
      continue;
    }

    packet[0] = 0xFF;

    for (int index = 1; index < 9; index++) {
      packet[index] = Serial2.read();
    }

    if (checkZe29aSum(packet) == packet[8]) {
      return true;
    }
  }

  return false;
}

// 읽은 ZE-29A 패킷 종류에 따라 상태 또는 결과값을 처리합니다.
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

// ESP32 ADC 해상도를 12비트로 설정합니다.
// PPG_PIN은 analogRead() 호출 시 자동으로 ADC 입력으로 사용됩니다.
void initBpmSensor() {
  analogReadResolution(12);
}

// ZE-29A가 연결된 Serial2를 시작하고 센서를 idle 상태로 되돌립니다.
// 측정을 시작하기 전 기본 준비 단계입니다.
void initAlcoholSensor() {
  Serial2.begin(9600, SERIAL_8N1, ZE29A_RXD2, ZE29A_TXD2);
  Serial2.write(zeCmdIdle, 9);
  alcoholStatus = ALCOHOL_SENSOR_IDLE;
  alcoholMeasurementRunning = false;
  alcoholMeasurementFinished = true;
}

// PPG 센서를 10ms 간격으로 샘플링합니다.
// raw 값은 앱 그래프 버퍼에 넣고, 보정값은 BPM 계산용 5초 버퍼에 넣습니다.
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

// 현재 표시 가능한 최신 BPM을 반환합니다.
// 초기 안정화 또는 불안정 상태에서는 bpmReady가 false라 0을 반환할 수 있습니다.
int Bpm() {
  return bpmReady ? latestBpm : 0;
}

// 앱 전송용 raw PPG 버퍼에 쌓인 샘플 개수를 반환합니다.
int getRawDataAvailable() {
    return (raw_head >= raw_tail) ? (raw_head - raw_tail) : (RAW_BUFFER_SIZE - raw_tail + raw_head);
}

// raw PPG 버퍼에서 최대 max_count개를 꺼냅니다.
// 꺼낸 샘플은 버퍼에서 제거되며, 첫 샘플 시간은 out_start_t에 저장됩니다.
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

// 현재까지 계산된 심박 특징값 전체를 구조체로 묶어 반환합니다.
// BLE JSON 생성부가 이 값을 그대로 사용합니다.
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

// 새 알코올 측정을 시작합니다.
// 이전 수신 버퍼를 비우고, 상태/결과값을 초기화한 뒤 ZE-29A start 명령을 보냅니다.
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

// 알코올 측정 진행 중에 주기적으로 호출되어야 하는 함수입니다.
// 상태 조회는 500ms마다 보내고, 들어온 패킷은 즉시 처리합니다.
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

// 알코올 측정 완료 여부를 반환합니다.
// 완료, 시간 초과, 오류 등 더 이상 기다릴 필요가 없을 때 true가 됩니다.
bool isAlcoholMeasurementFinished() {
  return alcoholMeasurementFinished;
}

// 현재 ZE-29A 진행 상태를 반환합니다.
// OLED 안내 화면은 이 값을 보고 문구를 선택합니다.
AlcoholSensorStatus getAlcoholSensorStatus() {
  return alcoholStatus;
}

// 가장 최근 ZE-29A 결과값을 반환합니다.
// handleZe29aPacket()에서 결과 패킷을 받으면 최신값으로 갱신됩니다.
float alcohol() {
  return latestAlcoholValue;
}

// 최종 안전 상태 판별 함수입니다.
// 현재는 임시 랜덤 판별이므로, 실제 기준식이 확정되면 이 함수 내부만 교체하면 됩니다.
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
