#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <esp_mac.h>
#include "comms.h"

// BLE 앱이 찾을 service UUID와 데이터 characteristic UUID입니다.
// 앱 쪽 UUID와 이 값이 맞아야 연결/읽기/notify가 가능합니다.
#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

// BLE characteristic 포인터입니다.
// 연결된 앱이 있을 때 JSON 문자열을 이 characteristic에 실어 보낼 수 있습니다.
static BLECharacteristic *pCharacteristic = nullptr;
static bool deviceConnected = false;

// BLE 연결/해제 이벤트 처리 클래스입니다.
// 연결이 끊기면 advertising을 다시 시작해서 앱이 재연결할 수 있게 합니다.
class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      (void)pServer;
      deviceConnected = true;
    };

    void onDisconnect(BLEServer* pServer) {
      deviceConnected = false;
      pServer->getAdvertising()->start();
    }
};

void initComms() {
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_BT);

  // 여러 ESP32를 동시에 켰을 때 구분하기 쉽도록 MAC 뒤 2바이트를 이름에 붙입니다.
  char devName[32];
  snprintf(devName, sizeof(devName), "Drunksafe_%02X%02X", mac[4], mac[5]);

  BLEDevice::init(devName);

  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);

  pCharacteristic = pService->createCharacteristic(
                      CHARACTERISTIC_UUID,
                      BLECharacteristic::PROPERTY_READ |
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

    // 앱에서 바로 파싱할 수 있도록 심박 특징값과 알코올 값을 하나의 JSON으로 묶습니다.
    // 버퍼 크기가 고정되어 있으므로 필드를 추가할 때는 512바이트 초과 여부를 확인해야 합니다.
    snprintf(jsonBuf, sizeof(jsonBuf),
      "{\"type\":\"feat\",\"t\":%lu,\"time_counter\":%d,\"current_bpm\":%.2f,\"current_ibi_stdev\":%.2f,\"current_peak_amp\":%.2f,"
      "\"bpm_20s\":%.2f,\"bpm_20s_d\":%.2f,\"bpm_1m\":%.2f,\"bpm_1m_d\":%.2f,\"bpm_5m\":%.2f,\"bpm_5m_d\":%.2f,"
      "\"stabilized\":%d,\"alcohol\":%.3f}",
      f.t, f.time_counter, f.current_bpm, f.current_ibi_stdev, f.current_peak_amp,
      f.bpm_20s, f.bpm_20s_d, f.bpm_1m, f.bpm_1m_d, f.bpm_5m, f.bpm_5m_d,
      f.stabilized, alcoholVal
    );

    // 실제 BLE notify 전송을 켤 때 아래 두 줄을 활성화합니다.
    // pCharacteristic->setValue(jsonBuf);
    // pCharacteristic->notify();
  }
}

void sendRawDataToApp(unsigned long start_t, const int* values, int count) {
  if (deviceConnected && pCharacteristic != nullptr && count > 0) {
    char jsonBuf[512];

    // raw PPG 그래프용 데이터입니다. 첫 샘플 시간과 ADC 값 배열을 보냅니다.
    int offset = snprintf(jsonBuf, sizeof(jsonBuf), "{\"type\":\"raw\",\"start_t\":%lu,\"v\":[", start_t);

    for (int i = 0; i < count; i++) {
      if (i > 0) {
        offset += snprintf(jsonBuf + offset, sizeof(jsonBuf) - offset, ",");
      }

      offset += snprintf(jsonBuf + offset, sizeof(jsonBuf) - offset, "%d", values[i]);

      // JSON 버퍼를 넘기지 않도록 여유 공간이 작아지면 샘플 추가를 중단합니다.
      if (offset >= sizeof(jsonBuf) - 10) {
        break;
      }
    }

    snprintf(jsonBuf + offset, sizeof(jsonBuf) - offset, "]}");

    // 실제 BLE notify 전송을 켤 때 아래 두 줄을 활성화합니다.
    // pCharacteristic->setValue(jsonBuf);
    // pCharacteristic->notify();
  }
}
