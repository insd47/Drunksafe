# Firmware 공개 표면

이 문서는 firmware 코드에서 의도적으로 사용해야 하는 공개 표면만 정리한다.
`protocol`, `algorithm`, `filter`, `state`, `params` 같은 하위 모듈은 feature 내부 구현 세부로 보고, 외부 호출 지점으로 삼지 않는다.

## Runtime

위치: `firmware/src/feature/mod.rs`

- `feature::run() -> feature::Result<()>`
  - 보드 주변장치와 feature driver를 초기화하고 runtime loop를 시작한다.
  - 현재 runtime loop는 버튼 측정 요청을 감지하고, 새 session ID를 만들고, pulse 상태를 초기화한 뒤 BLE session DTO를 만든다.
- `feature::Error`
  - feature runtime에서 위로 올리는 오류다.
  - 현재는 ESP-IDF HAL/service 오류를 감싼다.

## Board Pins

위치: `firmware/src/feature/pins/mod.rs`

- `pins::take() -> Result<pins::Board, EspError>`
  - `Peripherals::take()`를 한 번 호출하고 보드 배선에 맞는 HAL driver를 구성한다.
- `pins::Board`
  - `trigger`: BOOT 버튼으로 쓰는 `Gpio0`.
  - `alcohol`: ZE29용 `UartDriver`.
  - `pulse`: MAX30102용 `I2cDriver`.

현재 배선은 다음과 같다.

| Feature | Peripheral | Pins |
|---------|------------|------|
| Trigger | GPIO | GPIO0 |
| Alcohol | UART2 | TX GPIO17, RX GPIO16 |
| Pulse | I2C0 | SDA GPIO21, SCL GPIO22 |

## Trigger

위치: `firmware/src/feature/trigger/`

- `trigger::init(pin) -> Result<trigger::State, EspError>`
  - BOOT 버튼 핀을 input pull-up으로 설정하고 debounce 상태를 만든다.
- `trigger::poll(&mut state) -> Option<trigger::Event>`
  - 블로킹하지 않고 버튼 debounce 상태 머신을 한 번 진행한다.
- `trigger::Event::MeasurementRequested`
  - 보드 버튼으로 새 측정 세션이 요청됐음을 뜻한다.

## Alcohol

위치: `firmware/src/feature/alcohol/`

- `alcohol::Device::new(uart) -> alcohol::Device`
  - `pins::take()`가 구성한 UART driver를 ZE29 device handle로 감싼다.
- `device.sample() -> alcohol::Result<alcohol::Sample>`
  - ZE29 `0x86` read test results 명령으로 현재 알코올 측정값을 읽는다.
- `device.status() -> alcohol::Result<alcohol::Status>`
  - ZE29 `0x85` query module status 명령으로 모듈 상태 코드를 읽는다.
- `alcohol::Sample`
  - `concentration`: mg/L x1000 정수로 표현한 호기 알코올 농도다.
- `alcohol::Status`
  - `code`: ZE29 status 응답 payload의 첫 번째 상태 코드다.
- `alcohol::Error`
  - UART driver 오류, timeout, frame start/checksum/command/payload 검증 오류를 표현한다.

## Pulse

위치: `firmware/src/feature/pulse/`

- `pulse::Device::new(i2c) -> pulse::Device`
  - `pins::take()`가 구성한 I2C driver와 pulse 분석 상태를 묶는다.
- `device.reset()`
  - 새 측정 세션 시작 전에 filter, sample window, trend 상태를 초기화한다.
- `device.sample(elapsed_ms) -> pulse::Result<Option<pulse::Analysis>>`
  - MAX30102 FIFO에서 sample을 읽고 분석 상태에 반영한다.
  - 분석 주기가 되지 않았거나 안정적인 pulse가 아직 확인되지 않으면 `Ok(None)`을 반환한다.
- `device.analyze() -> Option<pulse::Analysis>`
  - 마지막 분석 결과를 조회한다.
- `pulse::Analysis`
  - `bpm`, `ibi_stddev_ms`, `peak_amplitude`, 안정 여부, 신뢰도, 20초/1분/5분 trend를 포함한다.
- `pulse::Error`
  - I2C driver 오류와 sample timestamp 역행 오류를 표현한다.

## BLE

위치: `firmware/src/feature/ble/`

- `ble::session(session_id) -> DeviceToPhone`
  - 보드 버튼으로 시작된 측정 세션 요청 DTO를 만든다.

BLE model은 app과 firmware 사이의 JSON payload 계약이다.

- `DeviceToPhone`
  - `Status`: 장치 상태.
  - `Session`: 앱 context 요청.
  - `Progress`: 측정 진행률.
  - `Result`: 최종 측정 결과.
- `PhoneToDevice`
  - `Context`: 앱이 보내는 히스토리와 개인화 context.
  - `Cancel`: 측정 취소.
  - `Time`: 앱 기준 시간 동기화.
  - `Ack`: 장치 이벤트 처리 확인.

## Utils

위치: `firmware/src/utils/`

- `utils::math::mean(values)`
- `utils::math::stddev(values, mean)`
- `utils::math::round(value, places)`

현재는 pulse 분석 내부에서 쓰는 순수 수학 유틸리티다. `mean`과 `stddev`는 비어 있지 않은 slice를 전제로 한다.
