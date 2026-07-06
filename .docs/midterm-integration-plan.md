# 중간 보고서 준비 통합 계획

이 문서는 현재 Rust 펌웨어 품질을 유지하면서 다음 작업들을 병렬로 진행하기 위한 계획이다.

- 디스플레이 표시 개선 조사
- 원격 `feature/ble-json-update` 차이 조사와 Rust 포팅 계획
- BLE/session 전면 재구축
- 최소 앱과 연결되는 MVP 측정 플로우

개인화 BAC/회복 모델은 당장 핵심 구현 범위에서는 보류한다. 단, MVP report payload와 앱 화면에는 나중에 붙일 수 있는 자리만 남긴다.

## 현재 판단

현재 Rust 펌웨어에서 `pulse`를 제외한 대부분의 모듈 품질은 좋은 편이다. 이유는 다음과 같다.

- `devices`는 하드웨어별 handle과 protocol 세부를 소유한다.
- `services`는 측정, 화면, BLE payload 같은 제품 동작 단위로 얇게 나뉘어 있다.
- `main.rs`는 디바이스 초기화와 runtime loop만 가진다.
- 하위 구현 세부는 모듈 내부에 숨겨져 있고 공개 함수는 작다.

앞으로 복잡해질 영역은 네 곳이다.

1. runtime state machine
2. display rendering/text/icon layer
3. BLE transport/session/event flow
4. app-facing MVP workflow

따라서 새 코드는 "큰 관리자 객체"를 만들지 말고, 기존의 좁은 공개 표면을 유지하는 방향으로 나눠야 한다.

## 목표 범위

최종 목표는 완성 플로우로 동작하는 MVP다. 중간 보고서는 이 MVP를 만들기 위한 기준선과 증거 패키지다.

MVP의 사용자 흐름:

1. 앱이 Drunksafe 장치를 찾고 연결한다.
2. 앱이 최소 사용자 context를 장치에 보낸다.
3. 장치에서 측정을 시작한다.
4. OLED가 한글로 측정 단계와 결과를 표시한다.
5. 장치가 BLE로 진행 상태와 최종 측정 결과를 앱에 보낸다.
6. 앱이 결과를 표시하고 로컬 히스토리에 저장한다.

완료 기준:

- Arduino `HWsketch/HWMAIN`은 병합 대상이 아니라 기능 레퍼런스로 정리한다.
- Rust 펌웨어 기준으로 MVP에 필요한 기능을 체크리스트화한다.
- 기존 `firmware/src/services/ble/` 모델은 초안으로만 보고, 새 플로우 기준으로 BLE를 재설계한다.
- BLE JSON schema, transport, session flow, app-facing payload examples를 새로 확정한다.
- OLED는 한글 폰트를 P0로 도입하고, 제품 플로우 기준의 화면 전환을 구현 대상으로 둔다.
- 상태 머신은 설계와 skeleton을 먼저 만들되, MVP 완성 플로우까지 이어지게 한다.
- 앱은 완성 제품이 아니어도 된다. 하지만 MVP 연결/결과 표시/히스토리 저장 최소 화면은 목표에 포함한다.

비목표:

- Arduino 코드를 Rust로 줄 단위 번역하지 않는다.
- `main.rs`에 BLE, 화면, 측정 분기 로직을 직접 쌓지 않는다.
- display module에 앱/측정 정책을 넣지 않는다.
- 기존 BLE DTO/ERD에 맞추려고 구현을 비틀지 않는다.
- `운전 가능` 같은 법적 판정 문구를 제품 결과로 확정하지 않는다.
- 심볼/이모지 체계는 한글 폰트 이후 별도 설계한다.

## 병렬 작업 트랙

### Track A. BLE/session rebuild

목표: 기존 `firmware/src/services/ble/`는 사실상 없는 것으로 보고, MVP flow 기준으로 BLE를 다시 설계한다.

입력 자료:

- `origin/feature/ble-json-update:HWsketch/HWMAIN/comms.cpp`
- `origin/feature/ble-json-update:HWsketch/HWMAIN/device.cpp`
- `firmware/src/services/ble/`
- `.docs/measurement-communication-model.md`

핵심 작업:

1. 기존 BLE 초안을 폐기 가능한 reference로 분류한다.
   - 현재 `model.rs`의 ERD/DTO는 앱 구상 초기 초안이다.
   - 재사용할 것은 serde envelope 아이디어와 event/command 방향뿐이다.
   - 새 schema가 확정되면 기존 DTO는 대체하거나 migration 문서만 남긴다.

2. MVP BLE contract를 새로 설계한다.
   - `DeviceStatus`: 연결 직후 장치 상태
   - `MeasurementStarted`: session id와 시작 출처
   - `MeasurementProgress`: preparing/blow/analyzing step과 percent
   - `MeasurementResult`: alcohol, pulse, risk, confidence, timestamp
   - `DeviceError`: timeout, sensor error, weak breath, cancelled
   - `PhoneContext`: phone time, user baseline, recent history
   - `PhoneCommand`: start/cancel/ack/time/context

3. Rust BLE transport를 payload model과 분리한다.
   - `services/ble/model.rs`: MVP schema만 소유
   - `services/ble/transport.rs`: ESP-IDF BLE service/characteristic/notify/write
   - `services/ble/session.rs`: session id, context timeout, ack, event send policy
   - `services/ble/error.rs`: BLE 전용 오류

4. 앱 MVP와 맞물리는 contract를 만든다.
   - UUID
   - notify payload examples
   - phone-to-device write examples
   - MTU/fragment 정책
   - 연결 전/후 동작
   - 앱 local history 저장 shape

5. 중간 보고서와 MVP 증거를 만든다.
   - JSON sample table
   - event sequence diagram
   - `cargo check`
   - host-side serde roundtrip test
   - 앱 mock 또는 BLE scanner 연결 캡처

위험:

- ESP32 BLE API가 Rust/esp-idf-svc에서 생각보다 번거로울 수 있다.
- JSON payload가 characteristic MTU를 넘을 수 있다.
- 앱이 아직 없어서 실제 연결 검증이 늦어질 수 있다.

완화:

- transport 구현 전에 payload schema test부터 작성한다.
- raw PPG stream은 P0에서 제외하고 feature/report event만 먼저 보낸다.
- 앱 MVP가 늦으면 BLE scanner 또는 작은 mock writer를 검증 도구로 둔다.

### Track B. Display/interaction

목표: 한글 폰트를 즉시 도입하고, 제품 플로우를 담을 수 있는 표시 구조를 만든다.

입력 자료:

- `firmware/src/devices/display/`
- `firmware/src/services/screen/`
- `origin/feature/ble-json-update:HWsketch/HWMAIN/display.cpp`
- 디스플레이 표시 개선 조사 스레드

핵심 작업:

1. display device 책임을 고정한다.
   - frame buffer
   - pixel/text/icon draw primitive
   - OLED flush
   - 측정 상태나 BLE 정책은 모른다.

2. screen service 책임을 확장한다.
   - `View`는 제품 상태를 표시 가능한 화면 모델로만 표현한다.
   - `render`는 `View -> Canvas` 변환만 한다.
   - measurement state machine은 screen service 밖에 둔다.

3. 한글 폰트를 P0로 도입한다.
   - 우선순위는 `u8g2-fonts` 또는 동등한 U8g2 font renderer다.
   - Arduino reference의 `u8g2_font_unifont_t_korean2` 사용 경험을 Rust 쪽에 반영한다.
   - 화면 문구는 고정 문구 중심으로 제한해서 폭/줄바꿈을 통제한다.
   - 도입 직후 binary size와 `cargo check`를 확인한다.

4. 심볼은 한글 이후 별도 설계한다.
   - 체크, 경고, 웃음/슬픔, 점자 spinner는 P1 이후로 둔다.
   - 폰트 기반 이모지보다 작은 1-bit icon/spinner 모듈을 우선 검토한다.

5. 중간 보고서와 MVP 증거를 만든다.
   - 화면 상태 목록
   - 화면 전환표
   - 한글 고정 문구 렌더링 캡처 또는 frame snapshot
   - 기존 화면 회귀 확인

위험:

- 한글 폰트 도입이 binary size와 렌더링 복잡도를 크게 올릴 수 있다.
- 상태 머신과 화면 모델이 섞이면 display module이 금방 비대해진다.

완화:

- 한글 도입은 display device가 아니라 text renderer layer로 격리한다.
- `View`/`render` 경계는 한글 도입과 동시에 고정한다.
- icon/spinner는 한글 이후 별도 diff로 분리한다.

### Track C. Runtime state machine

목표: BLE와 화면 작업이 `main.rs`에 직접 붙지 않도록 runtime 흐름을 별도 계층으로 분리한다.

권장 구조:

```text
main.rs
  - init
  - AppRuntime::new(devices, services)
  - runtime.tick()

services/runtime/
  - state.rs        // Idle, Context, Measuring, Result, Error
  - event.rs        // Button, BleCommand, MeasureProgress, Timeout
  - mod.rs          // AppRuntime public surface

services/measure/
  - 기존 sensor measurement 유지
  - progress callback 또는 pollable step API는 별도 검토

services/screen/
  - View rendering only

services/ble/
  - model/transport/session 분리

app/
  - BLE connect
  - Context write
  - Result/history screen
```

중요한 설계 원칙:

- 상태 머신은 상태 전이만 소유한다.
- 센서 protocol은 `devices` 안에 남긴다.
- 화면 text/layout은 `screen` 안에 남긴다.
- BLE JSON 구조는 새 `ble::model` 안에 남긴다.
- risk/personalization은 앱 또는 별도 analysis service로 미룬다.

중간 보고서 수준에서는 runtime skeleton과 상태 전이표를 먼저 제출한다. 이후 같은 구조로 MVP 완성 플로우까지 밀고 간다.

### Track D. Minimal app MVP

목표: 완성 앱이 아니라 BLE MVP 검증에 필요한 최소 앱 흐름을 만든다.

현재 앱 상태:

- Expo/React Native 골격은 있다.
- `react-native-ble-plx` 의존성은 있다.
- 실제 BLE 연결, profile/context, result/history 화면은 없다.

MVP 앱 기능:

1. 주변 Drunksafe 장치 scan/connect
2. BLE notify subscription
3. 최소 user context 작성 및 전송
4. 측정 진행 상태 표시
5. 결과 표시
6. 로컬 히스토리 저장

앱이 늦어질 때의 fallback:

- BLE scanner로 notify payload 검증
- TypeScript schema/parser test
- mock payload로 결과 화면 먼저 구현

## 코드 품질 유지 규칙

AI 에이전트 작업을 통제하려면 구현 전에 다음 규칙을 명시한다.

1. 파일별 공개 표면을 먼저 정한다.
   - 새 public 함수는 한 문장으로 책임을 설명할 수 있어야 한다.
   - 한 문장 설명이 길어지면 모듈이 잘못 나뉜 것이다.

2. 한 PR/작업은 한 경계만 바꾼다.
   - BLE model 변경과 display rendering 변경을 같은 diff에 넣지 않는다.
   - state machine skeleton과 transport 구현도 가능하면 분리한다.
   - 한글 폰트 도입과 심볼 도입은 분리한다.

3. 레퍼런스 포팅은 기능 단위로 한다.
   - Arduino 파일 구조를 그대로 가져오지 않는다.
   - `device.cpp`는 runtime event flow로 해석한다.
   - `comms.cpp`는 BLE schema/transport requirement로 해석한다.
   - `display.cpp`는 화면 상태와 문구 requirement로 해석한다.

4. `main.rs`는 계속 얇게 둔다.
   - 측정 진행 분기, BLE command 처리, 화면 순환은 `main.rs`에 쓰지 않는다.

5. 구현보다 테스트 가능한 순수 모델을 먼저 만든다.
   - BLE DTO serde roundtrip
   - state transition table
   - screen view mapping
   - app payload parser
   - risk/analysis는 보류하거나 MVP에서 단순 정책으로 둔다.

6. 대용량/개발 산출물은 Rust 작업 범위에서 제외한다.
   - `.DS_Store`
   - `.idea`
   - gcode/blend/stl 같은 3D 산출물
   - Arduino sketch 전체 병합

## 권장 일정

### 0단계. 정리와 기준선 고정

산출물:

- 현재 브랜치 상태 정리
- 원격 `feature/ble-json-update` 레퍼런스 목록
- 작업 제외 파일 목록
- 중간 보고서 목차 초안
- MVP 플로우 정의

검증:

- `cargo check`
- `git status --short`

### 1단계. 요구사항 매핑

산출물:

- Arduino 기능 -> Rust 모듈 매핑표
- 화면 상태 목록
- 새 BLE event/command 목록
- 앱 MVP 범위
- 한글 고정 문구 목록

검증:

- 각 항목이 Rust의 어느 모듈에 들어갈지 정해져 있어야 한다.
- 들어갈 곳이 없으면 새 모듈 제안부터 한다.

### 2단계. 계약 우선 구현

산출물:

- BLE JSON examples
- serde roundtrip test
- screen `View` 확장안과 한글 renderer spike
- runtime state transition table
- TypeScript payload parser 초안

검증:

- 앱 없이도 payload 예제가 문서와 test로 맞아야 한다.
- screen rendering은 기존 화면을 깨지 않아야 한다.
- 한글 문구가 128x64 화면에 들어가야 한다.

### 3단계. MVP skeleton

산출물:

- `AppRuntime` skeleton
- BLE session/transport MVP
- 한글 display progress/result 화면
- 버튼 event mapping 초안
- 앱 connect/result/history skeleton

검증:

- `cargo check`
- 기존 버튼 측정 흐름이 유지되어야 한다.
- BLE notify payload가 scanner 또는 앱 MVP에서 확인되어야 한다.
- event 흐름은 로그/화면/앱 중 최소 두 경로로 추적 가능해야 한다.

### 4단계. 중간 보고서 패키징

산출물:

- 구조 다이어그램
- 상태 전이표
- BLE JSON sample
- 한글 화면 플로우
- 구현 완료/미완료/리스크 표
- 향후 일정
- MVP 데모 시나리오

검증:

- 보고서만 읽어도 "왜 Rust 구조를 유지하면서 MVP까지 확장하는지" 설명되어야 한다.
- 앱 미완성으로 인한 제약, 최소 앱 구현 범위, fallback 검증 계획이 포함되어야 한다.

## 중간 보고서 목차 초안

1. 프로젝트 개요
2. 현재 Rust 펌웨어 구조와 품질 원칙
3. Arduino 레퍼런스와 Rust 포팅 전략
4. BLE JSON 통신 설계
5. 한글 OLED UX 개선 설계
6. Runtime state machine 설계
7. 최소 앱 MVP와 BLE 검증 전략
8. 구현 현황과 남은 작업
9. 리스크와 대응 계획
10. 데모 시나리오

## 가장 먼저 할 일

1. `feature/ble-json-update`의 Arduino 레퍼런스를 Rust 모듈별 checklist로 변환한다.
2. 기존 `services/ble`를 대체할 MVP BLE schema를 새로 작성하고 roundtrip test를 만든다.
3. 한글 폰트 renderer를 먼저 spike하고, 표시할 고정 문구 목록을 확정한다.
4. display 심볼은 한글 도입 이후 별도 설계한다.
5. runtime state machine skeleton을 만들고, 기존 측정 흐름을 깨지 않는지 확인한다.
6. 앱은 BLE connect/result/history MVP 화면부터 시작한다.
