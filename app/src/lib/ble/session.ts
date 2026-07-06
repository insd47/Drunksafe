import { useSyncExternalStore } from 'react';

import { DrunksafeBleClient, type DrunksafeBleDevice } from '@/lib/ble/client';
import type {
  DeviceEvent,
  ErrorCode,
  MeasurementProgress,
  MeasurementResult,
  StatusKind,
} from '@/lib/ble/model';
import { recordFromResult, saveMeasurement, type MeasurementKind } from '@/lib/storage/history';
import { buildPhoneContext, readBaseline, writeBaseline } from '@/lib/storage/profile';

type Removable = {
  remove: () => void;
};

export type BleConnectionPhase =
  | 'idle'
  | 'bluetooth_off'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'unsupported'
  | 'error';

export type BleMeasurementPhase =
  | 'idle'
  | 'starting'
  | 'waiting_context'
  | 'measuring'
  | 'result'
  | 'error';

export type BleSessionSnapshot = {
  bluetoothState: string;
  connectionPhase: BleConnectionPhase;
  measurementPhase: BleMeasurementPhase;
  devices: DrunksafeBleDevice[];
  connectedDevice: DrunksafeBleDevice | null;
  deviceStatus: StatusKind | null;
  activeMeasurementKind: MeasurementKind;
  activeSessionId: string | null;
  progress: MeasurementProgress | null;
  result: MeasurementResult | null;
  resultSaved: boolean;
  deviceErrorCode: ErrorCode | null;
  message: string | null;
  contextSentSessionId: string | null;
};

const initialSnapshot: BleSessionSnapshot = {
  bluetoothState: 'Unknown',
  connectionPhase: 'idle',
  measurementPhase: 'idle',
  devices: [],
  connectedDevice: null,
  deviceStatus: null,
  activeMeasurementKind: 'measurement',
  activeSessionId: null,
  progress: null,
  result: null,
  resultSaved: false,
  deviceErrorCode: null,
  message: null,
  contextSentSessionId: null,
};

class BleSessionStore {
  private client: DrunksafeBleClient | null = null;
  private stateSubscription: Removable | null = null;
  private eventSubscription: Removable | null = null;
  private readonly listeners = new Set<() => void>();
  private snapshot = initialSnapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  initialize = () => {
    if (this.client) {
      return;
    }

    this.client = new DrunksafeBleClient();
    this.client
      .state()
      .then((state) => this.setBluetoothState(String(state)))
      .catch((error) => this.fail(error));

    this.stateSubscription = this.client.onStateChange((state) => {
      this.setBluetoothState(String(state));
    });
  };

  startScan = async () => {
    this.initialize();

    if (!this.client || !this.canUseBluetooth()) {
      return;
    }

    this.set({
      connectionPhase: 'scanning',
      devices: [],
      message: 'Drunksafe 장치를 찾는 중입니다.',
    });

    try {
      await this.client.startScan({
        onDevice: (device) => this.addDevice(device),
        onError: (error) => this.fail(error),
      });
    } catch (error) {
      this.fail(error);
    }
  };

  stopScan = async () => {
    if (!this.client) {
      return;
    }

    await this.client.stopScan();

    if (this.snapshot.connectionPhase === 'scanning') {
      this.set({
        connectionPhase: this.snapshot.connectedDevice ? 'connected' : 'idle',
        message: null,
      });
    }
  };

  connect = async (deviceId: string) => {
    this.initialize();

    if (!this.client || !this.canUseBluetooth()) {
      return;
    }

    this.set({
      connectionPhase: 'connecting',
      message: 'Drunksafe 장치에 연결하는 중입니다.',
    });

    try {
      const device = await this.client.connect(deviceId);
      this.eventSubscription?.remove();
      this.eventSubscription = this.client.monitorEvents(
        (event) => {
          void this.handleEvent(event);
        },
        (error) => this.fail(error)
      );

      this.set({
        connectionPhase: 'connected',
        connectedDevice: device,
        message: '장치가 연결됐습니다.',
      });

      await this.client.send({ cmd: 'time', unix_time_ms: Date.now() });
    } catch (error) {
      this.fail(error);
    }
  };

  disconnect = async () => {
    if (!this.client) {
      return;
    }

    this.eventSubscription?.remove();
    this.eventSubscription = null;
    await this.client.disconnect();
    this.set({
      connectionPhase: this.canUseBluetooth() ? 'idle' : this.snapshot.connectionPhase,
      measurementPhase: 'idle',
      connectedDevice: null,
      deviceStatus: null,
      activeSessionId: null,
      progress: null,
      message: null,
    });
  };

  startMeasurement = async (kind: MeasurementKind = 'measurement') => {
    if (
      !this.client ||
      !this.snapshot.connectedDevice ||
      this.snapshot.connectionPhase !== 'connected'
    ) {
      this.set({
        connectionPhase: this.snapshot.connectionPhase === 'unsupported' ? 'unsupported' : 'error',
        message: '먼저 Drunksafe 장치를 연결해야 합니다.',
      });
      return;
    }

    this.set({
      measurementPhase: 'starting',
      activeMeasurementKind: kind,
      progress: null,
      result: null,
      resultSaved: false,
      deviceErrorCode: null,
      message: '측정 시작 명령을 보냈습니다.',
    });

    try {
      await this.client.send({ cmd: 'start' });
    } catch (error) {
      this.fail(error);
    }
  };

  destroy = async () => {
    this.eventSubscription?.remove();
    this.eventSubscription = null;
    this.stateSubscription?.remove();
    this.stateSubscription = null;

    if (this.client) {
      await this.client.destroy().catch(() => {});
      this.client = null;
    }

    this.set(initialSnapshot);
  };

  private async handleEvent(event: DeviceEvent) {
    switch (event.event) {
      case 'status':
        this.set({
          deviceStatus: event.status,
          activeSessionId: event.active_session_id,
          connectionPhase: 'connected',
          message: null,
        });
        return;
      case 'measurement_started':
        await this.handleMeasurementStarted(event);
        return;
      case 'measurement_progress':
        this.set({
          measurementPhase: event.step === 'done' ? 'result' : 'measuring',
          activeSessionId: event.session_id,
          progress: event,
          message: stepMessage(event),
        });
        return;
      case 'measurement_result':
        await this.handleMeasurementResult(event);
        return;
      case 'device_error':
        this.set({
          measurementPhase: 'error',
          activeSessionId: event.session_id,
          deviceErrorCode: event.code,
          message: errorMessage(event.code),
        });
        return;
    }
  }

  private async handleMeasurementStarted(
    event: Extract<DeviceEvent, { event: 'measurement_started' }>
  ) {
    const activeMeasurementKind =
      this.snapshot.measurementPhase === 'starting'
        ? this.snapshot.activeMeasurementKind
        : 'measurement';

    this.set({
      measurementPhase: event.needs_context ? 'waiting_context' : 'measuring',
      activeMeasurementKind,
      activeSessionId: event.session_id,
      progress: null,
      result: null,
      resultSaved: false,
      deviceErrorCode: null,
      message: event.needs_context ? '측정 context를 준비하는 중입니다.' : '측정이 시작됐습니다.',
    });

    if (!this.client) {
      return;
    }

    try {
      if (event.sync_time) {
        await this.client.send({ cmd: 'time', unix_time_ms: Date.now() });
      }

      if (event.needs_context) {
        const context = await buildPhoneContext(event.session_id, event.history_limit);
        await this.client.send({ cmd: 'context', ...context });
        this.set({
          measurementPhase: 'measuring',
          contextSentSessionId: event.session_id,
          message: '측정 context를 보냈습니다.',
        });
      }
    } catch (error) {
      this.fail(error);
    }
  }

  private async handleMeasurementResult(
    event: Extract<DeviceEvent, { event: 'measurement_result' }>
  ) {
    let resultSaved = true;
    const kind = this.snapshot.activeMeasurementKind;

    try {
      await saveMeasurement(recordFromResult(event, kind));

      if (kind === 'baseline') {
        await saveBaselineFromResult(event);
      }
    } catch {
      resultSaved = false;
    }

    this.set({
      measurementPhase: 'result',
      activeMeasurementKind: kind,
      activeSessionId: event.session_id,
      progress: null,
      result: event,
      resultSaved,
      message: resultSaved ? '결과를 히스토리에 저장했습니다.' : '결과 저장에 실패했습니다.',
    });

    if (this.client && resultSaved) {
      await this.client.send({ cmd: 'ack', session_id: event.session_id }).catch(() => {});
    }
  }

  private addDevice(device: DrunksafeBleDevice) {
    const devices = [
      device,
      ...this.snapshot.devices.filter((item) => item.id !== device.id),
    ].slice(0, 6);

    this.set({ devices, message: `${device.name} 장치를 찾았습니다.` });
  }

  private setBluetoothState(state: string) {
    const patch: Partial<BleSessionSnapshot> = { bluetoothState: state };

    if (state === 'Unsupported') {
      this.clearEventMonitor();
      patch.connectionPhase = 'unsupported';
      patch.connectedDevice = null;
      patch.deviceStatus = null;
      patch.message = '이 환경에서는 BLE를 사용할 수 없습니다.';
    } else if (state !== 'PoweredOn') {
      this.clearEventMonitor();
      patch.connectionPhase = 'bluetooth_off';
      patch.connectedDevice = null;
      patch.deviceStatus = null;
      patch.measurementPhase = this.isActiveMeasurement()
        ? 'error'
        : this.snapshot.measurementPhase;
      patch.message = 'Bluetooth를 켜야 장치를 찾을 수 있습니다.';
    } else if (
      this.snapshot.connectionPhase === 'bluetooth_off' ||
      this.snapshot.connectionPhase === 'unsupported'
    ) {
      patch.connectionPhase = this.snapshot.connectedDevice ? 'connected' : 'idle';
      patch.message = null;
    }

    this.set(patch);
  }

  private canUseBluetooth() {
    return this.snapshot.bluetoothState === 'PoweredOn';
  }

  private isActiveMeasurement() {
    return (
      this.snapshot.measurementPhase === 'starting' ||
      this.snapshot.measurementPhase === 'waiting_context' ||
      this.snapshot.measurementPhase === 'measuring'
    );
  }

  private fail(error: unknown) {
    const message = error instanceof Error ? error.message : 'BLE 작업에 실패했습니다.';
    const unsupported = /available only in native builds|unsupported/i.test(message);
    const measurementFailed = this.isActiveMeasurement();

    this.clearEventMonitor();
    this.set({
      connectionPhase: unsupported ? 'unsupported' : 'error',
      connectedDevice: null,
      deviceStatus: null,
      measurementPhase: measurementFailed ? 'error' : this.snapshot.measurementPhase,
      message,
    });
  }

  private set(patch: Partial<BleSessionSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private clearEventMonitor() {
    this.eventSubscription?.remove();
    this.eventSubscription = null;
  }
}

export const bleSession = new BleSessionStore();

export function useBleSession() {
  const snapshot = useSyncExternalStore(
    bleSession.subscribe,
    bleSession.getSnapshot,
    bleSession.getSnapshot
  );

  return {
    ...snapshot,
    initialize: bleSession.initialize,
    startScan: bleSession.startScan,
    stopScan: bleSession.stopScan,
    connect: bleSession.connect,
    disconnect: bleSession.disconnect,
    startMeasurement: bleSession.startMeasurement,
    destroy: bleSession.destroy,
  };
}

function stepMessage(progress: MeasurementProgress) {
  if (progress.step === 'waiting_breath') {
    return '호기 입력을 기다리는 중입니다.';
  }

  if (progress.step === 'sampling_breath') {
    return '호기 알코올을 측정하고 있습니다.';
  }

  if (progress.step === 'sampling_pulse') {
    return '심박 신호를 확인하고 있습니다.';
  }

  if (progress.step === 'analyzing') {
    return '결과를 분석하고 있습니다.';
  }

  return '측정이 진행 중입니다.';
}

function errorMessage(code: ErrorCode) {
  const labels: Record<ErrorCode, string> = {
    context_timeout: '측정 context 전송 시간이 초과됐습니다.',
    alcohol_sensor: '알코올 센서 오류가 감지됐습니다.',
    pulse_sensor: '심박 센서 오류가 감지됐습니다.',
    weak_breath: '호기 입력이 약합니다.',
    measurement_timeout: '측정 시간이 초과됐습니다.',
    cancelled: '측정이 취소됐습니다.',
    protocol: 'BLE protocol 오류가 발생했습니다.',
  };

  return labels[code];
}

async function saveBaselineFromResult(result: MeasurementResult) {
  const baseline = await readBaseline();
  const previousCount = baseline.sample_count;
  const sampleCount = Math.min(previousCount + 1, 65535);
  const alcohol = result.alcohol.mg_l_x1000;
  const previousMean = baseline.sober_alcohol_mg_l_x1000;
  const alcoholDeviation = previousMean === null ? 0 : Math.abs(alcohol - previousMean);
  const stableBpm = result.pulse?.stable ? clampU16(Math.round(result.pulse.bpm)) : null;

  await writeBaseline({
    ...baseline,
    sober_alcohol_mg_l_x1000: rollingAverage(previousMean, previousCount, alcohol),
    sober_alcohol_mad_mg_l_x1000: rollingAverage(
      baseline.sober_alcohol_mad_mg_l_x1000,
      previousCount,
      alcoholDeviation
    ),
    resting_bpm:
      stableBpm === null
        ? baseline.resting_bpm
        : rollingAverage(baseline.resting_bpm, previousCount, stableBpm),
    sample_count: sampleCount,
    updated_at_unix_ms: result.measured_at_unix_ms ?? Date.now(),
  });
}

function rollingAverage(previous: number | null, previousCount: number, next: number) {
  if (previous === null || previousCount <= 0) {
    return clampU16(next);
  }

  return clampU16(Math.round((previous * previousCount + next) / (previousCount + 1)));
}

function clampU16(value: number) {
  return Math.max(0, Math.min(65535, value));
}
