#include <Arduino.h>
#include <Wire.h>
#include <U8g2lib.h> // U8g2 라이브러리 포함

// 핀 설정
#define SENSOR_RX_PIN 32 // 센서 TX 연결[cite: 1]
#define SENSOR_TX_PIN 33 // 센서 RX 연결[cite: 1]
#define BUTTON_PIN 4     // 물리 버튼 연결 핀 (내부 풀업 사용)

// 센서 상태 코드[cite: 1]
#define STATE_IDLE              0x31
#define STATE_PREHEATING        0x32
#define STATE_WAITING_BLOW      0x33
#define STATE_BLOWING           0x34
#define STATE_BLOW_INTERRUPTED  0x35
#define STATE_CALCULATING       0x36
#define STATE_READ_RESULT       0x37

// ==================== OLED DISPLAY SETUP ====================
// 1.3" OLED (SH1106 드라이버) 하드웨어 I2C 사용 (SDA=21, SCL=22)
U8G2_SH1106_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, /* reset=*/ U8X8_PIN_NONE);

// 함수 선언
byte calculateChecksum(byte *packet);
void sendCommand(byte cmd, byte data1 = 0x00, byte data2 = 0x00);
bool readPacket(byte *buffer, unsigned long timeout = 1000);
byte queryStatus();
void readResult();
void startPreheating();
void updateOLED(String line1, String line2, String line3 = "");
String getStateString(byte state);

void setup() {
  Serial.begin(115200);
  Serial2.begin(9600, SERIAL_8N1, SENSOR_RX_PIN, SENSOR_TX_PIN); // 센서 보드레이트 9600[cite: 1]
  
  // 버튼 핀 모드 설정 (내부 풀업 저항 사용)
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  // OLED 초기화
  u8g2.begin();
  
  // 초기 대기 화면 출력
  updateOLED("ZE29A Ready", "Press Button", "to Start!");
  Serial.println("\n시스템 준비 완료. 버튼을 누르면 시작됩니다.");
}

void loop() {
  // 버튼이 눌렸는지 확인 (LOW일 때 눌림)
  if (digitalRead(BUTTON_PIN) == LOW) {
    delay(50); // 디바운싱(Debouncing) 처리
    if (digitalRead(BUTTON_PIN) == LOW) { // 진짜 눌렸는지 재확인
      
      updateOLED("Starting...", "Please wait");
      Serial.println("\n버튼 입력 감지! 측정을 시작합니다.");
      
      // 0x32(Preheating) 상태 전환 명령어 전송[cite: 1]
      startPreheating();
      delay(500);

      bool measurementDone = false;
      byte lastState = 0x00;

      while (!measurementDone) {
        // 측정 중 버튼을 다시 누르면 측정 강제 취소
        if (digitalRead(BUTTON_PIN) == LOW) {
          delay(50);
          if (digitalRead(BUTTON_PIN) == LOW) {
            updateOLED("Canceled", "Press Button", "to Restart");
            Serial.println("사용자에 의해 측정이 취소되었습니다.");
            while(digitalRead(BUTTON_PIN) == LOW); // 버튼 뗄 때까지 대기
            break; 
          }
        }

        byte currentState = queryStatus();
        
        if (currentState != 0x00 && currentState != lastState) {
          Serial.print("상태: ");
          Serial.println(getStateString(currentState));
          
          // 상태별 OLED 디스플레이 업데이트
          switch(currentState) {
            case STATE_PREHEATING:
              updateOLED("Preheating...", "Wait 10 sec");
              break;
            case STATE_WAITING_BLOW:
              // 바람 부는 타이밍 안내
              updateOLED("BLOW NOW!", ">> 4 Seconds <<", "Keep blowing");
              break;
            case STATE_BLOWING:
              updateOLED("Blowing...", "Don't stop!");
              break;
            case STATE_BLOW_INTERRUPTED:
              updateOLED("Interrupted!", "Blow longer", "Restarting...");
              break;
            case STATE_CALCULATING:
              updateOLED("Calculating...", "Wait a moment");
              break;
          }
          lastState = currentState;
        }

        switch (currentState) {
          case STATE_READ_RESULT:
            // 0x86 명령어로 결과 읽기[cite: 1]
            readResult();
            measurementDone = true;
            break;
            
          case STATE_IDLE:
            if (lastState == STATE_WAITING_BLOW) {
               updateOLED("Timeout", "Press Button", "to Restart");
               measurementDone = true;
            }
            break;
        }
        delay(500); // 0.5초 간격으로 센서 상태 폴링
      }
      
      // 측정이 완전히 끝난 후 버튼에서 손을 뗄 때까지 대기하여 연속 터치 방지
      while(digitalRead(BUTTON_PIN) == LOW); 
      delay(1000); 
    }
  }
}

// ---------------- 함수 구현부 ----------------

// U8g2 전용 OLED 화면 업데이트 편의 함수
void updateOLED(String line1, String line2, String line3) {
  u8g2.clearBuffer(); // 메모리 버퍼 지우기
  
  // 첫 번째 줄 (큰 폰트)
  u8g2.setFont(u8g2_font_ncenB14_tr); // 약 14픽셀 높이 굵은 폰트
  u8g2.setCursor(0, 16);              // U8g2는 왼쪽 아래가 기준이므로 y값을 내려줌
  u8g2.print(line1);
  
  // 두 번째 줄 (작은 폰트)
  u8g2.setFont(u8g2_font_ncenB08_tr); // 약 8픽셀 높이 굵은 폰트
  u8g2.setCursor(0, 36);
  u8g2.print(line2);
  
  // 세 번째 줄 (작은 폰트, 내용이 있을 때만)
  if (line3 != "") {
    u8g2.setCursor(0, 54);
    u8g2.print(line3);
  }
  
  u8g2.sendBuffer(); // 버퍼의 내용을 화면에 전송
}

// 체크섬 계산[cite: 1]
byte calculateChecksum(byte *packet) {
  byte sum = 0;
  for (int i = 1; i <= 7; i++) sum += packet[i];
  return (byte)(~sum + 1);
}

// 패킷 수신[cite: 1]
bool readPacket(byte *buffer, unsigned long timeout) {
  unsigned long startTime = millis();
  int index = 0;
  while (millis() - startTime < timeout) {
    if (Serial2.available() > 0) {
      buffer[index] = Serial2.read();
      if (index == 0 && buffer[0] != 0xFF) continue;
      index++;
      if (index == 9) {
        if (buffer[8] == calculateChecksum(buffer)) return true;
        else return false;
      }
    }
  }
  return false;
}

// 명령어 전송부[cite: 1]
void sendCommand(byte cmd, byte data1, byte data2) {
  while (Serial2.available() > 0) Serial2.read(); // 남은 버퍼 찌꺼기 비우기
  byte packet[9] = {0xFF, 0x01, cmd, data1, data2, 0x00, 0x00, 0x00, 0x00};
  packet[8] = calculateChecksum(packet);
  Serial2.write(packet, 9);
}

// 예열 명령[cite: 1]
void startPreheating() {
  sendCommand(0x87, 0x32); 
  byte rxBuffer[9];
  readPacket(rxBuffer, 1000);
}

// 상태 조회[cite: 1]
byte queryStatus() {
  sendCommand(0x85);
  byte rxBuffer[9];
  if (readPacket(rxBuffer, 500)) return rxBuffer[2];
  return 0x00;
}

// 결과 읽기 및 U8g2 화면 출력[cite: 1]
void readResult() {
  sendCommand(0x86);
  byte rxBuffer[9];
  
  if (readPacket(rxBuffer, 1000)) {
    // 알코올 농도 = (High Byte << 8) | Low Byte[cite: 1]
    uint16_t alcoholConcentration = (rxBuffer[2] << 8) | rxBuffer[3];
    byte alarmStatus = rxBuffer[7]; // 알람 상태[cite: 1]

    // 시리얼 출력
    Serial.println("\n[ 측정 결과 ]");
    Serial.print("알코올 농도: ");
    Serial.print(alcoholConcentration);
    Serial.println(" mg/100mL");

    // OLED 출력용 문자열 결정
    String statusStr = "";
    if (alarmStatus == 0x00) statusStr = "Normal";
    else if (alarmStatus == 0x01) statusStr = "Warn: Drunk";
    else if (alarmStatus == 0x02) statusStr = "DANGER!";

    // U8g2를 이용한 결과 화면 출력
    u8g2.clearBuffer();
    
    // 타이틀
    u8g2.setFont(u8g2_font_ncenB08_tr);
    u8g2.setCursor(0, 10);
    u8g2.print("Result:");
    
    // 알코올 농도 (크게 강조)
    u8g2.setFont(u8g2_font_ncenB14_tr);
    u8g2.setCursor(0, 32);
    u8g2.print(String(alcoholConcentration) + " mg");
    
    // 상태 및 재시작 안내
    u8g2.setFont(u8g2_font_ncenB08_tr);
    u8g2.setCursor(0, 48);
    u8g2.print("Status: " + statusStr);
    
    u8g2.setCursor(0, 62);
    u8g2.print("Press Btn to Reset");
    
    u8g2.sendBuffer();

  } else {
    updateOLED("Error", "Failed to read", "Press to Retry");
  }
}

// 상태 문자열 변환[cite: 1]
String getStateString(byte state) {
  switch (state) {
    case STATE_IDLE: return "Idle (0x31)[cite: 1]";
    case STATE_PREHEATING: return "Preheating (0x32)[cite: 1]";
    case STATE_WAITING_BLOW: return "Waiting Blow (0x33)[cite: 1]";
    case STATE_BLOWING: return "Blowing (0x34)[cite: 1]";
    case STATE_BLOW_INTERRUPTED: return "Blow Interrupted (0x35)[cite: 1]";
    case STATE_CALCULATING: return "Calculating (0x36)[cite: 1]";
    case STATE_READ_RESULT: return "Read Result (0x37)[cite: 1]";
    default: return "Unknown";
  }
}