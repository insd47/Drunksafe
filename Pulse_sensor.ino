const int PPG_PIN = 36;    // 센서 아날로그 핀 (사용 환경에 맞게 수정하세요)
const int BUTTON_PIN = 2;  // 버튼 스위치가 연결된 GPIO 핀
const int SPEAKER_PIN = 23; // 스피커가 연결된 GPIO 핀
const int VIBRATION_PIN = 22; // 진동 모터가 연결된 GPIO 핀
int patternState = 0; 
unsigned long patternTimer = 0;

// 디바운싱 변수
unsigned long lastDebounceTime = 0;
unsigned long debounceDelay = 50;
unsigned long initime, endtime = 0;
int lastButtonState = HIGH; 
int buttonState = HIGH;
bool buttonTriggered = false;

// 100Hz 샘플링 타이머
unsigned long lastSampleTime = 0;
const unsigned long sampleInterval = 10;

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP); 
  pinMode(SPEAKER_PIN, OUTPUT); 
  pinMode(VIBRATION_PIN, OUTPUT); 
}

void beep(int type) {
    switch (type) {
        case 1:
            digitalWrite(SPEAKER_PIN, HIGH);
            break;
        case 2:
            digitalWrite(SPEAKER_PIN, LOW);
            break;
        default:
            digitalWrite(SPEAKER_PIN, HIGH);
            break;
    }
}

void vibe(int type) {
     switch (type) {
        case 1:
            digitalWrite(VIBRATION_PIN, LOW);
            break;
        case 2:
            digitalWrite(VIBRATION_PIN, HIGH);
            break;
        default:
            digitalWrite(VIBRATION_PIN, LOW);
            break;
    }
}

void displaywrite() {

}

void loop() {
  int reading = digitalRead(BUTTON_PIN);

  if (Serial.available() > 0) {
    String command = Serial.readStringUntil('\n');
    command.trim(); // 공백 제거
// 패턴이 실행 중이 아닐 때(0)만 새로운 WARN을 받아들여 패턴 시작
    if (command == "WARN" && patternState == 0) {
        patternState = 3;        
        patternTimer = millis(); 
        beep(2); vibe(2);
    }

    if (command == "other" ) {
      displaywrite(); // 디스플레이 상호작용을 위한 임시 코드
    }
  }
  
  // 2. 논블로킹 상태 머신 (switch-case를 이용한 시간 제어)
  switch (patternState) {
    case 1: // 첫 번째 ON (100ms 대기)
      if (millis() - patternTimer >= 100) {
        patternState = 2;        
        patternTimer = millis(); 
        beep(1); vibe(1);         
      }
      break;

    case 2: // 중간 OFF (50ms 대기)
      if (millis() - patternTimer >= 50) {
        patternState = 3;        
        patternTimer = millis();
        beep(2); vibe(2);        
      }
      break;

    case 3:
      if (millis() - patternTimer >= 100) {
        patternState = 0;        
        beep(1); vibe(1);        
      }
      break;
  }
  // 추후 경고 종류에 따른 진동및 부저 작동방식 전환 가능

  if (reading != lastButtonState) {
    lastDebounceTime = millis();
  }
  
  if ((millis() - lastDebounceTime) > debounceDelay) {
    if (reading != buttonState) {
      buttonState = reading;
      
      // 상태가 LOW(버튼이 눌림)로 변할 때 딱 한 번만 트리거 플래그 활성화
      if (buttonState == LOW) {
        buttonTriggered = true;
      }
    }
  }
  lastButtonState = reading;

  // 2. 100Hz 주기로 데이터 전송
  if (millis() - lastSampleTime >= sampleInterval) {
    lastSampleTime = millis();

    int sum = 0;

    sum += analogRead(PPG_PIN);
    sum += analogRead(PPG_PIN);
    sum += analogRead(PPG_PIN);
    sum += analogRead(PPG_PIN);
    int ppgValue = sum >> 2; // 4로 나누기 (평균값 계산)

    // 전송 형식: "타임스탬프,raw값,버튼플래그(0또는1)"
    Serial.print(millis());
    Serial.print(",");
    Serial.print(ppgValue);
    Serial.print(",");
    Serial.println(buttonTriggered ? 1 : 0);

    // 한 번 '1'을 전송했으면 플래그를 다시 '0'으로 초기화
    if (buttonTriggered) {
      buttonTriggered = false;
    }
  }
}
