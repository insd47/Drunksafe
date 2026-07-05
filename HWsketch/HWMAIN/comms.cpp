#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <esp_mac.h>
#include "comms.h"

#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

static BLECharacteristic *pCharacteristic = nullptr;
static bool deviceConnected = false;

class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      deviceConnected = true;
    };
    void onDisconnect(BLEServer* pServer) {
      deviceConnected = false;
      pServer->getAdvertising()->start();
    }
};

void initComms() {
  // 기기마다 고유한 MAC 주소를 이용해 블루투스 이름 생성
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_BT);
  char devName[32];
  snprintf(devName, sizeof(devName), "Drunksafe_%02X%02X", mac[4], mac[5]);
  
  BLEDevice::init(devName);
  
  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);

  pCharacteristic = pService->createCharacteristic(
                      CHARACTERISTIC_UUID,
                      BLECharacteristic::PROPERTY_READ   |
                      BLECharacteristic::PROPERTY_NOTIFY
                    );
  pCharacteristic->addDescriptor(new BLE2902());

  pService->start();
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  BLEDevice::startAdvertising();
}

void sendDataToApp(const PpgFeatures& f, float alcoholVal) {
  if (deviceConnected && pCharacteristic != nullptr) {
    char jsonBuf[512];
    snprintf(jsonBuf, sizeof(jsonBuf),
      "{\"type\":\"feat\",\"t\":%lu,\"time_counter\":%d,\"current_bpm\":%.2f,\"current_ibi_stdev\":%.2f,\"current_peak_amp\":%.2f,"
      "\"bpm_20s\":%.2f,\"bpm_20s_d\":%.2f,\"bpm_1m\":%.2f,\"bpm_1m_d\":%.2f,\"bpm_5m\":%.2f,\"bpm_5m_d\":%.2f,"
      "\"stabilized\":%d,\"alcohol\":%.3f}",
      f.t, f.time_counter, f.current_bpm, f.current_ibi_stdev, f.current_peak_amp,
      f.bpm_20s, f.bpm_20s_d, f.bpm_1m, f.bpm_1m_d, f.bpm_5m, f.bpm_5m_d,
      f.stabilized, alcoholVal
    );
    // TODO(나중에 사용가능하게 주석 처리됨): 아래 두 줄의 주석을 해제하면 앱(BLE)으로 JSON이 전송됩니다.
    // pCharacteristic->setValue(jsonBuf);
    // pCharacteristic->notify();
  }
}

void sendRawDataToApp(unsigned long start_t, const int* values, int count) {
  if (deviceConnected && pCharacteristic != nullptr && count > 0) {
    char jsonBuf[512];
    int offset = snprintf(jsonBuf, sizeof(jsonBuf), "{\"type\":\"raw\",\"start_t\":%lu,\"v\":[", start_t);
    for (int i = 0; i < count; i++) {
      if (i > 0) {
        offset += snprintf(jsonBuf + offset, sizeof(jsonBuf) - offset, ",");
      }
      offset += snprintf(jsonBuf + offset, sizeof(jsonBuf) - offset, "%d", values[i]);
      if (offset >= sizeof(jsonBuf) - 10) break; // 버퍼 오버플로우 방지
    }
    snprintf(jsonBuf + offset, sizeof(jsonBuf) - offset, "]}");
    
    // TODO(나중에 사용가능하게 주석 처리됨): 아래 두 줄의 주석을 해제하면 앱(BLE)으로 JSON이 전송됩니다.
    // pCharacteristic->setValue(jsonBuf);
    // pCharacteristic->notify();
  }
}
