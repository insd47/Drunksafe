# Firmware 공개 표면

이 문서는 firmware 코드에서 의도적으로 사용해야 하는 공개 표면만 정리한다.
`protocol`, `algorithm`, `filter`, `state`, `params` 같은 하위 모듈은 device 내부 구현 세부로 보고, 외부 호출 지점으로 삼지 않는다.

## Runtime

위치: `firmware/src/main.rs`

- `main() -> Result<(), EspError>`
  - logger와 보드 디바이스를 초기화하고 runtime loop를 시작한다.
  - 현재 runtime loop는 버튼 측정 요청을 감지하고, 새 session ID를 만들고, pulse 상태를 초기화한 뒤 BLE session DTO를 만든다.

## Devices

위치: `firmware/src/devices/mod.rs`

- `devices::init() -> Result<devices::Devices, EspError>`
  - `Peripherals::take()`를 한 번 호출하고 보드 배선에 맞는 HAL driver와 device handle을 구성한다.
- `devices::Devices`
  - `trigger`: 테스트용 측정 시작 버튼인 `TriggerDevice`.
  - `alcohol`: ZE29용 `AlcoholDevice`.
  - `pulse`: MAX30102용 `PulseDevice`.

현재 배선은 다음과 같다.

| Feature | Peripheral | Pins |
|---------|------------|------|
| Trigger | GPIO | GPIO0 |
| Alcohol | UART2 | TX GPIO17, RX GPIO16 |
| Pulse | I2C0 | SDA GPIO21, SCL GPIO22 |

## Trigger

위치: `firmware/src/devices/trigger/`

- `TriggerDevice::new(pin) -> Result<TriggerDevice, EspError>`
  - BOOT 버튼 핀을 input pull-up으로 설정한다.
- `trigger.pressed() -> bool`
  - 버튼이 새로 눌린 순간에만 `true`를 반환한다.
  - 버튼 trigger는 테스트용 입력이므로 이벤트 매핑은 두지 않는다. 단, 채터링으로 세션이 중복 생성되지 않도록 최소 debounce만 둔다.

## Alcohol

위치: `firmware/src/devices/alcohol/`

- `AlcoholDevice::new(uart) -> AlcoholDevice`
  - `devices::init()`이 구성한 UART driver를 ZE29 device handle로 감싼다.
- `device.sample() -> alcohol device Result<AlcoholConcentration>`
  - ZE29 `0x86` read test results 명령으로 현재 알코올 측정값을 읽는다.
- `device.status() -> alcohol device Result<u8>`
  - ZE29 `0x85` query module status 명령으로 모듈 상태 코드를 읽는다.
- `device.set_wake(wake) -> alcohol device Result<()>`
  - ZE29 `0x87` switch module working status 명령으로 센서 모듈의 wake 상태를 전환한다.
  - 공개 매뉴얼의 payload 정의가 상세하지 않아 현재 firmware에서는 `true`를 `0x01`, `false`를 `0x00`으로 캡슐화한다.
- `AlcoholConcentration`
  - `mg_l_x1000`: mg/L x1000 정수로 표현한 호기 알코올 농도다.

## Pulse

위치: `firmware/src/devices/pulse/`

- `PulseDevice::new(i2c) -> PulseDevice`
  - `devices::init()`이 구성한 I2C driver와 pulse 분석 상태를 묶는다.
- `device.reset()`
  - 새 측정 세션 시작 전에 filter, sample window, trend 상태를 초기화한다.
- `device.sample(elapsed_ms) -> pulse device Result<Option<PulseAnalysis>>`
  - MAX30102 FIFO에서 sample을 읽고 분석 상태에 반영한다.
  - 분석 주기가 되지 않았거나 안정적인 pulse가 아직 확인되지 않으면 `Ok(None)`을 반환한다.
- `device.analyze() -> Option<PulseAnalysis>`
  - 마지막 분석 결과를 조회한다.
- `PulseAnalysis`
  - `bpm`, `ibi_stddev_ms`, `peak_amplitude`, 안정 여부, 신뢰도, 20초/1분/5분 trend를 포함한다.

## BLE

위치: `../firmware/src/features/ble/`

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
