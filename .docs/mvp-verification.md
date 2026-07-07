# MVP 실기기 검증 체크리스트

이 문서는 Drunksafe MVP를 완료로 판단하기 위한 실기기 검증 기준이다.
시뮬레이터와 정적 테스트가 통과해도, 아래 실물 증거가 없으면 MVP 완료로 보지 않는다.

## 0. 준비 상태

| 항목        | 명령 또는 확인                                               | 통과 기준                                               |
| ----------- | ------------------------------------------------------------ | ------------------------------------------------------- |
| Git 기준    | `git status --short --branch`                                | `main...origin/main`이며 의도한 변경 외 dirty file 없음 |
| 앱 테스트   | `cd app && pnpm test && pnpm lint && pnpm exec tsc --noEmit` | 모두 exit 0                                             |
| 앱 번들     | `cd app && pnpm exec expo export -p ios --no-minify --clear` | iOS bundle 생성                                         |
| 웹 번들     | `cd app && pnpm exec expo export -p web --no-minify --clear` | web bundle 생성                                         |
| 펌웨어 빌드 | `cd firmware && cargo fmt --check && cargo check`            | 모두 exit 0                                             |
| 배선        | `.docs/firmware-public-surface.md`의 핀 표                   | ESP32 DevKitC V4, ZE29, PPG, SH1106, GPIO0 배선 일치    |

## 1. 펌웨어 flash 및 광고

```sh
cd firmware
. ~/export-esp.sh
cargo run --release
```

통과 기준:

- USB 연결된 ESP32에 flash가 완료된다.
- monitor 로그에 `Drunksafe firmware started`가 출력된다.
- BLE 초기화 후 `BLE advertising started`가 출력된다.
- OLED가 Home 화면을 표시한다.
- 앱 또는 BLE scanner에서 `Drunksafe` 이름의 장치가 보인다.

기록할 증거:

| 항목                       | 값               |
| -------------------------- | ---------------- |
| Board                      | ESP32 DevKitC V4 |
| Firmware commit            |                  |
| Flash 일시                 |                  |
| Monitor log 파일 또는 캡처 |                  |
| BLE advertising 확인 기기  |                  |

## 2. 앱 연결 smoke test

통과 기준:

- 실제 iPhone 또는 Android 개발 빌드에서 앱이 실행된다.
- Android는 Nearby Devices 권한 요청이 표시되고 허용 후 스캔이 가능하다.
- `Drunksafe 스캔` 후 장치가 목록에 나타난다.
- 장치 연결 후 연결 상태가 `연결됨`으로 표시된다.
- Context 상태가 프로필 또는 sober baseline 기준으로 `준비됨`이 된다.

기록할 증거:

| 항목                  | 값  |
| --------------------- | --- |
| App platform / OS     |     |
| App commit            |     |
| 연결된 device id/name |     |
| 권한 허용 화면 캡처   |     |
| 연결 화면 캡처        |     |

## 3. Baseline 측정

사전 조건:

- 사용자가 음주하지 않은 sober 상태다.
- 앱 온보딩에서 나이, 키, 몸무게, 성별을 저장한다.
- 앱이 실제 보드와 연결되어 있다.

절차:

1. 온보딩 화면에서 `Baseline 측정 시작`을 누른다.
2. 측정 화면에서 `측정 시작`을 누른다.
3. 앱이 `preparing`, `warming_sensor`, `waiting_breath`, `sampling_breath`, `sampling_pulse`, `analyzing`, `done` 순서를 표시하는지 확인한다.
4. `결과 보기`로 이동한다.
5. 온보딩으로 돌아와 baseline sample count가 증가했는지 확인한다.

통과 기준:

- `measurement_started.kind`는 `baseline`이다.
- 앱 화면의 세션 종류는 `Baseline`이다.
- 결과는 히스토리에 저장되지만 일반 측정 히스토리 집계에는 섞이지 않는다.
- 낮은 safe baseline 결과만 sober baseline에 반영된다.

기록할 증거:

| 항목                | 값  |
| ------------------- | --- |
| Baseline session id |     |
| 호기 baseline       |     |
| 안정시 BPM          |     |
| sample count 변화   |     |
| 결과 화면 캡처      |     |

## 4. 일반 측정

사전 조건:

- 앱에 프로필 또는 sober baseline context가 있다.
- 앱이 실제 보드와 연결되어 있다.

절차:

1. 연결 화면에서 `측정 시작`을 누른다.
2. 측정 화면에서 7개 progress 단계가 순서대로 완료되는지 확인한다.
3. `결과 보기`로 이동한다.
4. 결과 화면에서 호기 알코올, BAC 추정, BAC 상한, 위험 단계, 해소 예상, 저장 상태를 확인한다.
5. 히스토리 화면에서 방금 측정이 최신 기록으로 보이는지 확인한다.

통과 기준:

- `measurement_started.kind`와 `measurement_result.kind`는 `measurement`다.
- `measurement_result.measured_at_unix_ms`가 앱 시간 기준으로 채워진다.
- 결과 저장 상태가 `저장됨`이다.
- 히스토리 최신 기록의 risk/BAC가 결과 화면과 일치한다.
- 반복 위험 샘플을 넣었을 때 개선 안내가 129/109/지역 센터 항목을 표시한다.

기록할 증거:

| 항목                   | 값  |
| ---------------------- | --- |
| Measurement session id |     |
| Alcohol mg/L           |     |
| BAC estimate / upper   |     |
| Risk                   |     |
| Sober-time estimate    |     |
| History 화면 캡처      |     |

## 5. 보드 버튼 시작

절차:

1. 앱이 보드와 연결되고 notify 구독이 활성화된 상태로 둔다.
2. 보드의 GPIO0 trigger 버튼을 누른다.
3. 앱에서 활성 세션 id가 생기는지 확인한다.
4. 측정 화면을 열어 진행률과 결과를 확인한다.

통과 기준:

- `measurement_started.source`는 `board_button`이다.
- `measurement_started.kind`는 `measurement`다.
- 앱은 같은 세션 id의 progress/result를 표시한다.
- 결과가 일반 측정 히스토리에 저장된다.

## 6. 실패 케이스

| 케이스          | 절차                                     | 통과 기준                                                          |
| --------------- | ---------------------------------------- | ------------------------------------------------------------------ |
| Context timeout | 앱 연결 없이 보드 버튼 측정 시작         | 펌웨어가 `context_timeout` error notify 또는 OLED 실패 화면을 표시 |
| Cancel          | 측정 중 앱에서 `측정 취소`               | 앱이 `cancelled` 메시지를 표시하고 stale progress/result를 지움    |
| 연결 해제       | 측정 중 Bluetooth off 또는 앱 disconnect | 앱이 측정 중단 메시지를 표시하고 다음 측정을 막지 않음             |
| 센서 timeout    | ZE29 또는 PPG 입력 없이 측정 지속        | 앱이 `measurement_timeout` 또는 센서 오류를 표시                   |

## 7. 완료 판정

MVP 완료는 다음 증거가 모두 있을 때만 선언한다.

- 위 0-6 항목이 실제 보드에서 통과했다.
- 실패 케이스가 앱과 OLED에서 사용자가 이해 가능한 상태로 끝난다.
- `main` 브랜치에 모든 변경이 PR 번호가 포함된 squash commit으로 반영되어 있다.
- 시연에 사용할 휴대폰, 보드, 케이블, 센서 배선, 앱 빌드가 고정되어 있다.

미완료로 남기는 조건:

- 시뮬레이터 mock flow만 통과했다.
- `cargo check` 또는 Expo export만 통과하고 ESP32 flash 증거가 없다.
- 실제 BLE 연결은 되지만 측정 result가 앱 히스토리에 저장되지 않는다.
- 센서가 고정값 또는 오류만 반환하는데 시연 시나리오에서 이를 명시하지 않았다.

## 8. 완료 전 남은 고위험 항목

실기기 검증 전에 아래 항목을 코드로 해결하거나, 실제 보드 로그로 문제가 없음을 확인해야 한다.

| 항목                         | 위험                                                                                                             | 완료 기준                                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Notify subscription race     | 앱이 notify 구독 완료 전에 `start`를 보낼 수 있으면 `measurement_started`를 놓치고 context timeout이 날 수 있다. | 구독 준비 handshaking 또는 첫 status catch-up 이벤트가 있고, 앱은 그 전까지 start를 막는다.              |
| 측정 중 cancel 지연          | 펌웨어가 `measure.run()` 안에서 센서 완료/timeout까지 blocking되면 앱의 cancel이 즉시 반영되지 않는다.           | 측정 loop가 cancel을 주기적으로 확인하고, cancel 시 `device_error(cancelled)`가 짧은 시간 안에 도착한다. |
| Chunk reassembly stale state | reconnect 또는 board reboot 후 chunk id가 재사용되면 앱의 남은 chunk state와 충돌할 수 있다.                     | 앱은 monitor/disconnect마다 assembler를 reset하고, 펌웨어 chunk id는 boot/session nonce를 포함한다.      |
