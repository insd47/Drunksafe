# Alcohol curve fitting - ESP32 firmware

## Fitting measurement session

- The Expo app starts `StartAlcoholTrack`; no heart-rate sensor is sampled.
- Measurement slots are fixed at 10-minute intervals, beginning with an immediate first slot.
- At each slot the buzzer sounds once and the display asks for user confirmation.
- A short GPIO 0 press or the app alcohol button starts ZE29A measurement.
- When the sensor enters `WaitBlow`, the buzzer sounds twice and the LCD displays `지금 부세요`.
- A failed attempt remains in the same slot. After three consecutive failures, or when the 10-minute
  slot expires, an `AlcoholMissed` record is stored and the LCD asks the user to wait for the next slot.
- `AlcoholMissed` has no concentration and is never passed to curve fitting.
- The user may end the session before a reading reaches 10. All accumulated records are still streamed;
  the app decides whether the available peak-and-descent points are sufficient for fitting.

## GPIO 0 rules

- Home screen short press: no action.
- Fitting or requested alcohol measurement: short press confirms measurement.
- Two-second hold: emergency exit from a running/result flow to the BLE-aware home state.

## Display rules

- BLE disconnected: `drunksafe`, separator, `BLE 연결 끊어짐`.
- BLE connected and idle: `drunksafe`, separator, `준비 완료`.
- Successful HR-triggered alcohol measurement: `측정 완료`, `drunksafe 앱 확인`.

## BLE protocol

Protocol version 13 adds `alcohol_missed` session records. Session logs remain in RAM until their full
record stream and `SessionComplete` notification are sent. Reconnection retries the full indexed stream;
the app de-duplicates records.

## Current limitation and follow-up

Screen-off/background reception is not part of the current hardware test. RAM survives BLE loss but not
power loss. The preferred next step is an NVS/flash queue containing session ID, record index, timestamp,
status, and value, removed only after an app ACK. External flash/SD is useful for larger logs. A remote
server is viable with Wi-Fi but must be an additional synchronized destination, not the only copy.
