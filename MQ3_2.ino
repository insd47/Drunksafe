#include <math.h>
const int mq3AnalogPin = 34; 
// 캘리브레이션용 변수
float vCleanAir = 0.0; 
float Ro = 0.0;
void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  
  Serial.println("=========================================");
  Serial.println("센서 예열 및 초기화 중...");
  Serial.println("※ 주의: 센서 주변에 알코올이 없는 '맑은 공기' 상태를 유지해주세요!");
  Serial.println("=========================================");
  
  // 실제 사용 시 센서 예열을 위해 3~5분 정도 켜두는 것이 좋으나, 여기선 5초 대기
  delay(5000); 
  
  // [캘리브레이션] 맑은 공기에서의 기준 전압 측정 (50번 측정해서 평균 내기)
  long sum = 0;
  for(int i = 0; i < 50; i++) {
    sum += analogRead(mq3AnalogPin);
    delay(100);
  }
  float avgAdc = sum / 50.0;
  float avgVoltage = (avgAdc * 3.3) / 4095.0;
  
  // 전압 분배 회로(10k, 20k)를 거치기 전의 원래 센서 전압 복원 (* 1.5배)
  vCleanAir = avgVoltage * 1.5; 
  // 계산 오류 방지 (전압이 0이거나 5V일 때 방지)
  vCleanAir = constrain(vCleanAir, 0.01, 4.99);
  // 맑은 공기 상태일 때의 Rs 계산 (부하 저항 RL은 나중에 약분되므로 생략)
  float RsClean = (5.0 / vCleanAir) - 1.0; 
  
  // 데이터시트 상 맑은 공기에서 Rs/Ro 비율은 약 60
  Ro = RsClean / 60.0; 
  Serial.print("✅ 초기화 완료! 기준 전압: ");
  Serial.print(vCleanAir);
  Serial.println(" V");
  Serial.println("이제 알코올(술, 손소독제 등)을 가까이 대보세요.");
}
void loop() {
  int sensorValue = analogRead(mq3AnalogPin);
  float voltage = (sensorValue * 3.3) / 4095.0;
  float originalVoltage = voltage * 1.5;
  // 극단적인 값 필터링 (0~5V 사이 유지)
  originalVoltage = constrain(originalVoltage, 0.01, 4.99);
  float BAC = 0.0;
  
  // 센서 전압이 맑은 공기 상태일 때보다 유의미하게 높아졌을 때만 알코올로 감지
  if(originalVoltage > vCleanAir + 0.1) { 
    
    // 1. 현재 센서의 Rs 저항 비례값 계산
    float Rs = (5.0 / originalVoltage) - 1.0;
    
    // 2. Rs/Ro 비율 계산
    float ratio = Rs / Ro;
    
    // 3. 데이터시트 그래프 근사치 공식 적용 -> 호흡 중 알코올 농도 (mg/L)
    // (이 상수값들은 MQ-3 센서 특성 곡선에서 추출된 근사치입니다)
    float mgL = 0.4 * pow(ratio, -1.431);
    
    // 4. 호흡 알코올을 혈중 알코올 농도(BAC %)로 변환
    BAC = mgL * 0.2;
  }
  // 시리얼 모니터에 보기 좋게 출력
  Serial.print("현재 전압: ");
  Serial.print(originalVoltage);
  Serial.print(" V  |  ");
  
  Serial.print("추정 혈중 알코올 농도(BAC): ");
  Serial.print(BAC, 4); // 소수점 4자리까지 출력
  Serial.println(" %");
  delay(1000); // 1초마다 측정
}
