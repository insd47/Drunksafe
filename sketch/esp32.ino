const int PIN_INPUT = 32;
int rawSignal;
int threshold = 530; 

// 펄스 감지용 변수
unsigned long lastBeatTime = 0;
unsigned long sampleCounter = 0;
int beatIntervals[10];
int beatIndex = 0;
bool isPulse = false;
int myBPM = 0; 

// ⭐ [20초 단축 설정] 수집 공간 및 최종 선별 개수 최적화
const int REPORT_INTERVAL = 20000;  // 보고 주기: 20초 (20000ms)
const int MAX_TOTAL_DATA = 200;     // 20초 동안 모을 수 있는 최대 유효 데이터 공간
const int TARGET_N = 20;            // 표준편차가 최소가 되게 최종 선별할 핵심 데이터 개수 (20개)

int bpmHistory[MAX_TOTAL_DATA];     // 20초간 수집된 모든 유효 BPM 저장소
int totalCollected = 0;             // 실제 수집된 데이터 개수
unsigned long reportTimer = 0;      // 20초 타이머

// 비동기 분산 연산 제어용 변수
bool startCalculation = false;
int calcState = 0;                  
int sortProgress = 0;               

// 최종 결과 변수
float minStdDev = 999999.0;
float finalAvgBPM = 0.0;
int bestSamples[TARGET_N];          

void setup() {
  Serial.begin(115200);
  analogReadResolution(10);
  for(int i=0; i<10; i++) beatIntervals[i] = 900; 
  
  reportTimer = millis(); // 20초 타이머 시작
}

void loop() {
  // 1. 하드웨어 샘플링 (10ms 주기 유지)
  rawSignal = analogRead(PIN_INPUT);
  sampleCounter += 10; 

  // 2. 실시간 BPM 연산 및 전수 수집
  if ((rawSignal > threshold) && (isPulse == false) && (sampleCounter - lastBeatTime > 300)) {
    isPulse = true;
    unsigned long ibi = sampleCounter - lastBeatTime; 
    lastBeatTime = sampleCounter;

    beatIntervals[beatIndex] = ibi;
    beatIndex = (beatIndex + 1) % 10;

    long runningTotal = 0;
    for(int i=0; i<10; i++) runningTotal += beatIntervals[i];
    long avgIbi = runningTotal / 10;

    if (avgIbi > 0) {
      int calculatedBPM = 60000 / avgIbi; 
      
      // 유효 심박 범위 검사
      if(calculatedBPM > 45 && calculatedBPM < 150) {
        myBPM = calculatedBPM; 
        
        // 20초 연산이 진행 중이 아닐 때만 배열에 누적
        if (totalCollected < MAX_TOTAL_DATA && !startCalculation) {
          bpmHistory[totalCollected] = myBPM;
          totalCollected++;
        }
      }
    }
  }

  if (rawSignal < threshold) {
    isPulse = false;
  }

  // 3. ⭐ 20초 타이머 트리거
  if (millis() - reportTimer >= REPORT_INTERVAL) {
    reportTimer = millis();
    
    if (totalCollected >= TARGET_N) { 
      // 데이터가 선별 타겟(20개) 이상이므로 정상 비동기 연산 시작
      startCalculation = true;
      calcState = 0;        
      sortProgress = 0;     
      minStdDev = 999999.0;
    } 
    else if (totalCollected > 5) {
      // 만약 손가락 움직임 등으로 20초간 모인 데이터가 20개 미만(예: 12개)이더라도
      // 건너뛰지 않고 현재 모인 전체 개수만큼만 매칭해서 무조건 결과를 냅니다.
      Serial.println("[알림] 데이터 일부 누락으로 현재 수집된 데이터 기반 최적화를 수행합니다.");
      startCalculation = true;
      calcState = 0;
      sortProgress = 0;
      minStdDev = 999999.0;
    }
    else {
      Serial.println("[에러] 20초 동안 센서 인식이 거의 되지 않았습니다. 손가락을 밀착해 주세요.");
      totalCollected = 0;
    }
  }

  // 4. 비동기 분산 연산 상태 머신 (10ms 샘플링 방해 방지)
  if (startCalculation) {
    // 동적으로 선별 개수 결정 (기본 20개, 데이터 부족시 수집된 전체 개수)
    int currentTargetN = (totalCollected < TARGET_N) ? totalCollected : TARGET_N;

    switch (calcState) {
      
      case 0: // [1단계] 20초간 모인 데이터를 오름차순 정렬 (루프 분산처리)
        for (int step = 0; step < 10; step++) { // 20초 데이터는 양이 적어 더 빠르게 정렬됩니다.
          if (sortProgress < totalCollected - 1) {
            for (int i = 0; i < totalCollected - 1; i++) {
              if (bpmHistory[i] > bpmHistory[i + 1]) {
                int temp = bpmHistory[i];
                bpmHistory[i] = bpmHistory[i + 1];
                bpmHistory[i + 1] = temp;
              }
            }
            sortProgress++;
          } else {
            calcState = 1; 
            sortProgress = 0; 
            break;
          }
        }
        break;

      case 1: // [2단계] 슬라이딩 윈도우로 이상치(양끝 노이즈)를 제외한 최소 표준편차 구간 선별
        if (sortProgress <= totalCollected - currentTargetN) {
          int startIdx = sortProgress;
          
          long sum = 0;
          for (int i = 0; i < currentTargetN; i++) {
            sum += bpmHistory[startIdx + i];
          }
          float avg = (float)sum / (float)currentTargetN;

          float varianceSum = 0;
          for (int i = 0; i < currentTargetN; i++) {
            varianceSum += pow(bpmHistory[startIdx + i] - avg, 2);
          }
          float stdDev = sqrt(varianceSum / (float)currentTargetN);

          // 가장 조밀하게 모여있는 정상 맥박 구간 확보
          if (stdDev < minStdDev) {
            minStdDev = stdDev;
            finalAvgBPM = avg;
            for (int i = 0; i < currentTargetN; i++) {
              bestSamples[i] = bpmHistory[startIdx + i];
            }
          }
          sortProgress++; 
        } else {
          calcState = 2; 
        }
        break;

      case 2: // [3단계] 20초 최종 평균 결과 보고
        Serial.println("\n==================================================");
        Serial.println("               20초 주기 심박 보고서              ");
        Serial.println("==================================================");
        Serial.print("▶ 20초간 수집된 총 데이터 수: "); Serial.print(totalCollected); Serial.println(" 개");
        Serial.print("▶ 그 중 엄선된 유효 샘플 수: "); Serial.print(currentTargetN); Serial.println(" 개");
        Serial.print("▶ 선별된 그룹의 미세 표준편차: "); Serial.println(minStdDev);
        Serial.print("▶ ⭐ 최종 정제된 평균 심박수: "); Serial.print(finalAvgBPM, 1); Serial.println(" BPM");
        Serial.println("--------------------------------------------------");
        Serial.print("▶ 필터링을 통과한 유효 데이터: ");
        for (int i = 0; i < currentTargetN; i++) {
          Serial.print(bestSamples[i]); Serial.print(" ");
        }
        Serial.println("\n==================================================\n");

        // 다음 20초 측정을 위해 버퍼 리셋
        totalCollected = 0;
        startCalculation = false;
        break;
    }
  }

  delay(10); // 10ms 주기 칼같이 유지
}