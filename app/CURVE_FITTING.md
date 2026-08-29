# Alcohol curve fitting - Expo app

## Current test assumption

The phone screen and app remain active during hardware testing. BLE notifications are not guaranteed
when Android suspends or terminates the app. Session records are buffered by the ESP32 in RAM and are
downloaded when the session ends while the connection is available.

## Fitting pipeline

1. Sort successful alcohol records by device elapsed time.
2. Select the first maximum reading as `C0` and `t=0`; discard pre-peak absorption readings.
3. Fit `C(t) = C0 * exp(-k*t)` with weighted least squares and
   `sigma_i = max(1, 0.21 * abs(C_i))`.
4. Prefer points within one standardized 21% error. If fewer than 80% remain, re-include points in
   ascending standardized-error order until 80% is retained. A session needs at least four descent
   points and 70% retention.
5. Refit and calculate R-squared, RMSE, and the application grade: A >= 0.90, B >= 0.85,
   C >= 0.80, D >= 0.75, E >= 0.70, otherwise unsuitable.
6. Calculate K21 by intersecting every retained point's compatible k interval.
7. Calculate K95 with 2,000 centered standardized-residual bootstrap refits.
8. Use `Kjoint = K21 intersect K95` when non-empty. If they conflict, record the conflict and use K95
   only for an explicitly uncertain time range.

The profile is saved by `src/lib/personalization/fitting-profile.ts`. Developer tools can override the
central k and bounds for hardware demonstrations.

## Drinking-session prediction

Every alcohol reading `Cm` starts a new prediction curve while retaining the saved personal k range.
The completion threshold is `Ct=10` sensor units (`0.010 mg/L` in the current UI scale). The central
prediction is `ln(Cm/Ct)/k`. The displayed range also applies the reading's 21% concentration interval
and the fitted k bounds.

The five-person developer demo marks an actual completion only when a later validation reading reaches
10 or below. If validation ends above 10, it displays `actual completion not observed`; extrapolated
time must not be presented as an observed result.

## BLE and recovery

Unexpected disconnects are recorded locally in the app. Duplicate downloaded records are removed by
`session_id + index`. During the current screen-on test, the ESP32 keeps records in RAM and retries the
download after reconnection.

## Follow-up

- Add durable device-side NVS/flash storage with sequence ACK and deletion only after app persistence.
- Optionally add an Android `connectedDevice` foreground service for live screen-off updates.
- External storage hardware can increase capacity. A remote server is also possible when Wi-Fi is
  available, but requires authentication, encrypted transport, retry queues, and offline conflict rules.
