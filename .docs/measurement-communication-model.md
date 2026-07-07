# Drunksafe Measurement Model

현재 모델링 원칙은 단순하다.

- 센서별 세부 모델은 `devices` 안에 둔다.
- BLE는 transport envelope 역할만 한다.
- 간단한 동작은 소유 모듈에서 한 단어 함수로 노출한다.
- 확정되지 않은 데이터는 BLE 공통 모델에 미리 넣지 않는다.
- `main.rs`는 logger와 device를 초기화한 뒤 runtime loop를 직접 닫아 가진다.
- 보드 배선은 `devices::init()`이 소유하고, 각 device는 custom transport나 핀 tuple이 아니라 concrete HAL driver를 받는다.
- 현재 runtime은 단일 루프이므로 device state는 plain mutable state로 유지한다. task/thread 공유가 실제로 필요해지는 시점에만 shared state를 도입한다.
- 측정 세션 sequence는 `main.rs`의 runtime loop가 로컬 상태로 소유한다. BLE 모델에는 transport DTO만 둔다.
- snapshot은 필요할 때 사용처에서 각 device를 직접 호출한다. 별도 `Snapshot` 집계 모델은 두지 않는다.

## Trigger Device

위치: `firmware/src/devices/trigger/`

공개 액션:

- `TriggerDevice::new(pin)`: BOOT 버튼 GPIO0를 input pull-up으로 설정한다.
- `trigger.pressed()`: 버튼이 새로 눌린 순간에만 `true`를 반환한다.

버튼 trigger는 테스트용 입력이다. 프로덕션 흐름은 주기적 pulse 측정 중 위험 신호가 확인되면 디스플레이와 BLE를 통해 알코올 측정 필요 알림을 보내는 방향으로 확장한다.

## Alcohol Device

위치: `firmware/src/devices/alcohol/`

공개 액션:

- `AlcoholDevice::new(uart, tx, rx)`: `devices::init()`이 구성한 9600 8N1 UART와 TX/RX 핀을 ZE29 device handle로 감싼다.
- `device.test()`: `0x86` read test results 명령으로 현재 알코올 농도를 읽는다.
- `device.status()`: `0x85` query module status 명령으로 모듈 상태 코드를 읽는다.
- `device.work(wake)`: `0x87` switch module working status 명령으로 센서 모듈의 wake 상태를 전환한다. 공개 매뉴얼의 payload 정의가 상세하지 않아 현재 firmware에서는 `true`를 `0x01`, `false`를 `0x00`으로 캡슐화한다.

구조:

- `command`: ZE29 명령 코드와 command별 request payload factory
- `protocol`: 9 byte request/response frame
- `checksum`: ZE29 checksum 생성과 검증
- `channel`: async UART request/response 처리
- `status`: 모듈 상태 코드 모델
- `error`: alcohol device 전용 오류 타입

SOLID 관점:

- `protocol`은 frame encode/decode만 담당한다.
- `channel`은 UART I/O와 timeout만 담당한다.
- `ResponseFrame`은 command별 response struct를 만들지 않고 공통 payload 해석을 담당한다.
- `AlcoholDevice`는 concrete `UartDriver`를 소유하므로 ZE29 read/write 호출과 frame 처리 책임이 alcohol device 안에 머문다.
- UART peripheral/TX/RX 핀 배선과 baudrate 설정은 `devices::init()`에서 관리한다.

## Pulse Device

위치: `firmware/src/devices/pulse/`

공개 액션:

- `PulseDevice::new(adc, pin)`: `devices::init()`이 구성한 ADC1/GPIO36 입력과 pulse algorithm state를 묶는다.
- `device.reset()`: 새 측정 세션 시작 시 filter와 sample buffer를 초기화한다.
- `device.sample(elapsed_ms)`: GPIO36에서 PPG ADC 값을 읽고 5초 분석 주기마다 optional analysis를 반환한다.
- `device.analyze()`: 마지막 analysis를 조회한다.

`origin/modules`와 `origin/modules-fixed`의 `ppg_processor.py`는 동일하다. 적용 기준은 더 명시적인 `origin/modules-fixed`로 둔다. 핵심은 100Hz PPG 입력에 대한 0.7-3.5Hz 2차 Butterworth band-pass streaming filter, 10초 시작 지연 후 5초마다 분석, peak threshold 50, 최소 peak distance 300ms, IBI 표준편차 200ms 초과 시 불안정 처리, 20초/1분/5분 이동평균 feature다. peak distance 충돌은 더 큰 peak를 남기고, sample cadence jitter는 warning으로만 기록한다. 세션이 바뀔 때는 `device.reset()`을 먼저 호출한다.

구조:

- `params`: sampling cadence, warm-up, peak threshold, trend window 같은 튜닝 값
- `algorithm`: peak detection, IBI/BPM/stability 계산
- `filter`: origin/modules-fixed 기준 Butterworth streaming filter
- `state`: filter, sample window, moving average, last analysis
- `services`: ADC PPG sample read, algorithm state handle
- `crate::utils::math`: 평균, 표준편차, 반올림 같은 순수 유틸리티

## ZE29 Protocol

공식 매뉴얼 기준:

- UART: 9600 baud, 8 data bits, 1 stop bit, parity/check byte 없음
- Frame length: 9 bytes
- Start byte: `0xFF`
- Module address: `0x01`
- Integer byte order: high byte first
- Checksum: `-(data1 + data2 + ... + data7)`의 8 bit two's complement

명령 코드:

| Command | Meaning |
|---------|---------|
| `0x85` | Query module status |
| `0x86` | Read test results |
| `0x87` | Switch module working status |
| `0x88` | Read blow time |
| `0x89` | Set blowing time |
| `0x90` | Read drinking threshold |
| `0x91` | Set drunk threshold |
| `0x92` | Read blow pressure threshold |
| `0x93` | Set blow pressure threshold |

참고 자료:

- Winsen ZE29A-C2H5OH product page: https://www.winsen-sensor.com/sensors/alcohol-sensor/ze29a-c2h5oh.html
- Winsen ZE29A-C2H5OH manual: https://www.winsen-sensor.com/d/files/ze29a-alcohol-module-manualv1_0.pdf

## BLE Model

위치: `../firmware/src/services/ble/model.rs`

공개 액션:

- `ble::measurement_started(session_id, source, kind)`: 보드 또는 앱에서 시작된 측정 세션 이벤트 DTO를 만든다.

GATT transport 계약:

| Name | UUID | Direction |
|------|------|-----------|
| Drunksafe service | `6f5f3f7a-3b0d-4df7-9d17-151b71e12201` | app discovers device service |
| Device event characteristic | `6f5f3f7a-3b0d-4df7-9d17-151b71e12202` | device notifies JSON `DeviceEvent` |
| Phone command characteristic | `6f5f3f7a-3b0d-4df7-9d17-151b71e12203` | app writes JSON `PhoneCommand` |

실제 GATT characteristic value는 UTF-8 JSON bytes다. `react-native-ble-plx` JS API가 characteristic value를 base64 문자열로 표현하므로, 앱의 `app/src/lib/ble/codec.ts`는 API 경계에서만 JSON 문자열과 BLE base64 value 사이를 변환한다. 펌웨어는 수신한 raw bytes를 UTF-8 JSON으로 파싱한다.

대표 GATT UUID, `DeviceEvent`, `PhoneCommand`, chunk 검증 입력은 `.docs/ble-contract-fixtures.json`에 둔다. 앱의 `pnpm test:ble-contract`는 이 fixture를 기준으로 BLE model validator, command serialization, event chunk reassembly, base64 boundary codec을 검증한다.

작은 payload는 `PhoneCommand`/`DeviceEvent` JSON을 그대로 한 번에 보낸다. `PhoneContext`처럼 협상된 GATT payload limit을 넘는 payload는 transport frame으로 나눠 보낸다. 현재 앱과 펌웨어 transport의 기본 목표 payload는 MTU 185 기준 `180 bytes`다.

| Frame | Direction | Fields |
|-------|-----------|--------|
| `phone_command_chunk` | app -> device | `id`, `index`, `count`, `data` |
| `device_event_chunk` | device -> app | `id`, `index`, `count`, `data` |

수신자는 같은 `id`의 chunk를 `index` 순서대로 합친 뒤 원래 JSON DTO validator를 통과시켜야 한다. 이 chunk frame은 BLE transport framing일 뿐이며, domain DTO에는 넣지 않는다.

BLE 모델은 다음 정도만 가진다.

- `DeviceStatus`: 연결 직후와 runtime 상태 변경 시 장치 상태를 전달한다.
- `PhoneCommand::Start`: 앱에서 일반 측정 또는 sober baseline 측정을 시작한다. `kind`는 `measurement` 또는 `baseline`이다.
- `MeasurementStarted`: 보드 또는 앱에서 새 측정 세션을 열고, `kind`, 필요한 히스토리 개수, 시간 동기화 여부를 요청한다.
- `PhoneContext`: 앱이 최근 히스토리와 개인화에 필요한 파생 context만 보낸다.
- `MeasurementProgress`: 측정 진행 단계와 percent만 전달한다.
- `MeasurementResult`: 최종 측정 결과와 `kind`를 전달한다. 앱은 세션 메모리 상태가 사라져도 이 필드로 baseline/일반 측정을 구분해 저장한다. BLE에는 `Alcohol`, `Pulse` 요약 DTO만 싣고 raw frame이나 알고리즘 내부 필드는 노출하지 않는다.
- `DeviceError`: 앱이 조치할 수 있는 오류 코드를 전달한다.

BLE 모델이 직접 소유하지 않는 것:

- ZE29 raw frame 해석 규칙
- PPG raw/algorithm 세부 구현
- 앱 히스토리 DB schema
- 장기 추천/상담 모델

## Context From Phone

현재 알코올 측정에 필요한 최소 context:

| Field | Purpose |
|-------|---------|
| `phone_time_unix_ms` | 결과 timestamp 기준 |
| `recent` | 최근 측정값으로 해독 추세와 이상치 판단 |
| `sober_alcohol_mg_l_x1000` | 0 근처 baseline 판단 |
| `sober_alcohol_mad_mg_l_x1000` | sober baseline 신뢰 범위 |
| `elimination_mg_l_per_hour_x1000` | 개인화된 sober-time 계산 |
| `resting_bpm` | pulse 보조 신뢰도 판단 |

앱은 원본 프로필(나이, 키, 몸무게, 성별)을 BLE로 보내지 않는다. 학습된 `elimination_mg_l_per_hour_x1000`가 없고 프로필이 완성된 경우에만 평균 0.015% BAC/hour보다 보수적인 0.013% BAC/hour 상당값인 `62 mg/L x1000/hour`를 fallback context로 보낸다. 실측 baseline이나 향후 개인화 학습값이 생기면 그 값이 우선한다.

Pulse 분석 모델은 `PulseDevice`가 소유하고, BLE `MeasurementResult`는 해당 device 모델을 optional로 참조한다.

## Result Analysis MVP

펌웨어 MVP의 `MeasurementResult`는 실험용/보수적 안내값이다. 법적 판정이나 의료 판단으로 쓰지 않는다.

- ZE29 호기 알코올 `mg/L`는 일반적인 breath-to-blood 2100:1 환산을 사용해 BAC percent로 추정한다. 코드 단위에서는 `alcohol_mg_l_x1000 * 0.21`을 `bac_milli_percent`로 둔다.
- 한국 도로교통법상 운전금지 기준인 혈중알코올농도 `0.03%`를 `danger` 기준으로 둔다. `0.015%` 이상 `0.03%` 미만은 조기 경고 목적의 `caution`이다.
- 앱에서 보낸 `sober_alcohol_mg_l_x1000`은 센서 baseline 보정에 사용한다. 다만 위험도를 낮출 수 있는 입력이므로 sober baseline은 `50 mg/L x1000`, MAD는 `50 mg/L x1000`까지만 반영한다. 위험 단계와 `bac_upper_milli_percent`는 raw BrAC가 가리키는 BAC보다 낮아지지 않게 산출한다.
- `elimination_mg_l_per_hour_x1000`가 있으면 해소 예상 시간에 우선 사용한다. 단, `20..=120 mg/L x1000/hour` 범위 밖이면 무시한다. 없으면 보수적인 기본 BAC 해소율 `0.015%/hour`를 사용한다.
- `resting_bpm`, baseline, 최근 히스토리 존재 여부는 결과 신뢰도 보정에만 반영한다.
- 펌웨어는 `MeasurementStarted(needs_context=true)` 이후 최대 5초 동안 `PhoneContext`를 기다린다. context timeout 또는 cancel은 result를 만들지 않고 `DeviceError`로 종료한다.

참고:

- 대한민국 도로교통법 제44조 제4항: https://www.law.go.kr/LSW//lsLinkCommonInfo.do?ancYnChk=&chrClsCd=010202&lsJoLnkSeq=1020823237
- BAC/BrAC 2100:1 단위 설명: https://www.utoledo.edu/studentaffairs/counseling/selfhelp/substanceuse/bac.html
- ANSI/ASB BPR 122 alcohol calculation elimination-rate range: https://www.tdcaa.com/wp-content/uploads/BPR-122-BAC-Calculations.pdf

## ERD

```mermaid
erDiagram
    USER ||--o{ MEASUREMENT : owns
    DEVICE ||--o{ MEASUREMENT : records
    MEASUREMENT ||--|| ALCOHOL_SAMPLE : has
    MEASUREMENT ||--o| PULSE_ANALYSIS : has
    MEASUREMENT ||--o| PHONE_CONTEXT : uses
    USER ||--o| USER_BASELINE : has

    USER {
        string id PK
        datetime created_at
    }

    DEVICE {
        string id PK
        string firmware_version
        int protocol_version
    }

    MEASUREMENT {
        string id PK
        string user_id FK
        string device_id FK
        datetime started_at
        datetime measured_at
        string risk
        int confidence_percent
    }

    ALCOHOL_SAMPLE {
        string measurement_id PK,FK
        int alcohol_mg_l_x1000
        bytes raw_payload
    }

    PULSE_ANALYSIS {
        string measurement_id PK,FK
        float bpm
        float ibi_stddev_ms
        float peak_amplitude
        boolean stable
        int confidence_percent
    }

    PHONE_CONTEXT {
        string measurement_id PK,FK
        int recent_count
        int sober_alcohol_mg_l_x1000
        int elimination_mg_l_per_hour_x1000
    }

    USER_BASELINE {
        string user_id PK,FK
        int sober_alcohol_mg_l_x1000
        int elimination_mg_l_per_hour_x1000
        datetime updated_at
    }
```
