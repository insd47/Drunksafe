# Firmware 공개 표면

이 문서는 firmware 코드에서 의도적으로 사용해야 하는 공개 표면만 정리한다.
`protocol`, `algorithm`, `filter`, `state`, `params` 같은 하위 모듈은 device 내부 구현 세부로 보고, 외부 호출 지점으로 삼지 않는다.

## Runtime

위치: `firmware/src/main.rs`

- `main() -> crate::error::Result<()>`
  - logger와 보드 디바이스를 초기화하고 runtime loop를 시작한다.
  - 현재 runtime loop는 측정 버튼을 감지해 pulse/alcohol 측정을 실행하고, OLED에 측정 중/결과/오류 화면을 표시한다.

## Devices

위치: `firmware/src/devices/mod.rs`

- `devices::init() -> crate::error::Result<devices::Devices>`
  - `Peripherals::take()`를 한 번 호출하고 보드 배선에 맞는 HAL driver와 device handle을 구성한다.
- `devices::Devices`
  - `trigger`: 측정 시작 버튼인 `TriggerDevice`.
  - `alcohol`: ZE29용 `AlcoholDevice`.
  - `pulse`: 아날로그 PPG용 `PulseDevice`.
  - `display`: SH1106 OLED용 `DisplayDevice`.

현재 배선은 다음과 같다.

| Feature | Peripheral | Pins |
|---------|------------|------|
| Measurement trigger | GPIO | GPIO0 |
| Alcohol | UART2 | TX GPIO17, RX GPIO16 |
| Pulse | ADC1 | GPIO36 |
| Display | I2C0 | SDA GPIO21, SCL GPIO22 |

## Trigger

위치: `firmware/src/devices/trigger/`

- `TriggerDevice::new(pin) -> crate::error::Result<TriggerDevice>`
  - BOOT 버튼 GPIO0를 input pull-up으로 설정한다.
- `trigger.pressed() -> bool`
  - 버튼이 새로 눌린 순간에만 `true`를 반환한다.
  - 채터링으로 동작이 중복 실행되지 않도록 최소 debounce를 둔다.

## Alcohol

위치: `firmware/src/devices/alcohol/`

- `AlcoholDevice::new(uart, tx, rx) -> alcohol::Result<AlcoholDevice>`
  - `devices::init()`에서 UART2와 TX/RX 핀을 받아 ZE29 device handle을 만든다.
- `device.test() -> alcohol device Result<u16>`
  - ZE29 `0x86` read test results 명령으로 현재 알코올 측정값을 읽는다.
- `device.status() -> alcohol device Result<Status>`
  - ZE29 `0x85` query module status 명령으로 모듈 상태 코드를 읽는다.
- `device.work(wake) -> alcohol device Result<()>`
  - ZE29 `0x87` switch module working status 명령으로 센서 모듈의 wake 상태를 전환한다.
  - 현재 firmware에서는 `true`를 `0x01`, `false`를 `0x00`으로 캡슐화한다.

## Pulse

위치: `firmware/src/devices/pulse/`

- `PulseDevice::new(adc, pin) -> core::result::Result<PulseDevice, EspError>`
  - `devices::init()`이 구성한 ADC1/GPIO36 입력과 pulse 분석 상태를 묶는다.
- `device.reset()`
  - 새 측정 세션 시작 전에 filter, sample window, trend 상태를 초기화한다.
- `device.sample(elapsed_ms) -> pulse device Result<Option<PulseAnalysis>>`
  - GPIO36에서 PPG ADC sample을 읽고 분석 상태에 반영한다.
  - 분석 주기가 되지 않았거나 안정적인 pulse가 아직 확인되지 않으면 `Ok(None)`을 반환한다.
- `device.analyze() -> Option<PulseAnalysis>`
  - 마지막 분석 결과를 조회한다.
- `PulseAnalysis`
  - `bpm`, `ibi_stddev_ms`, `peak_amplitude`, 안정 여부, 신뢰도, 20초/1분/5분 trend를 포함한다.

## Display

위치: `firmware/src/devices/display/`, `../firmware/src/services/screen/`

- `DisplayDevice::new(i2c, sda, scl) -> core::result::Result<DisplayDevice, EspError>`
  - I2C0/GPIO21/GPIO22로 SH1106 128x64 OLED를 초기화한다.
- `display.clear() -> core::result::Result<(), EspError>`
  - 128x64 frame buffer를 비우고 OLED로 전송한다.
- `features::screen::show(display, view)`
  - `Home`, `Measuring`, `Failed`, `Result` 화면을 표시하고 실패 시 warning log를 남긴다.

## BLE

위치: `../firmware/src/services/ble/`

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
