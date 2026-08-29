# Drunksafe 펌웨어·Android 실기기 실행 가이드

이 문서는 **Windows에 Arduino IDE만 설치된 사용자**가 `feature/refactor-v2` 브랜치를 받아 다음 작업을 완료하는 절차를 설명한다.

1. Expo Android 앱을 실기기에 설치: `pnpm expo run:android`
2. Rust 펌웨어를 ESP32 DevKitC V4에 플래시: `espflash flash`

Arduino IDE는 참고용 Arduino 심박 스케치를 실행할 때만 사용한다. Expo 앱과 BLE로 연동하려면 반드시 이 저장소의 **Rust 펌웨어**를 ESP32에 플래시해야 한다.

## 하드웨어 범위

- ESP32 DevKitC V4
- ZE29-C2H5OH 알코올 센서(UART)
- 아날로그 PPG 심박 센서(GPIO 36/ADC)
- SH1106 128x64 OLED(I2C, SDA 21/SCL 22)
- GPIO 0 버튼
- GPIO 27 active-low 부저

측정 흐름과 BLE 계약은 [측정 통신 모델](../.docs/measurement-communication-model.md), [펌웨어 공개 표면](../.docs/firmware-public-surface.md), [MVP 검증 체크리스트](../.docs/mvp-verification.md)를 참고한다.

## 1. 공통 도구 설치

아래 도구를 설치한 뒤 PowerShell을 새로 연다.

- [Git for Windows](https://git-scm.com/download/win)
- [Node.js LTS](https://nodejs.org/)
- [Android Studio](https://developer.android.com/studio)
- [Rustup](https://rustup.rs/)

Android Studio의 SDK Manager에서 다음 항목을 설치한다.

- Android SDK Platform(프로젝트가 요구하는 최신 플랫폼)
- Android SDK Build-Tools
- Android SDK Platform-Tools
- Android SDK Command-line Tools
- JDK 17. Android Studio에 포함된 JetBrains Runtime 17을 사용할 수 있다.

Node와 Git 설치를 확인한다.

```powershell
git --version
node --version
```

프로젝트가 지정한 pnpm 10.24.0을 활성화한다.

```powershell
corepack enable
corepack prepare pnpm@10.24.0 --activate
pnpm --version
```

## 2. 저장소 받기

```powershell
git clone https://github.com/insd47/Drunksafe.git
Set-Location .\Drunksafe
git switch feature/refactor-v2
```

이미 저장소가 있다면 `git fetch origin` 후 해당 브랜치로 전환한다.

## 3. Android 환경 설정

현재 PowerShell 세션에서 Android SDK 경로를 설정한다. Android Studio의 SDK Location이 다르면 경로를 바꾼다.

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator;$env:Path"
```

JDK를 별도로 설치하지 않고 Android Studio의 JDK를 쓰는 경우 다음과 같이 설정할 수 있다. 설치 위치가 다르면 수정한다.

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
java -version
```

Android 휴대폰에서 개발자 옵션과 USB 디버깅을 켜고 USB로 연결한다. 제조사 USB 드라이버가 필요한 기종은 드라이버도 설치한다.

```powershell
adb devices
```

휴대폰에 RSA 허용 창이 나타나면 허용한다. 목록에 `unauthorized`가 아닌 `device`가 보여야 한다.

## 4. Expo 앱 설치

저장소 루트에서 다음을 실행한다.

```powershell
Set-Location .\app
pnpm install
pnpm expo run:android
```

`expo run:android`는 네이티브 BLE 모듈을 포함한 개발 빌드를 생성해 연결된 Android 실기기에 설치한다. Expo Go로는 이 BLE 기능을 검증할 수 없다.

문제가 생기면 다음을 먼저 확인한다.

- `adb devices`에 휴대폰이 표시되는가
- Android SDK와 JDK 17 경로가 현재 PowerShell에 적용됐는가
- 휴대폰의 Bluetooth와 위치 권한이 허용됐는가

## 5. ESP32 Rust 도구 체인 설치

PowerShell에서 다음을 실행한다.

```powershell
rustup toolchain install stable --component rust-src
cargo +stable install espup --locked
cargo +stable install ldproxy espflash --locked
espup install
```

`espup install`이 만든 환경 스크립트를 현재 PowerShell에 불러온다.

```powershell
Get-ChildItem "$env:USERPROFILE\export-esp*"
. "$env:USERPROFILE\export-esp.ps1"
```

파일명이 다르면 첫 번째 명령으로 확인한 실제 파일을 사용한다. 새 PowerShell을 열 때마다 export 스크립트를 다시 불러와야 한다.

설치를 확인한다.

```powershell
rustc --version
cargo --version
ldproxy --version
espflash --version
```

### Windows 환경 변수 주의

일부 Windows 환경에서는 `espup install` 이후 사용자 변수와 시스템 변수의 `Path`가 합쳐지거나 잘려 기존 명령이 호출되지 않는 문제가 보고됐다. 설치 전에 환경 변수를 백업해 두는 것을 권장한다.

사용자 환경 변수 백업:

```powershell
Get-Item -Path "HKCU:\Environment" | Select-Object -ExpandProperty Property | ForEach-Object {
    "$($_) = $((Get-ItemProperty -Path 'HKCU:\Environment').$_)"
} | Out-File "$env:USERPROFILE\User_Env.txt" -Encoding utf8
```

시스템 환경 변수 백업(관리자 PowerShell 권장):

```powershell
Get-Item -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" | Select-Object -ExpandProperty Property | ForEach-Object {
    "$($_) = $((Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment').$_)"
} | Out-File "$env:USERPROFILE\System_Env.txt" -Encoding utf8
```

`setx Path ...`로 긴 Path를 덮어쓰지 말고 Windows의 **시스템 속성 → 환경 변수**에서 누락된 항목을 확인한다.

## 6. Rust 펌웨어 빌드

ESP-IDF는 중간 산출물 경로가 매우 길다. Windows 경로 길이 제한을 피하기 위해 저장소 내부 `target` 대신 `C:\dev`처럼 짧은 경로를 사용한다.

아래 명령은 저장소 루트에서 실행한다. 앞 단계에서 `app` 폴더에 있다면 먼저 `Set-Location ..`로 돌아온다.

```powershell
Set-Location .\firmware
. "$env:USERPROFILE\export-esp.ps1"
cargo build --target-dir "C:\dev"
```

이 프로젝트는 `.cargo/config.toml`에서 `xtensa-esp32-espidf`, ESP-IDF `v5.5.3`을 사용한다. 빌드 결과는 다음 경로에 생성된다.

```text
C:\dev\xtensa-esp32-espidf\debug\firmware
```

`cargo run`이나 저장소 안의 기본 `target` 경로에서 경로 길이 오류가 나면 위의 짧은 `--target-dir` 방식으로 다시 빌드한다.

## 7. ESP32 연결 및 플래시

ESP32를 USB로 연결하고 Windows 장치 관리자에서 COM 포트를 확인한다. 보드에 따라 CP210x 또는 CH340 USB 드라이버가 필요할 수 있다.

```powershell
espflash board-info --port COM5
espflash flash --port COM5 "C:\dev\xtensa-esp32-espidf\debug\firmware" --monitor
```

`COM5`는 실제 포트로 바꾼다. 포트가 하나뿐이면 `--port`를 생략해 자동 선택할 수도 있다.

플래시 연결이 되지 않으면 ESP32의 BOOT 버튼을 누른 채 재시도하고, 업로드가 시작되면 놓는다. `--monitor`를 종료하려면 `Ctrl+C`를 누른다.

## 8. 최종 확인 순서

1. Rust 펌웨어를 플래시하고 ESP32를 재시작한다.
2. Android 앱을 실행하고 Bluetooth·근처 기기·위치 권한을 허용한다.
3. 검색 목록에서 이름과 MAC 주소를 확인해 해당 Drunksafe 장치를 연결한다.
4. 기준값 측정 또는 개발자 도구의 심박 측정으로 센서 연결을 확인한다.
5. 음주 세션 측정에서 심박 진행률, 알코올 측정 알림, 기록 저장을 확인한다.

## Arduino 참고 스케치

`firmware/arduino/drunksafe_pulse_sensor/drunksafe_pulse_sensor.ino`는 SZH-HWS001 계열 PPG 알고리즘을 Arduino 환경에서 단독 확인하기 위한 참고 코드다. BLE, OLED, 알코올 센서와 Expo 앱 연동은 포함하지 않으므로 이 스케치를 올린 상태에서는 Android 앱과 연결할 수 없다.
