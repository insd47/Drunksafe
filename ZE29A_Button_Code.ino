// ==========================================
// ZE-29A 설명서 기반 음주측정기 코드 (버튼 작동 버전)
// ==========================================
// [배선 방법 - 암암 케이블 직결]
// 1. 빨간선(Vin)  -> ESP32의 VIN (또는 5V) 핀
// 2. 검은선(GND)  -> ESP32의 GND 핀
// 3. 노란선(TXD)  -> ESP32의 16 번 핀 (RX2)
// 4. 초록선(RXD)  -> ESP32의 17 번 핀 (TX2)
// 5. 물리 버튼    -> ESP32의 0 번 핀 & GND 핀에 연결

#define RXD2 16
#define TXD2 17
const int BUTTON_PIN = 0; // 시작 버튼을 꽂을 핀 번호 (팀원 배선도 기준 0번)

// 센서 제어용 명령어들 (설명서 참조)
byte cmdState[9]  = {0xFF, 0x01, 0x85, 0x00, 0x00, 0x00, 0x00, 0x00, 0x7A}; // 상태 쿼리
byte cmdResult[9] = {0xFF, 0x01, 0x86, 0x00, 0x00, 0x00, 0x00, 0x00, 0x79}; // 결과 읽기
byte cmdStart[9]  = {0xFF, 0x01, 0x87, 0x32, 0x00, 0x00, 0x00, 0x00, 0x46}; // 예열(0x32)로 강제 전환
byte cmdIdle[9]   = {0xFF, 0x01, 0x87, 0x31, 0x00, 0x00, 0x00, 0x00, 0x47}; // 대기(0x31)로 강제 전환

byte lastState = 0x00;
unsigned long lastPollTime = 0;

void setup() {
  Serial.begin(115200);
  Serial2.begin(9600, SERIAL_8N1, RXD2, TXD2); 
  
  // 버튼 핀 설정 (내부 풀업 저항 사용)
  pinMode(BUTTON_PIN, INPUT_PULLUP); 
  
  Serial.println("\n=====================================");
  Serial.println(" 📖 공식 설명서 기반 음주측정기 시스템 (버튼 버전)");
  Serial.println(" [암암 케이블 직결: RX(16), TX(17) 사용]");
  Serial.println("=====================================\n");
}

void loop() {
  // --- [버튼 작동 로직] ---
  // 대기 상태(0x31)일 때 버튼(0번 핀)이 눌리면(LOW) 예열(0x32) 명령을 보냄!
  if (digitalRead(BUTTON_PIN) == LOW && lastState == 0x31) {
    Serial.println("\n🔘 버튼이 눌렸습니다! 측정(예열)을 시작합니다...");
    Serial2.write(cmdStart, 9);
    delay(500); // 버튼 중복 눌림 방지 (디바운스)
  }

  // 1. 0.5초마다 센서에게 상태(0x85)를 묻습니다.
  if (millis() - lastPollTime > 500) {
    lastPollTime = millis();
    Serial2.write(cmdState, 9);
  }

  // 2. 센서가 보낸 대답을 읽어들입니다.
  while (Serial2.available()) {
    if (Serial2.read() == 0xFF) { // 패킷의 시작(0xFF) 발견
      byte packet[9];
      packet[0] = 0xFF;
      
      // 나머지 8바이트를 읽어옵니다. (통신 꼬임 방지 타임아웃 적용)
      unsigned long startTime = millis();
      int index = 1;
      while (index < 9 && millis() - startTime < 100) {
        if (Serial2.available()) {
          packet[index++] = Serial2.read();
        }
      }
      
      // 정상적으로 9바이트를 다 읽었고, 체크섬이 맞다면
      if (index == 9 && checkSum(packet) == packet[8]) {
        
        // ======================================
        // 응답 A: 센서 상태 정보 (0x85)
        // ======================================
        if (packet[1] == 0x85) {
          byte state = packet[2]; // 현재 상태 코드 (0x31 ~ 0x37)
          
          // 상태가 바뀌었을 때만 화면에 출력
          if (state != lastState) {
            lastState = state;
            switch(state) {
              case 0x31: Serial.println("[상태] 💤 대기 중... 측정하려면 시작 버튼(0번 핀)을 눌러주세요."); break;
              case 0x32: Serial.println("[상태] 🌡️ 예열 중입니다. (약 10초 소요)..."); break;
              case 0x33: Serial.println("\n▶▶▶ 숨을 들이마시고 '후~' 하고 4초 이상 길게 부세요! ◀◀◀\n"); break;
              case 0x34: Serial.println("[감지] 🌬️ 바람이 들어옵니다! 멈추지 말고 계속 부세요!"); break;
              case 0x35: Serial.println("[경고] ❌ 바람이 너무 약하거나 중간에 끊겼습니다."); break;
              case 0x36: Serial.println("[분석] 🔄 불기 완료! 알코올 농도를 분석 중입니다..."); break;
              case 0x37: Serial.println("[완료] ✅ 분석 완료! 결과를 불러옵니다..."); break;
            }
          }
          
          // 상태에 따른 자동 액션
          if (state == 0x31) {
            // 기존에는 자동으로 예열을 시작했지만, 이제 버튼을 누를 때까지 가만히 대기합니다.
          }
          else if (state == 0x37) {
            // 계산이 끝났으면(0x37), 결과값을 당장 내놓으라고(0x86) 명령!
            Serial2.write(cmdResult, 9);
          }
        }
        
        // ======================================
        // 응답 B: 알코올 농도 결과 정보 (0x86)
        // ======================================
        else if (packet[1] == 0x86) {
          int value = (packet[2] << 8) | packet[3]; // 농도 값 (High + Low)
          float mg_100ml = (float)value;
          float bac = mg_100ml / 1000.0; // mg/100ml 단위를 % 단위(BAC)로 변환
          
          byte alarm = packet[6]; // 경보 상태
          
          Serial.println("\n=====================================");
          Serial.print(" 🍺 측정된 알코올 농도: "); Serial.print(mg_100ml, 0); Serial.println(" mg/100ml");
          Serial.print(" 🚨 혈중 알코올 농도(BAC): "); Serial.print(bac, 4); Serial.println(" %");
          
          if (alarm == 0x00) {
            Serial.println(" ✅ 결과: 정상 (알코올 미감지)");
          } else if (alarm == 0x01) {
            Serial.println(" ⚠️ 결과: 음주 감지 (주의 수준)");
          } else if (alarm == 0x02) {
            Serial.println(" 🚫 결과: 만취 (위험 수준)");
          }
          Serial.println("=====================================\n");
          
          // 측정이 모두 끝났으므로, 센서를 다시 초기 대기 상태(0x31)로 강제 복귀시킵니다.
          Serial2.write(cmdIdle, 9);
          lastState = 0x00; // 다음번 대기 메시지가 화면에 뜨도록 리셋
        }
      }
    }
  }
}

// 데이터 위변조 방지용 체크섬 계산 함수
byte checkSum(byte *packet) {
  byte sum = 0;
  for (int i = 1; i < 8; i++) sum += packet[i];
  sum = (~sum) + 1;
  return sum;
}
