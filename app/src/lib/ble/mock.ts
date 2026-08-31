import type { DrunksafeBleDevice } from '@/lib/ble/client';
import { protocolVersion, type DeviceEvent } from '@/lib/ble/model';
import type { MeasurementKind } from '@/lib/storage/history';

export const mockBleDevice: DrunksafeBleDevice = {
  id: 'mock-drnksafe-simulator',
  name: 'Drunksafe Simulator',
  rssi: -42,
  serviceUUIDs: [],
};

const mockResultDelayMs = 3800;

export class MockBleEventSource {
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private sequence = 0;

  get pendingTimerCount() {
    return this.timers.size;
  }

  start(kind: MeasurementKind, dispatch: (event: DeviceEvent) => void) {
    this.stop();
    this.sequence += 1;
    const sessionId = createMockSessionId(kind, this.sequence);

    dispatch(createMockStartedEvent(sessionId, kind));

    const timer = setTimeout(() => {
      this.timers.delete(timer);
      dispatch(createMockResultEvent(sessionId, kind));
    }, mockResultDelayMs);
    this.timers.add(timer);

    return sessionId;
  }

  cancel() {
    this.stop();
  }

  stop() {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
  }
}

export function createMockSessionId(kind: MeasurementKind, sequence = 0) {
  return `${kind}-mock-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

export function createMockStartedEvent(
  sessionId: string,
  kind: MeasurementKind
): Extract<DeviceEvent, { event: 'measurement_started' }> {
  return {
    event: 'measurement_started',
    v: protocolVersion,
    session_id: sessionId,
    source: 'phone',
    kind,
  };
}

export function createMockResultEvent(
  sessionId: string,
  kind: MeasurementKind
): Extract<DeviceEvent, { event: 'measurement_result' }> {
  const baseline = kind === 'baseline';

  return {
    event: 'measurement_result',
    v: protocolVersion,
    session_id: sessionId,
    kind,
    // BAC 0.02% ~ 0.20% 에 대응하는 brac (mg/L x 1000) 값: 대략 95 ~ 952
    alcohol_mg_l_x1000: baseline ? 7 : Math.floor(Math.random() * (952 - 95 + 1)) + 95,
    pulse: {
      status: 'measured',
      bpm: baseline ? 71 : 96,
      stable: true,
    },
  };
}
