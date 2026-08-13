import type { DrunksafeBleDevice } from '@/lib/ble/client';
import type {
  DeviceEvent,
  ErrorCode,
  MeasurementResult,
  PhoneCommand,
  StatusKind,
} from '@/lib/ble/model';
import { mockBleDevice } from '@/lib/ble/mock';
import type { MeasurementKind, MeasurementRecord } from '@/lib/storage/history-records';

export type ConnectionState =
  | { phase: 'idle' }
  | { phase: 'bluetooth_off'; message: string }
  | { phase: 'unsupported'; message: string }
  | { phase: 'scanning'; devices: DrunksafeBleDevice[]; message: string }
  | {
      phase: 'connecting';
      deviceId: string;
      device: DrunksafeBleDevice;
      reconnectAttempt: number;
      message: string;
    }
  | {
      phase: 'connected';
      device: DrunksafeBleDevice;
      status: StatusKind;
      message: string | null;
    }
  | { phase: 'error'; message: string };

export type MeasurementErrorCode = ErrorCode | 'bluetooth_off' | 'connection_lost' | 'ble_failure';

/** 측정은 알코올(alcohol) 단계와 심박(pulse) 단계로 나뉜다. */
export type MeasurementStage = 'alcohol' | 'pulse';

export type MeasurementState =
  | { phase: 'idle' }
  | { phase: 'starting'; kind: MeasurementKind }
  | {
      phase: 'active';
      stage: MeasurementStage;
      sessionId: string;
      kind: MeasurementKind;
      startedAtUnixMs: number;
    }
  | { phase: 'awaiting_pulse'; sessionId: string; kind: MeasurementKind }
  | { phase: 'result'; record: MeasurementRecord; saved: boolean }
  | {
      phase: 'error';
      code: MeasurementErrorCode;
      message: string;
      kind: MeasurementKind;
    };

export type BleSessionState = {
  connection: ConnectionState;
  measurement: MeasurementState;
  bluetoothState: string;
  mockMode: boolean;
};

export type SessionEvent =
  | { type: 'initialize_requested' }
  | { type: 'start_scan_requested' }
  | { type: 'stop_scan_requested' }
  | { type: 'device_discovered'; device: DrunksafeBleDevice }
  | { type: 'connect_requested'; deviceId: string }
  | { type: 'connection_pending'; deviceId: string }
  | { type: 'connect_mock_requested' }
  | { type: 'disconnect_requested' }
  | { type: 'unexpected_disconnect'; deviceId: string; message: string }
  | {
      type: 'connection_attempt_failed';
      deviceId: string;
      reconnectAttempt: number;
      message: string;
    }
  | { type: 'notify_ready_timeout'; message: string }
  | { type: 'bluetooth_changed'; bluetoothState: string }
  | { type: 'start_measurement_requested'; kind: MeasurementKind }
  | { type: 'start_pulse_phase_requested' }
  | { type: 'cancel_measurement_requested' }
  | {
      type: 'device_event';
      event: DeviceEvent;
      atUnixMs: number;
      readyDevice: DrunksafeBleDevice | null;
    }
  | { type: 'record_persisted'; record: MeasurementRecord; saved: boolean }
  | { type: 'operation_failed'; message: string; unsupported: boolean }
  | { type: 'destroy_requested' };

export type SessionEffect =
  | { type: 'initialize_client' }
  | { type: 'start_scan' }
  | { type: 'stop_scan' }
  | { type: 'connect_device'; deviceId: string; reconnectAttempt: number }
  | { type: 'disconnect_client' }
  | { type: 'destroy_client' }
  | { type: 'send_command'; command: PhoneCommand }
  | { type: 'schedule_reconnect'; deviceId: string; reconnectAttempt: number }
  | { type: 'persist_record'; result: MeasurementResult; measuredAtUnixMs: number }
  | { type: 'start_mock'; kind: MeasurementKind }
  | { type: 'cancel_mock'; sessionId: string }
  | { type: 'stop_mock' };

export type SessionTransition = {
  state: BleSessionState;
  effects: SessionEffect[];
};

export const initialBleSessionState: BleSessionState = {
  connection: { phase: 'idle' },
  measurement: { phase: 'idle' },
  bluetoothState: 'Unknown',
  mockMode: false,
};

const reconnectBackoffMs = [500, 1500] as const;

export function reduceBleSession(state: BleSessionState, event: SessionEvent): SessionTransition {
  switch (event.type) {
    case 'initialize_requested':
      return transition(state, { type: 'initialize_client' });
    case 'start_scan_requested':
      if (!canScan(state)) return transition(state);

      return transition(
        {
          ...state,
          connection: {
            phase: 'scanning',
            devices: [],
            message: 'Drunksafe 장치를 찾는 중입니다.',
          },
        },
        { type: 'initialize_client' },
        { type: 'start_scan' }
      );
    case 'stop_scan_requested':
      if (state.connection.phase !== 'scanning') return transition(state);

      return transition({ ...state, connection: { phase: 'idle' } }, { type: 'stop_scan' });
    case 'device_discovered':
      if (state.connection.phase !== 'scanning') return transition(state);

      return transition({
        ...state,
        connection: {
          ...state.connection,
          devices: [
            event.device,
            ...state.connection.devices.filter((device) => device.id !== event.device.id),
          ].slice(0, 6),
          message: `${event.device.name} 장치를 찾았습니다.`,
        },
      });
    case 'connect_requested':
      if (state.bluetoothState !== 'PoweredOn' || isConnectionBusy(state.connection)) {
        return transition(state);
      }

      return transition(
        {
          ...state,
          connection: connectingState(connectionTarget(state.connection, event.deviceId), 0),
          mockMode: false,
        },
        { type: 'initialize_client' },
        { type: 'stop_mock' },
        { type: 'connect_device', deviceId: event.deviceId, reconnectAttempt: 0 }
      );
    case 'connection_pending':
      if (state.connection.phase !== 'connecting' || state.connection.deviceId !== event.deviceId) {
        return transition(state);
      }

      return transition({
        ...state,
        connection: {
          ...state.connection,
          message: 'BLE notify 구독 확인을 기다리는 중입니다.',
        },
      });
    case 'connect_mock_requested':
      return transition(
        {
          ...state,
          connection: {
            phase: 'connected',
            device: mockBleDevice,
            status: 'connected',
            message: '시뮬레이터 데모 장치가 연결됐습니다.',
          },
          measurement: { phase: 'idle' },
          mockMode: true,
        },
        { type: 'stop_mock' },
        { type: 'disconnect_client' }
      );
    case 'disconnect_requested':
      return transition(
        {
          ...state,
          connection: disconnectedConnection(state.bluetoothState),
          measurement: measurementAfterDisconnect(state.measurement),
          mockMode: false,
        },
        { type: 'stop_mock' },
        { type: 'disconnect_client' }
      );
    case 'unexpected_disconnect':
      if (
        state.connection.phase !== 'connected' ||
        state.connection.device.id !== event.deviceId ||
        state.mockMode
      ) {
        return transition(state);
      }

      return transition(
        {
          ...state,
          connection: connectingState(state.connection.device, 1),
          measurement: interruptMeasurement(state.measurement, 'connection_lost', event.message),
        },
        { type: 'disconnect_client' },
        { type: 'schedule_reconnect', deviceId: event.deviceId, reconnectAttempt: 1 }
      );
    case 'connection_attempt_failed': {
      if (state.connection.phase !== 'connecting' || state.connection.deviceId !== event.deviceId) {
        return transition(state);
      }

      if (event.reconnectAttempt > 0 && event.reconnectAttempt < reconnectBackoffMs.length) {
        const nextAttempt = event.reconnectAttempt + 1;
        return transition(
          { ...state, connection: connectingState(state.connection.device, nextAttempt) },
          { type: 'disconnect_client' },
          { type: 'schedule_reconnect', deviceId: event.deviceId, reconnectAttempt: nextAttempt }
        );
      }

      return transition(
        {
          ...state,
          connection: { phase: 'error', message: event.message },
          measurement: interruptMeasurement(state.measurement, 'ble_failure', event.message),
        },
        { type: 'disconnect_client' }
      );
    }
    case 'notify_ready_timeout':
      if (state.connection.phase !== 'connecting') return transition(state);

      return transition(
        {
          ...state,
          connection: { phase: 'error', message: event.message },
          measurement: interruptMeasurement(state.measurement, 'ble_failure', event.message),
        },
        { type: 'disconnect_client' }
      );
    case 'bluetooth_changed':
      if (state.mockMode) {
        return transition({ ...state, bluetoothState: event.bluetoothState });
      }

      if (event.bluetoothState === 'Unsupported') {
        return transition(
          {
            ...state,
            bluetoothState: event.bluetoothState,
            connection: {
              phase: 'unsupported',
              message: '이 환경에서는 BLE를 사용할 수 없습니다.',
            },
            measurement: interruptMeasurement(
              state.measurement,
              'ble_failure',
              '이 환경에서는 BLE를 사용할 수 없습니다.'
            ),
          },
          { type: 'stop_scan' },
          { type: 'disconnect_client' }
        );
      }

      if (event.bluetoothState !== 'PoweredOn' && event.bluetoothState !== 'Unauthorized') {
        const message = 'Bluetooth를 켜야 장치를 찾을 수 있습니다.';
        return transition(
          {
            ...state,
            bluetoothState: event.bluetoothState,
            connection: { phase: 'bluetooth_off', message },
            measurement: interruptMeasurement(state.measurement, 'bluetooth_off', message),
          },
          { type: 'stop_scan' },
          { type: 'disconnect_client' }
        );
      }

      return transition({
        ...state,
        bluetoothState: event.bluetoothState,
        connection:
          state.connection.phase === 'bluetooth_off' || state.connection.phase === 'unsupported'
            ? { phase: 'idle' }
            : state.connection,
      });
    case 'start_measurement_requested': {
      if (
        state.measurement.phase === 'starting' ||
        state.measurement.phase === 'active' ||
        state.measurement.phase === 'awaiting_pulse'
      ) {
        return transition(state);
      }

      if (state.connection.phase !== 'connected') {
        return transition({
          ...state,
          connection: { phase: 'error', message: '먼저 Drunksafe 장치를 연결해야 합니다.' },
        });
      }

      const nextState = {
        ...state,
        measurement: { phase: 'starting', kind: event.kind } as const,
      };

      return state.mockMode
        ? transition(nextState, { type: 'start_mock', kind: event.kind })
        : transition(nextState, {
            type: 'send_command',
            command: { cmd: 'start', kind: event.kind },
          });
    }
    case 'start_pulse_phase_requested': {
      const measurement = state.measurement;

      if (
        measurement.phase !== 'awaiting_pulse' ||
        state.connection.phase !== 'connected' ||
        state.mockMode
      ) {
        return transition(state);
      }

      return transition(state, {
        type: 'send_command',
        command: { cmd: 'start_pulse_phase', session_id: measurement.sessionId },
      });
    }
    case 'cancel_measurement_requested': {
      const measurement = state.measurement;

      if (measurement.phase !== 'active' && measurement.phase !== 'awaiting_pulse') {
        return transition(state);
      }

      if (state.mockMode && measurement.phase === 'active') {
        return transition(
          {
            ...state,
            measurement: measurementError('cancelled', '측정이 취소됐습니다.', measurement.kind),
          },
          { type: 'cancel_mock', sessionId: measurement.sessionId }
        );
      }

      return transition(state, {
        type: 'send_command',
        command: { cmd: 'cancel', session_id: measurement.sessionId },
      });
    }
    case 'device_event':
      return reduceDeviceEvent(state, event.event, event.atUnixMs, event.readyDevice);
    case 'record_persisted':
      if (
        state.measurement.phase !== 'active' ||
        state.measurement.sessionId !== event.record.session_id ||
        state.measurement.kind !== event.record.kind
      ) {
        return transition(state);
      }

      return transition({
        ...state,
        measurement: { phase: 'result', record: event.record, saved: event.saved },
      });
    case 'operation_failed':
      return transition(
        {
          ...state,
          connection: event.unsupported
            ? { phase: 'unsupported', message: event.message }
            : { phase: 'error', message: event.message },
          measurement: interruptMeasurement(state.measurement, 'ble_failure', event.message),
          mockMode: false,
        },
        { type: 'stop_mock' },
        { type: 'disconnect_client' }
      );
    case 'destroy_requested':
      return transition(initialBleSessionState, { type: 'stop_mock' }, { type: 'destroy_client' });
  }
}

function reduceDeviceEvent(
  state: BleSessionState,
  event: DeviceEvent,
  atUnixMs: number,
  readyDevice: DrunksafeBleDevice | null
): SessionTransition {
  switch (event.event) {
    case 'status': {
      const connection = connectedAfterStatus(state.connection, event.status, readyDevice);
      let measurement = state.measurement;
      const sessionId = event.active_session_id;

      if (event.status === 'measuring' && sessionId) {
        if (measurement.phase === 'starting') {
          // 1단계 시작: 알코올 측정.
          measurement = {
            phase: 'active',
            stage: 'alcohol',
            sessionId,
            kind: measurement.kind,
            startedAtUnixMs: atUnixMs,
          };
        } else if (measurement.phase === 'awaiting_pulse' && measurement.sessionId === sessionId) {
          // 2단계 시작: 심박 측정.
          measurement = {
            phase: 'active',
            stage: 'pulse',
            sessionId,
            kind: measurement.kind,
            startedAtUnixMs: atUnixMs,
          };
        }
      } else if (event.status === 'awaiting_pulse' && sessionId) {
        if (
          measurement.phase === 'starting' ||
          (measurement.phase === 'active' &&
            measurement.stage === 'alcohol' &&
            measurement.sessionId === sessionId)
        ) {
          measurement = { phase: 'awaiting_pulse', sessionId, kind: measurement.kind };
        }
      } else if (
        event.status === 'idle' &&
        sessionId === null &&
        (measurement.phase === 'active' || measurement.phase === 'awaiting_pulse')
      ) {
        measurement = measurementError(
          'ble_failure',
          '측정이 기기에서 예기치 않게 종료됐습니다.',
          measurement.kind
        );
      }

      return connection === state.connection && measurement === state.measurement
        ? transition(state)
        : transition({ ...state, connection, measurement });
    }
    case 'measurement_started': {
      if (state.connection.phase !== 'connected') return transition(state);

      // 이미 심박 대기/심박 측정 단계로 넘어간 뒤 도착한 중복 시작 이벤트는 무시한다.
      if (state.measurement.phase === 'awaiting_pulse') return transition(state);
      if (state.measurement.phase === 'active' && state.measurement.stage === 'pulse') {
        return transition(state);
      }

      if (
        state.measurement.phase === 'active' &&
        state.measurement.sessionId !== event.session_id
      ) {
        return transition(state);
      }

      if (state.measurement.phase === 'starting' && state.measurement.kind !== event.kind) {
        return transition(state);
      }

      return transition({
        ...state,
        measurement: {
          phase: 'active',
          stage: 'alcohol',
          sessionId: event.session_id,
          kind: event.kind,
          startedAtUnixMs:
            state.measurement.phase === 'active' ? state.measurement.startedAtUnixMs : atUnixMs,
        },
      });
    }
    case 'measurement_result':
      if (
        state.measurement.phase !== 'active' ||
        state.measurement.sessionId !== event.session_id ||
        state.measurement.kind !== event.kind
      ) {
        return transition(state);
      }

      return transition(state, {
        type: 'persist_record',
        result: event,
        measuredAtUnixMs: atUnixMs,
      });
    case 'device_error': {
      const kind = activeMeasurementKind(state.measurement);

      if (
        event.session_id &&
        (state.measurement.phase !== 'active' || state.measurement.sessionId !== event.session_id)
      ) {
        return transition(state);
      }

      return transition({
        ...state,
        connection:
          state.connection.phase === 'connected'
            ? { ...state.connection, status: 'error' }
            : state.connection,
        measurement: measurementError(event.code, measurementErrorMessage(event.code), kind),
      });
    }
    case 'alcohol_state':
    case 'ppg_sample':
    case 'pulse_reading':
    case 'session_status':
    case 'session_record':
    case 'session_complete':
      // BleSessionStore.receiveDeviceEvent()가 리듀서로 보내기 전에 가로채 각각 알코올
      // 상태 / ppg 링버퍼 / pulse 진단 / 세션 스토어에 직접 반영한다. 여기 도달하면 상태
      // 변화 없이 무시한다 (타입 완전성 확보용).
      return transition(state);
  }
}

function connectedAfterStatus(
  connection: ConnectionState,
  status: StatusKind,
  readyDevice: DrunksafeBleDevice | null
): ConnectionState {
  if (readyDevice) {
    return { phase: 'connected', device: readyDevice, status, message: null };
  }

  if (connection.phase === 'connected') {
    return { ...connection, status };
  }

  return connection;
}

function transition(state: BleSessionState, ...effects: SessionEffect[]): SessionTransition {
  return { state, effects };
}

function canScan(state: BleSessionState) {
  return (
    !state.mockMode &&
    (state.bluetoothState === 'PoweredOn' || state.bluetoothState === 'Unauthorized') &&
    (state.connection.phase === 'idle' ||
      state.connection.phase === 'error' ||
      state.connection.phase === 'scanning') &&
    state.measurement.phase !== 'starting' &&
    state.measurement.phase !== 'active' &&
    state.measurement.phase !== 'awaiting_pulse'
  );
}

function isConnectionBusy(connection: ConnectionState) {
  return connection.phase === 'connecting' || connection.phase === 'connected';
}

function connectingState(device: DrunksafeBleDevice, reconnectAttempt: number): ConnectionState {
  return {
    phase: 'connecting',
    deviceId: device.id,
    device,
    reconnectAttempt,
    message:
      reconnectAttempt === 0
        ? 'Drunksafe 장치에 연결하는 중입니다.'
        : `장치 자동 재연결을 시도합니다. (${reconnectAttempt}/${reconnectBackoffMs.length})`,
  };
}

function connectionTarget(connection: ConnectionState, deviceId: string): DrunksafeBleDevice {
  if (connection.phase === 'scanning') {
    const device = connection.devices.find((candidate) => candidate.id === deviceId);
    if (device) return device;
  }

  if (
    (connection.phase === 'connecting' || connection.phase === 'connected') &&
    connection.device.id === deviceId
  ) {
    return connection.device;
  }

  return { id: deviceId, name: 'Drunksafe', rssi: null, serviceUUIDs: [] };
}

function disconnectedConnection(bluetoothState: string): ConnectionState {
  if (bluetoothState === 'Unsupported') {
    return { phase: 'unsupported', message: '이 환경에서는 BLE를 사용할 수 없습니다.' };
  }

  if (bluetoothState !== 'PoweredOn' && bluetoothState !== 'Unauthorized') {
    return { phase: 'bluetooth_off', message: 'Bluetooth를 켜야 장치를 찾을 수 있습니다.' };
  }

  return { phase: 'idle' };
}

function measurementAfterDisconnect(measurement: MeasurementState): MeasurementState {
  if (
    measurement.phase === 'starting' ||
    measurement.phase === 'active' ||
    measurement.phase === 'awaiting_pulse'
  ) {
    return measurementError('connection_lost', '측정 중 연결이 해제되었습니다.', measurement.kind);
  }

  if (measurement.phase === 'result' && !measurement.saved) return measurement;

  return { phase: 'idle' };
}

function interruptMeasurement(
  measurement: MeasurementState,
  code: MeasurementErrorCode,
  message: string
): MeasurementState {
  if (
    measurement.phase !== 'starting' &&
    measurement.phase !== 'active' &&
    measurement.phase !== 'awaiting_pulse'
  ) {
    return measurement;
  }

  return measurementError(code, message, measurement.kind);
}

function activeMeasurementKind(measurement: MeasurementState): MeasurementKind {
  switch (measurement.phase) {
    case 'starting':
    case 'active':
    case 'awaiting_pulse':
      return measurement.kind;
    case 'result':
      return measurement.record.kind;
    case 'error':
      return measurement.kind;
    case 'idle':
      return 'measurement';
  }
}

function measurementError(
  code: MeasurementErrorCode,
  message: string,
  kind: MeasurementKind
): MeasurementState {
  return { phase: 'error', code, message, kind };
}

function measurementErrorMessage(code: ErrorCode) {
  const labels: Record<ErrorCode, string> = {
    alcohol_sensor: '알코올 센서 오류가 감지됐습니다.',
    measurement_timeout: '측정 시간이 초과됐습니다.',
    cancelled: '측정이 취소됐습니다.',
  };

  return labels[code];
}
