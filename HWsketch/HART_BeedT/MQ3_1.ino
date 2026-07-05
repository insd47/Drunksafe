// MQ-3 아날로그 신호가 연결된 핀 설정
const int mq3AnalogPin = 34; // 배선표에 따라 GPIO 34 사용
// 측정된 아날로그 값을 저장할 변수
int sensorValue = 0; 
// 전압 값으로 변환하여 저장할 변수
float voltage = 0.0;
void setup() {
  // 시리얼 모니터 통신 시작 (보드레이트 115200)
  Serial.begin(115200);
  
  // ESP32의 ADC(아날로그-디지털 변환기) 해상도 설정 (기본 12비트: 0~4095)
  analogReadResolution(12);
  
  Serial.println("MQ-3 센서 예열 중입니다...");
  Serial.println("===========================");
  
  // 센서가 안정화될 때까지 잠시 대기 (실제 사용 시에는 센서 예열을 위해 몇 분 정도 켜두는 것이 좋습니다)
  delay(3000); 
}
void loop() {
  // 1. 센서 값 읽기 (0 ~ 4095 사이의 값)
  sensorValue = analogRead(mq3AnalogPin);
  
  // 2. 센서 값을 전압(V)으로 변환 (ESP32의 최대 측정 전압은 3.3V)
  // 전압 분배기(10k, 20k)를 거쳤으므로, 이 전압은 실제 MQ-3 출력 전압의 약 2/3 (66.6%) 수준입니다.
  voltage = (sensorValue * 3.3) / 4095.0;
  // 3. 실제 MQ-3 AOUT 전압 역산 (선택 사항)
  // 전압 분배 공식: Vout = Vin * (R2 / (R1 + R2)) -> Vin = Vout * ((R1 + R2) / R2)
  // R1 = 10k, R2 = 20k -> (10 + 20) / 20 = 1.5
  float originalVoltage = voltage * 1.5;
  // 4. 시리얼 모니터에 출력
  Serial.print("센서 측정값(ADC): ");
  Serial.print(sensorValue);
  
  Serial.print("\t ESP32 핀 전압: ");
  Serial.print(voltage);
  Serial.print(" V");
  Serial.print("\t MQ-3 원래 전압: ");
  Serial.print(originalVoltage);
  Serial.println(" V");
  // 0.5초마다 측정
  delay(500); 
}