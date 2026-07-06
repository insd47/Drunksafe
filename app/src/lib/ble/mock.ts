import type { DrunksafeBleDevice } from '@/lib/ble/client';
import { protocolVersion, type DeviceEvent, type MeasurementStep } from '@/lib/ble/model';
import type { MeasurementKind } from '@/lib/storage/history';

export const mockBleDevice: DrunksafeBleDevice = {
  id: 'mock-drnksafe-simulator',
  name: 'Drunksafe Simulator',
  rssi: -42,
  serviceUUIDs: [],
};

export const mockProgressPlan: MockProgressStep[] = [
  { delayMs: 300, step: 'preparing', percent: 5 },
  { delayMs: 700, step: 'warming_sensor', percent: 15 },
  { delayMs: 1100, step: 'waiting_breath', percent: 25 },
  { delayMs: 1600, step: 'sampling_breath', percent: 50 },
  { delayMs: 2300, step: 'sampling_pulse', percent: 75 },
  { delayMs: 3000, step: 'analyzing', percent: 92 },
];

type MockProgressStep = {
  delayMs: number;
  step: MeasurementStep;
  percent: number;
};

export function createMockSessionId(kind: MeasurementKind) {
  return `${kind}-mock-${Date.now().toString(36)}`;
}

export function createMockStartedEvent(
  sessionId: string
): Extract<DeviceEvent, { event: 'measurement_started' }> {
  return {
    event: 'measurement_started',
    v: protocolVersion,
    session_id: sessionId,
    source: 'phone',
    history_limit: 8,
    needs_context: true,
    sync_time: true,
  };
}

export function createMockProgressEvent(
  sessionId: string,
  step: MeasurementStep,
  percent: number
): Extract<DeviceEvent, { event: 'measurement_progress' }> {
  return {
    event: 'measurement_progress',
    v: protocolVersion,
    session_id: sessionId,
    step,
    percent,
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
    measured_at_unix_ms: Date.now(),
    alcohol: {
      mg_l_x1000: baseline ? 7 : 165,
    },
    pulse: {
      bpm: baseline ? 71 : 96,
      stable: true,
      confidence_percent: baseline ? 90 : 82,
    },
    bac_milli_percent: baseline ? 1 : 35,
    bac_upper_milli_percent: baseline ? 3 : 39,
    sober_time_minutes: baseline ? 0 : 156,
    risk: baseline ? 'safe' : 'danger',
    confidence_percent: baseline ? 90 : 82,
  };
}
