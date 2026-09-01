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

// Mock 장치의 세션 상태를 저장하여 측정마다 튀지 않고 지수 감쇠하도록 처리
let mockSessionIdCache = '';
let mockSessionStartMs = 0;
let mockC0 = 0;
let mockK = 0;

export function createMockResultEvent(
  sessionId: string,
  kind: MeasurementKind
): Extract<DeviceEvent, { event: 'measurement_result' }> {
  const baseline = kind === 'baseline';
  const now = Date.now();

  if (sessionId !== mockSessionIdCache) {
    mockSessionIdCache = sessionId;
    mockSessionStartMs = now;
    mockC0 = Math.floor(Math.random() * (952 - 95 + 1)) + 95;
    const eliminationPerHour = Math.floor(Math.random() * (95 - 47 + 1)) + 47; 
    const descentHours = (mockC0 - 45) / eliminationPerHour;
    mockK = descentHours > 0 ? Math.log(mockC0 / 45) / descentHours : 0;
  }

  // 실시간 모의 연결에서는 테스트를 위해 경과 시간을 실제보다 빠르게(1초=1시간) 스케일링하거나 
  // 단순히 매 호출마다 1시간이 지났다고 가정할 수 있음. 
  // 여기서는 호출될 때마다 값이 점진적으로 떨어지도록 elapsed(시간)를 가짜로 부여
  const elapsedSimulatedHours = (now - mockSessionStartMs) / 3600; // 3.6초마다 1시간 경과 효과

  let simulatedAlcohol = Math.round(mockC0 * Math.exp(-mockK * elapsedSimulatedHours));
  if (simulatedAlcohol < 0) simulatedAlcohol = 0;

  return {
    event: 'measurement_result',
    v: protocolVersion,
    session_id: sessionId,
    kind,
    alcohol_mg_l_x1000: baseline ? 7 : simulatedAlcohol,
    pulse: {
      status: 'measured',
      bpm: baseline ? 71 : 96,
      stable: true,
    },
  };
}
