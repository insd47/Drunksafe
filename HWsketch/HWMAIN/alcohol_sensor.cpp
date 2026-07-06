#include <Arduino.h>
#include "alcohol_sensor.h"

namespace {
// ZE-29A UART 핀.
const int ZE29A_RXD2 = 16;
const int ZE29A_TXD2 = 17;

// ZE-29A 명령 패킷.
byte zeCmdState[9]  = {0xFF, 0x01, 0x85, 0x00, 0x00, 0x00, 0x00, 0x00, 0x7A};
byte zeCmdResult[9] = {0xFF, 0x01, 0x86, 0x00, 0x00, 0x00, 0x00, 0x00, 0x79};
byte zeCmdStart[9]  = {0xFF, 0x01, 0x87, 0x32, 0x00, 0x00, 0x00, 0x00, 0x46};
byte zeCmdIdle[9]   = {0xFF, 0x01, 0x87, 0x31, 0x00, 0x00, 0x00, 0x00, 0x47};

// 조회/제한 시간.
const unsigned long ZE29A_POLL_INTERVAL_MS = 500;
const unsigned long ZE29A_MEASURE_TIMEOUT_MS = 45000;

// 측정 상태값.
byte zeLastState = 0x00;
unsigned long zeLastPollTime = 0;
unsigned long zeMeasurementStartTime = 0;
float latestAlcoholValue = 0.0;
bool alcoholMeasurementRunning = false;
bool alcoholMeasurementFinished = true;
AlcoholSensorStatus alcoholStatus = ALCOHOL_SENSOR_IDLE;

// 체크섬 계산.
byte checkZe29aSum(byte* packet) {
  byte sum = 0;
  for (int i = 1; i < 8; i++) {
    sum += packet[i];
  }

  return (~sum) + 1;
}

// 상태값 변환.
// 0x37이면 결과 요청.
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

// 패킷 읽기.
// 수신된 데이터만 처리.
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

// 패킷 처리.
// 0x85 상태, 0x86 결과.
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

// Serial2 시작.
void initAlcoholSensor() {
  Serial2.begin(9600, SERIAL_8N1, ZE29A_RXD2, ZE29A_TXD2);
  Serial2.write(zeCmdIdle, 9);
  alcoholStatus = ALCOHOL_SENSOR_IDLE;
  alcoholMeasurementRunning = false;
  alcoholMeasurementFinished = true;
}

// 새 측정 시작.
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

// 측정 상태 갱신.
// 지연 없이 처리.
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

// 측정 종료 확인.
bool isAlcoholMeasurementFinished() {
  return alcoholMeasurementFinished;
}

// 현재 상태 반환.
AlcoholSensorStatus getAlcoholSensorStatus() {
  return alcoholStatus;
}

// 최신 결과 반환.
float alcohol() {
  return latestAlcoholValue;
}
