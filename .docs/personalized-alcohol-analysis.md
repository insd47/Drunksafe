# Personalized Alcohol Analysis Model

이 문서는 Drunksafe가 앱 개인화를 강점으로 만들기 위해 산출할 수 있는 데이터와 상태 판정 알고리즘을 정리한다.

핵심 결론은 다음과 같다.

- ZE29 호기 알코올 값은 BAC 추정의 주 입력으로 쓸 수 있다.
- 아날로그 PPG는 BAC를 직접 보정하기보다 측정 품질, 개인 생체 반응, 재측정 필요성, 회복 추세의 보조 신호로 써야 한다.
- 나이, 성별, 키, 몸무게는 이미 측정된 BrAC를 크게 보정하는 정보가 아니라 음주량 기반 사전 예측, 불확실성, 개인별 해독 시간 초기값에 쓰는 정보다.
- 운전 가능/불가 표시는 법적 판정처럼 보이면 안 된다. 앱에서는 `운전 금지`, `운전 비권장/재측정 필요`, `수치상 낮음`처럼 보수적인 상태로 표현한다.

## Current Inputs

현재 firmware가 안정적으로 제공할 수 있는 값은 다음이다.

| Source | Current data | Personalization value |
|--------|--------------|-----------------------|
| ZE29 alcohol module | `alcohol_mg_l_x1000` | BrAC, BAC 추정, sober ETA, risk state의 중심 입력 |
| Analog PPG on GPIO36 | BPM, IBI stddev, peak amplitude, stable flag, confidence, 20s/1m/5m trend | 착용/측정 품질, 음주 후 생체 반응, 개인 baseline 대비 변화량 |
| App context | recent measurements, sober baseline, elimination rate | 개인별 센서 zero 보정, 해독 속도, 상승/하강 phase 판단 |
| User profile | age, sex, height, weight, optional drink log, meal state | 음주량 기반 prior, 분해 시간 초기값, 개인화 문구 |

현재 pulse 구현은 별도 디지털 심박 모듈이 아니라 GPIO36의 아날로그 PPG 입력을 사용한다.

## Data Products

앱에서 보여줄 만한 개인화 산출물은 다음 순서로 구현하는 것이 좋다.

| Priority | Output | Description |
|----------|--------|-------------|
| P0 | `corrected_brac_mg_l` | sober baseline과 센서 오차를 반영한 현재 호기 알코올 추정값 |
| P0 | `bac_mid_percent`, `bac_upper_percent` | 중앙 BAC와 보수적 상한 BAC |
| P0 | `risk_state` | 안전/주의/위험 상태 |
| P0 | `drive_status` | 운전 금지/비권장/수치상 낮음 |
| P0 | `sober_eta_minutes` | 목표 BAC 아래로 내려갈 예상 시간 |
| P1 | `alcohol_phase` | 상승 중/하강 중/plateau/알 수 없음 |
| P1 | `recheck_after_minutes` | 다음 측정 권장 시간 |
| P1 | `measurement_quality` | 호기 품질, 센서 오차, pulse 안정성을 합친 신뢰도 |
| P1 | `personal_elimination_rate` | 사용자의 시간당 제거율 추정값 |
| P2 | `physiological_response_score` | 평소 안정시 BPM 대비 상승, PPG 불안정성, 회복 추세 |
| P2 | `morning_residual_alcohol_alert` | 전날 음주 후 다음날 잔류 가능성 경고 |
| P2 | `pattern_insights` | 주간 고위험 빈도, 평균 해독 시간, 재측정 준수율 |

## BAC Estimation

ZE29 값은 `mg/L x1000` 정수이므로 먼저 BrAC로 바꾼다.

```text
raw_brac_mg_l = alcohol_mg_l_x1000 / 1000.0
corrected_brac_mg_l = max(0, raw_brac_mg_l - sober_baseline_mg_l)
```

BrAC를 BAC로 환산할 때는 2100:1을 중앙값으로 쓰고, 위험 판정에는 더 보수적인 상한을 사용한다.

```text
bac_mid_percent = corrected_brac_mg_l * 0.21
bac_upper_percent = corrected_brac_upper_mg_l * 0.23
bac_milli_percent = round(bac_mid_percent * 1000)
```

ZE29 스펙상 `C < 0.400 mg/L` 구간은 `±0.050 mg/L`, `C >= 0.400 mg/L` 구간은 `±10%` 수준의 표시 정확도를 전제로 한다. 따라서 위험 상태는 항상 중앙값이 아니라 상한값으로 판정한다.

```text
sensor_error_mg_l =
  if raw_brac_mg_l < 0.400 then 0.050
  else raw_brac_mg_l * 0.10

corrected_brac_upper_mg_l =
  max(0, raw_brac_mg_l + sensor_error_mg_l - sober_baseline_low_mg_l)
```

`sober_baseline_low_mg_l`은 sober baseline의 하한이다. 예를 들어 앱이 완전 sober 상태에서 5회 이상 측정한 뒤 median과 MAD를 저장하고, 위험 판정에는 `median - MAD`를 사용한다.

## Personal Baseline

개인화의 첫 번째 강점은 절대 BAC 보정보다 "내 장치와 내 착용/호기 습관에서 0점이 어디인지"를 잡는 것이다.

Baseline 생성 조건:

- 사용자가 최근 12시간 이상 음주하지 않았다고 기록했다.
- ZE29 값이 낮고 안정적이다.
- PPG가 stable이고 peak amplitude가 최소 품질 기준을 넘는다.
- 같은 조건의 측정을 최소 5회 확보했다.

저장 값:

```text
sober_baseline_mg_l = median(sober measurements)
sober_baseline_mad_mg_l = median absolute deviation
resting_bpm_baseline = median(stable sober BPM)
normal_pulse_variability = median(sober IBI stddev)
```

## Elimination Rate

해독 시간은 한 번의 측정만으로 개인화하기 어렵다. 최근 측정 히스토리에서 하강 구간이 확인될 때만 개인별 제거율을 갱신한다.

갱신 조건:

- 최소 3개 이상의 신뢰 가능한 측정점이 있다.
- 측정 간격이 20분 이상이다.
- 전체 구간이 최소 45분 이상이다.
- BrAC 감소량이 센서 오차보다 충분히 크다.
- 최근 측정들이 상승 구간이 아니다.

추정 방법:

```text
rate_mg_l_per_hour = robust_negative_slope(recent_corrected_brac_points)
rate_mg_l_per_hour = clamp(rate_mg_l_per_hour, 0.048, 0.119)
```

이 범위는 BAC 제거율 `0.010%/h ~ 0.025%/h`를 BrAC 기준으로 바꾼 값이다. 사용자별 rate는 급하게 바꾸지 않고 exponential moving average로 천천히 갱신한다.

```text
personal_rate = 0.8 * previous_rate + 0.2 * new_session_rate
```

초기값은 보수적으로 `0.050 mg/L/h` 근처를 사용한다. 빠른 제거율을 가정하면 sober ETA가 과하게 짧아지므로 제품 안전성에 불리하다.

## Alcohol Phase

같은 BAC 값이라도 상승 중인지 하강 중인지가 중요하다. 앱은 최근 히스토리로 phase를 분류한다.

```text
if not enough reliable points:
  phase = unknown
else if latest_brac - previous_brac > noise_threshold:
  phase = rising
else if previous_brac - latest_brac > noise_threshold:
  phase = falling
else:
  phase = plateau
```

`rising` 또는 `unknown`이면 sober ETA를 확정적으로 보여주지 말고 "30분 후 재측정"을 우선 표시한다. 음주 직후에는 흡수 때문에 BAC가 더 올라갈 수 있다.

## Risk Algorithm

한국 서비스 기본값은 `legal_bac_limit_percent = 0.030`으로 둔다. 다만 이 값은 앱 정책 상수로 분리하고, 국가/운영 정책에 따라 바꿀 수 있게 한다.

```text
safe_target_percent = 0.010
legal_limit_percent = 0.030

if measurement_quality < 50:
  risk = caution
else if bac_upper_percent >= legal_limit_percent:
  risk = danger
else if phase == rising:
  risk = danger if bac_mid_percent >= 0.015 else caution
else if bac_upper_percent >= safe_target_percent:
  risk = caution
else:
  risk = safe
```

운전 상태는 risk보다 더 보수적으로 둔다.

```text
if risk == danger:
  drive_status = blocked
else if risk == caution or phase in [rising, unknown]:
  drive_status = not_recommended
else:
  drive_status = low_detected
```

앱 문구:

- `blocked`: "현재 수치상 운전 금지"
- `not_recommended`: "운전 비권장, 재측정 필요"
- `low_detected`: "수치상 낮음, 음주 후 운전은 권장하지 않음"

`운전 가능`이라는 단정 문구는 피한다.

## Sober ETA

ETA는 사용자가 이해하기 쉽게 보여주되 반드시 범위와 신뢰도를 같이 둔다.

```text
if phase == rising or phase == unknown:
  sober_eta = none
  recheck_after_minutes = 30
else:
  target = safe_target_percent
  eta_hours = max(0, bac_upper_percent - target) / elimination_percent_per_hour
  sober_eta_minutes = ceil(eta_hours * 60 + safety_buffer_minutes)
```

`safety_buffer_minutes`는 최소 15분, 측정 품질이 낮거나 pulse가 불안정하면 30분 이상을 둔다.

## Using Analog PPG

아날로그 PPG는 다음 용도로 쓰는 것이 현실적이다.

1. 측정 품질 점수
   - `stable == false`, `ibi_stddev_ms` 높음, `peak_amplitude` 낮음이면 결과 신뢰도를 낮춘다.
   - 손목 접촉이 약하거나 움직임이 큰 상태를 감지할 수 있다.

2. 개인 생체 반응
   - sober baseline 대비 BPM 상승량을 계산한다.
   - alcohol risk를 직접 올리기보다는 "몸이 아직 안정 상태로 돌아오지 않음" 같은 보조 설명에 사용한다.

3. 재측정 타이밍
   - alcohol 값이 낮아도 pulse가 baseline보다 크게 높고 불안정하면 `caution` 또는 `recheck_after_minutes`를 줄인다.

4. 장기 인사이트
   - 같은 BAC 수준에서 사용자의 BPM 상승이 점점 커지는지, 숙취 다음날 안정시 BPM이 높게 남는지 같은 개인 리포트를 만들 수 있다.

권장 파생값:

```text
pulse_delta_bpm = current_bpm - resting_bpm_baseline
pulse_instability = normalized(ibi_stddev_ms)
physiological_response_score =
  0.6 * normalized(pulse_delta_bpm) +
  0.4 * pulse_instability
```

이 점수는 BAC 보정에 직접 곱하지 않는다. 개인 컨디션 경고와 측정 신뢰도에 반영한다.

## BLE/App Model Direction

개인정보를 장치에 그대로 보내기보다 앱이 프로필을 해석한 파생 context를 보내는 방향이 낫다.

권장 context:

```text
AnalysisContext {
  phone_time_unix_ms
  recent_measurements
  sober_baseline_mg_l_x1000
  sober_baseline_mad_mg_l_x1000
  elimination_mg_l_per_hour_x1000
  legal_bac_limit_milli_percent
  safe_target_milli_percent
  resting_bpm_baseline
  risk_policy_version
}
```

앱 내부에만 둘 profile:

```text
UserProfile {
  age_years
  sex
  height_cm
  weight_kg
  usual_sleep_time
  medication_or_health_warning_flags
}
```

음주량을 사용자가 기록한다면 추가로 저장한다.

```text
DrinkLog {
  started_at
  ended_at
  drinks: [{ volume_ml, abv_percent }]
  meal_state
}
```

DrinkLog는 sensor 측정이 없을 때의 prior로만 사용하고, 실제 ZE29 측정값이 들어오면 측정값이 우선한다.

## AI Model Position

초기 버전에서 AI가 직접 `운전 가능`을 판정하는 구조는 피한다. 데이터가 부족하면 모델이 그럴듯한 숫자를 만들 뿐, 법적/안전 의미가 있는 정확도를 보장하기 어렵다.

현실적인 AI 적용 순서:

1. 규칙 기반 모델로 BAC 상한, phase, ETA, risk를 만든다.
2. 충분한 개인 히스토리가 쌓이면 앱에서 개인 elimination rate와 confidence를 보정한다.
3. 장기적으로는 온디바이스/앱 모델이 `measurement_quality`, `phase`, `eta_uncertainty`를 보정한다.

AI 출력은 단일 숫자가 아니라 분포 또는 신뢰구간이어야 한다.

```text
outputs = {
  bac_mid,
  bac_upper,
  eta_min,
  eta_max,
  confidence,
  reason_codes
}
```

## References

- Winsen ZE29A-C2H5OH product page: https://www.winsen-sensor.com/sensors/alcohol-sensor/ze29a-c2h5oh.html
- NHTSA drunk driving and BAC effects: https://www.nhtsa.gov/risky-driving/drunk-driving
- NIAAA standard drink reference: https://www.niaaa.nih.gov/alcohols-effects-health/what-standard-drink
- Korea Road Traffic Act, Article 44: https://www.law.go.kr/법령/도로교통법/제44조
- FTC consumer breathalyzer accuracy enforcement example: https://www.ftc.gov/news-events/news/press-releases/2017/01/breathometer-marketers-settle-ftc-charges-misrepresenting-ability-accurately-measure-users-blood
