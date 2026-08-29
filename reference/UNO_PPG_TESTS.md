# Arduino Uno PPG 비교 테스트

Arduino Uno R3 / ATmega328P용입니다. 두 파일을 **각각 별도로 업로드**하세요.

| 스케치 | 필터 / peak 높이 기준 |
|---|---|
| [drunksafe_pulse_sensor_uno](drunksafe_pulse_sensor_uno/drunksafe_pulse_sensor_uno.ino) | 첨부 스케치의 EMA DC 제거 + EMA 저역통과 / envelope × 1.15, 최소 1.5 |
| [ppg_butterworth_uno_test](ppg_butterworth_uno_test/ppg_butterworth_uno_test.ino) | Rust params.rs의 Butterworth 계수 / 기존 Uno 고정 threshold 5 |

Downloads의 원본은 변경하지 않았습니다. 전자는 ESP32용 첨부 파일을 Uno용으로 이식한 개선본입니다.
비교를 위해 필터 외 측정 로직은 동일하게 유지합니다. prominence 검출을 새로 추가한 것은 아닙니다.
첨부 파일의 12초 측정 후 손가락 제거 대기는 연속 측정/자동 재수집으로 변경했습니다.
BLE, 버튼, 디스플레이, LED 및 알코올 센서는 사용하지 않습니다.

## 배선과 실행

- 센서 OUT/SIGNAL → Uno A0
- 센서 GND → Uno GND
- 센서 VCC → 해당 센서가 지원하는 전원(기존에 3.3V를 사용했다면 Uno 3.3V 사용).
  보드가 Uno라고 센서 전원을 자동으로 5V로 바꾸지 마세요.
- 입력 전압은 Uno ADC 허용 범위 내여야 합니다.
- Arduino IDE에서 각 스케치 폴더 안의 같은 이름의 .ino를 열고 **Arduino Uno**를 선택합니다.
- Serial Monitor: **115200 baud**.

## 출력

기본적으로 1초마다 아래 CSV 상태를 출력합니다.

```text
R,ms,state,bpm,valid_ibi/total,minute_bpm,minute_age_ms,last_reset,missed
```

- state: waiting(신호 확인), warmup(필터 안정화), collecting(유효 IBI 부족),
  no_peaks(3초 이상 첫 peak 미검출), valid(추정값 유효).
- bpm: 최근 15초 내 유효 IBI 중앙값으로 계산. 조건 미달/신호 상실 시 NA.
- valid_ibi/total: 현재 window의 중앙값 주변 ±25%를 통과한 IBI 수 / 전체 후보 IBI 수.
- minute_bpm: 마지막 **완료된** 1분의 대표값. 현재 순간 BPM이 아니며 데이터 부족 시 NA.
- minute_age_ms: 마지막으로 완료된 유효 1분 결과 이후 경과시간.
- last_reset: 마지막 초기화 원인. 0=시작, 1=신호 범위/포화/샘플 수 부족,
  2=peak 공백 또는 너무 긴 IBI, 3=raw 급변, 4=샘플링 누락.
  정상 회복 후에도 이전 초기화 원인은 남습니다.
- missed: 10ms deadline을 한 주기 이상 놓친 샘플 누적 수.

1초마다 R 출력과 시간을 나누어 진단 행도 출력합니다:

```text
Q,quality,raw,range,samples,clipped,filtered,threshold,resets
```

- quality: pending(첫 window 대기), ok, flat(raw 변화량 3 미만),
  clipped(ADC 포화 5% 초과), sparse(평균 80Hz 미만).
- range/samples/clipped: 마지막 완료된 약 1초 window의 raw 최대-최소, 샘플 수, 포화 샘플 수.
- raw/filtered/threshold: 현재 ADC 값, 필터 출력, peak 높이 기준.
- resets: 초기화/IBI 재수집 횟수. 계속 증가하면 R의 last_reset도 확인하세요.
- no_peaks + quality=ok라면 raw가 움직이지만 peak 기준을 통과하지 못하는 경우 등을 의심할 수 있습니다.
  filtered는 한 시점 값이므로 진폭 확인에는 선택적 S 파형 출력도 사용하세요.

파형이 필요하면 OUTPUT_RAW_SIGNAL을 true로 바꿉니다.
`S,ms,raw,filtered` 행이 최대 20Hz로 추가됩니다(상태 출력 시 한 번 생략).
실제 ADC 샘플링과 필터는 항상 100Hz입니다. 모든 100Hz raw를 저장하는 용도는 아닙니다.
기존 Python 2열 raw 전용 파서와 형식이 다르므로 그대로 연결하지 마세요.

## 계산과 재착용

1. raw 범위와 포화 비율이 양호한 1초 구간 1개를 확인합니다.
2. 필터를 초기화하고 2초간 안정화를 기다립니다. Butterworth는 초기 raw의 상수 offset만 제거하며 계수는 그대로입니다.
3. 개별 IBI 334~1500ms만 수집합니다(목표 BPM 범위 40~180).
4. 최근 15초 내 IBI를 매번 다시 평가합니다. 유효 IBI 8개 이상, 유효 IBI 합계 8초 이상,
   후보 대비 유효 비율 75% 이상일 때 BPM을 출력합니다.
5. 검출된 peak 이후 공백이 1.6초를 넘으면 BPM/IBI/1분 기록을 즉시 무효화하되,
   필터는 유지하고 collecting 상태에서 새 peak를 기다립니다. 첫 peak가 없는 상태는
   타임아웃으로 반복 초기화하지 않습니다.
6. flat 첫 window에는 결과만 무효화하고, 두 번째 연속 flat window에서 waiting으로 돌아갑니다.
   ADC 포화/샘플 부족은 즉시 waiting으로 돌아갑니다.
7. 50ms 미만의 짧은 샘플링 지연은 missed에만 집계합니다. 50ms 이상 지연은 전체 재수집합니다.
   어느 경우에도 과거 시점의 가짜 샘플을 만들어 따라잡지 않습니다.

빠른 BPM도 순간값은 아닙니다. 보통 최초 결과에 약 11~18초가 필요하며, 변화가 15초 window에
반영되는 동안 일시적으로 collecting이 될 수 있습니다. 충분한 새 데이터를 얻은 후 출력합니다.
이전 BPM을 기준으로 새 BPM을 제한하지 않으므로 새로운 심박수에 영구 고정되는 문제를 피합니다.

## 1분 대표값

- 서로 겹치지 않는 10초 구간 6개를 만듭니다.
- 구간당 유효 IBI 5개 이상, 합계 7초 이상, 유효 비율 75% 이상이어야 합니다.
- 한 구간의 IBI가 다른 구간에도 중복 집계되지 않도록 IBI 전체가 그 구간 안에 있어야 합니다.
- 유효 구간 4개 이상, 처음/마지막 20초에 각각 유효 구간 존재,
  연속된 무효 구간 2개 없음 조건을 만족할 때 구간 BPM들의 중앙값을 출력합니다.
- 접촉 상실/재착용이 발생하면 1분 수집도 새로 시작합니다.
- 2~3분 이동평균 및 음주 판정은 이 단독 테스트 스케치에는 포함하지 않습니다.

## 주의 및 검증

신호 크기/포화/급변 기반 접촉 판정은 추정입니다. 주기적인 미착용 잡음, 움직임, 접촉 압력 변화가
실제 맥박처럼 보일 수 있습니다. 모든 임계값은 실측 튜닝용이며 의료적으로 검증된 판정 기준이 아닙니다.
신호가 약하면 먼저 raw/filtered를 확인하고 MIN_SIGNAL_RANGE 또는 필터별 threshold를 조정하세요.
기본 IBI 범위 밖 심박수는 측정 불가로 처리합니다.

PC 회귀 테스트는 실제 .ino를 Arduino API shim으로 컴파일합니다.
Visual Studio C++ 도구가 설치된 Windows에서 `reference\tests\uno_ppg\run_tests.cmd`를 실행하세요.
두 peak만 존재하는 경우, 긴 IBI, 재착용, 60→90 변화, 중앙값 이상치 제외, minute coverage,
millis rollover, 합성 파형, 샘플링 누락을 검사합니다.
이 테스트는 실제 AVR의 실행 시간이나 센서의 물리적 성능을 보장하지 않습니다.
