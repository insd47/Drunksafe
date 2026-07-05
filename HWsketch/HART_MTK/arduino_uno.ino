const int PIN_INPUT = A0;           
const unsigned long interval = 10;  // 10ms 간격 = 100Hz 샘플링 주파수
unsigned long lastTime = 0;

void setup() {
  Serial.begin(115200);
}

void loop() {
  unsigned long currentTime = millis();

  if (currentTime - lastTime >= interval) {
    lastTime = currentTime;
    int rawSignal = analogRead(PIN_INPUT);
    
    // 파이썬으로 타임스탬프와 RAW 데이터를 쉼표로 분리해 전송
    Serial.print(currentTime);
    Serial.print(",");
    Serial.println(rawSignal);
  }
}