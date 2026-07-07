export type MeasurementStartBlocker = 'not_connected' | 'active_measurement' | 'context_required';

export function measurementStartBlocker({
  connected,
  activeMeasurement,
  contextReady,
  mockMode,
}: {
  connected: boolean;
  activeMeasurement: boolean;
  contextReady: boolean;
  mockMode: boolean;
}): MeasurementStartBlocker | null {
  if (!connected) {
    return 'not_connected';
  }

  if (activeMeasurement) {
    return 'active_measurement';
  }

  if (!contextReady && !mockMode) {
    return 'context_required';
  }

  return null;
}

export function measurementStartBlockerMessage(blocker: MeasurementStartBlocker | null) {
  switch (blocker) {
    case 'not_connected':
      return '먼저 Drunksafe 장치를 연결하세요.';
    case 'active_measurement':
      return '이미 진행 중인 측정이 있습니다.';
    case 'context_required':
      return '프로필 또는 sober baseline을 먼저 준비하세요.';
    case null:
      return null;
  }
}

export function measurementReadinessDescription({
  routeMatchesActive,
  activeMeasurement,
  hasResult,
  message,
  blocker,
  contextLoadFailed,
}: {
  routeMatchesActive: boolean;
  activeMeasurement: boolean;
  hasResult: boolean;
  message: string | null;
  blocker: MeasurementStartBlocker | null;
  contextLoadFailed: boolean;
}) {
  if (routeMatchesActive && (activeMeasurement || hasResult)) {
    return message ?? 'BLE notify를 기다리는 중입니다.';
  }

  if (routeMatchesActive && message) {
    return message;
  }

  if (contextLoadFailed) {
    return '로컬 context를 불러오지 못했습니다.';
  }

  return measurementStartBlockerMessage(blocker) ?? '대기 중';
}
