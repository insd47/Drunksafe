import type { DrunksafeBleDevice } from '@/lib/ble/client';
import { protocolVersion, type DeviceEvent } from '@/lib/ble/model';
import type { MeasurementKind } from '@/lib/storage/history';

export const mockBleDevice: DrunksafeBleDevice = {
  id: 'mock-drnksafe-simulator',
  name: 'Drunksafe Simulator',
  rssi: -42,
  serviceUUIDs: [],
};

export function createMockSessionId(kind: MeasurementKind) {
  return `${kind}-mock-${Date.now().toString(36)}`;
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
    alcohol_mg_l_x1000: baseline ? 7 : 165,
    pulse: {
      bpm: baseline ? 71 : 96,
      stable: true,
    },
  };
}
