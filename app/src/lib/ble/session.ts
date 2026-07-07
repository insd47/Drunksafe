import { useSyncExternalStore } from 'react';

import { DrunksafeBleClient, type DrunksafeBleDevice } from '@/lib/ble/client';
import {
  connectedDeviceAfterNotifySubscriptionReady,
  notifySubscriptionPendingMessage,
  notifySubscriptionReadyTimeoutMs,
  notifySubscriptionTimeoutMessage,
} from '@/lib/ble/connection-readiness';
import type {
  DeviceEvent,
  ErrorCode,
  MeasurementProgress,
  MeasurementResult,
  StatusKind,
} from '@/lib/ble/model';
import {
  createMockProgressEvent,
  createMockResultEvent,
  createMockSessionId,
  createMockStartedEvent,
  mockBleDevice,
  mockProgressPlan,
} from '@/lib/ble/mock';
import { hasActiveMeasurement, type BleMeasurementPhase } from '@/lib/ble/measurement-phase';
import {
  activeSessionIdAfterStatusNotify,
  disconnectSessionPatch,
  interruptedMeasurementPatch,
  statusMessageAfterNotify,
  terminalDeviceErrorPatch,
} from '@/lib/ble/session-patches';
import { recordFromResult, saveMeasurement, type MeasurementKind } from '@/lib/storage/history';
import {
  savedResultMessage,
  shouldUpdateSoberBaseline,
} from '@/lib/personalization/baseline-acceptance';
import { buildPhoneContext, readBaseline, writeBaseline } from '@/lib/storage/profile';

export type { BleMeasurementPhase } from '@/lib/ble/measurement-phase';

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
  mockMode: boolean;
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
  mockMode: false,
};

class BleSessionStore {
  private client: DrunksafeBleClient | null = null;
  private stateSubscription: Removable | null = null;
  private eventSubscription: Removable | null = null;
  private pendingConnectedDevice: DrunksafeBleDevice | null = null;
  private notifyReadyTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly mockTimers = new Set<ReturnType<typeof setTimeout>>();
  private readonly cancelledSessionIds = new Set<string>();
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

    this.clearNotifyReadyWait();
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

    this.clearNotifyReadyWait();
    this.set({
      connectionPhase: 'connecting',
      message: 'Drunksafe 장치에 연결하는 중입니다.',
    });

    try {
      const device = await this.client.connect(deviceId);
      this.clearEventMonitor();
      this.pendingConnectedDevice = device;
      this.set({
        connectionPhase: 'connecting',
        connectedDevice: null,
        deviceStatus: null,
        message: notifySubscriptionPendingMessage,
      });
      this.eventSubscription = this.client.monitorEvents(
        (event) => {
          void this.handleEvent(event);
        },
        (error) => this.fail(error)
      );
      this.scheduleNotifyReadyTimeout(device.id);

      await this.client.send({ cmd: 'time', unix_time_ms: Date.now() });
    } catch (error) {
      this.fail(error);
    }
  };

  connectMockDevice = async () => {
    this.clearNotifyReadyWait();
    this.clearMockTimers();
    this.eventSubscription?.remove();
    this.eventSubscription = null;

    this.set({
      connectionPhase: 'connected',
      measurementPhase: 'idle',
      devices: [mockBleDevice],
      connectedDevice: mockBleDevice,
      deviceStatus: 'connected',
      activeSessionId: null,
      progress: null,
      result: null,
      resultSaved: false,
      deviceErrorCode: null,
      message: '시뮬레이터 데모 장치가 연결됐습니다.',
      contextSentSessionId: null,
      mockMode: true,
    });
  };

  disconnect = async () => {
    this.clearNotifyReadyWait();

    if (this.snapshot.mockMode) {
      this.clearMockTimers();
      this.set({
        connectionPhase: this.snapshot.bluetoothState === 'Unsupported' ? 'unsupported' : 'idle',
        connectedDevice: null,
        deviceStatus: null,
        mockMode: false,
        ...disconnectSessionPatch({
          result: this.snapshot.result,
          resultSaved: this.snapshot.resultSaved,
        }),
      });
      return;
    }

    if (!this.client) {
      return;
    }

    this.eventSubscription?.remove();
    this.eventSubscription = null;
    await this.client.disconnect();
    this.set({
      connectionPhase: this.canUseBluetooth() ? 'idle' : this.snapshot.connectionPhase,
      connectedDevice: null,
      deviceStatus: null,
      ...disconnectSessionPatch({
        result: this.snapshot.result,
        resultSaved: this.snapshot.resultSaved,
      }),
    });
  };

  cancelMeasurement = async () => {
    const sessionId = this.snapshot.activeSessionId;

    if (!sessionId || !this.isActiveMeasurement()) {
      return;
    }

    if (this.snapshot.mockMode) {
      this.cancelledSessionIds.add(sessionId);
      this.clearMockTimers();
      this.set({
        measurementPhase: 'error',
        progress: null,
        result: null,
        resultSaved: false,
        deviceErrorCode: 'cancelled',
        message: errorMessage('cancelled'),
      });
      return;
    }

    if (!this.client) {
      return;
    }

    this.set({
      message: '측정 취소를 요청했습니다.',
    });

    try {
      this.cancelledSessionIds.add(sessionId);
      await this.client.send({ cmd: 'cancel', session_id: sessionId });
    } catch (error) {
      this.fail(error);
    }
  };

  startMeasurement = async (kind: MeasurementKind = 'measurement') => {
    if (this.isActiveMeasurement()) {
      this.set({
        message: '이미 측정이 진행 중입니다.',
      });
      return;
    }

    if (this.snapshot.mockMode) {
      await this.startMockMeasurement(kind);
      return;
    }

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
      activeSessionId: null,
      progress: null,
      result: null,
      resultSaved: false,
      deviceErrorCode: null,
      message: '측정 시작 명령을 보냈습니다.',
      contextSentSessionId: null,
    });

    try {
      await this.client.send({ cmd: 'start', kind });
    } catch (error) {
      this.fail(error);
    }
  };

  destroy = async () => {
    this.clearNotifyReadyWait();
    this.clearMockTimers();
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
        const connectedDevice = connectedDeviceAfterNotifySubscriptionReady({
          currentConnectedDevice: this.snapshot.connectedDevice,
          pendingConnectedDevice: this.consumePendingConnectedDevice(),
        });

        this.set({
          connectedDevice,
          deviceStatus: event.status,
          activeSessionId: activeSessionIdAfterStatusNotify({
            status: event.status,
            measurementPhase: this.snapshot.measurementPhase,
            currentActiveSessionId: this.snapshot.activeSessionId,
            notifiedActiveSessionId: event.active_session_id,
          }),
          connectionPhase: 'connected',
          message: statusMessageAfterNotify({
            status: event.status,
            measurementPhase: this.snapshot.measurementPhase,
            currentMessage: this.snapshot.message,
          }),
        });
        return;
      case 'measurement_started':
        await this.handleMeasurementStarted(event);
        return;
      case 'measurement_progress':
        if (this.cancelledSessionIds.has(event.session_id)) {
          return;
        }

        this.set({
          measurementPhase: event.step === 'done' ? 'result' : 'measuring',
          activeSessionId: event.session_id,
          progress: event,
          message: stepMessage(event),
        });
        return;
      case 'measurement_result':
        if (this.cancelledSessionIds.has(event.session_id)) {
          this.cancelledSessionIds.delete(event.session_id);
          this.set({
            measurementPhase: 'error',
            activeSessionId: event.session_id,
            progress: null,
            result: null,
            resultSaved: false,
            deviceErrorCode: 'cancelled',
            message: errorMessage('cancelled'),
          });
          return;
        }

        this.cancelledSessionIds.delete(event.session_id);
        await this.handleMeasurementResult(event);
        return;
      case 'device_error':
        if (event.session_id) {
          this.cancelledSessionIds.delete(event.session_id);
        }
        this.set(terminalDeviceErrorPatch(event, errorMessage(event.code)));
        return;
    }
  }

  private async handleMeasurementStarted(
    event: Extract<DeviceEvent, { event: 'measurement_started' }>
  ) {
    this.set({
      measurementPhase: event.needs_context ? 'waiting_context' : 'measuring',
      activeMeasurementKind: event.kind,
      activeSessionId: event.session_id,
      progress: null,
      result: null,
      resultSaved: false,
      deviceErrorCode: null,
      message: event.needs_context ? '측정 context를 준비하는 중입니다.' : '측정이 시작됐습니다.',
    });

    if (this.snapshot.mockMode) {
      if (event.needs_context) {
        await buildPhoneContext(event.session_id, event.history_limit);

        if (this.cancelledSessionIds.has(event.session_id)) {
          return;
        }

        this.set({
          measurementPhase: 'measuring',
          contextSentSessionId: event.session_id,
          message: '시뮬레이터 측정 context를 준비했습니다.',
        });
      }
      return;
    }

    if (!this.client) {
      return;
    }

    try {
      if (event.sync_time) {
        await this.client.send({ cmd: 'time', unix_time_ms: Date.now() });
      }

      if (event.needs_context) {
        const context = await buildPhoneContext(event.session_id, event.history_limit);

        if (this.cancelledSessionIds.has(event.session_id)) {
          return;
        }

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
    let baselineAccepted: boolean | null = null;
    const kind = event.kind;

    try {
      const { inserted } = await saveMeasurement(recordFromResult(event));

      if (kind === 'baseline') {
        baselineAccepted = shouldUpdateSoberBaseline(event);

        if (baselineAccepted && inserted) {
          await saveBaselineFromResult(event);
        }
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
      message: resultSaved
        ? savedResultMessage({ kind, baselineAccepted })
        : '결과 저장에 실패했습니다.',
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
    if (this.snapshot.mockMode) {
      this.set({ bluetoothState: state });
      return;
    }

    const patch: Partial<BleSessionSnapshot> = { bluetoothState: state };

    if (state === 'Unsupported') {
      this.clearNotifyReadyWait();
      this.clearEventMonitor();
      patch.connectionPhase = 'unsupported';
      patch.connectedDevice = null;
      patch.deviceStatus = null;
      patch.message = '이 환경에서는 BLE를 사용할 수 없습니다.';
    } else if (state !== 'PoweredOn') {
      this.clearNotifyReadyWait();
      this.clearEventMonitor();
      const message = 'Bluetooth를 켜야 장치를 찾을 수 있습니다.';

      patch.connectionPhase = 'bluetooth_off';
      patch.connectedDevice = null;
      patch.deviceStatus = null;

      if (this.isActiveMeasurement()) {
        Object.assign(patch, interruptedMeasurementPatch(message));
      } else {
        patch.message = message;
      }
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
    return hasActiveMeasurement(this.snapshot);
  }

  private fail(error: unknown) {
    const message = error instanceof Error ? error.message : 'BLE 작업에 실패했습니다.';
    const unsupported = /available only in native builds|unsupported/i.test(message);
    const measurementFailed = this.isActiveMeasurement();
    const sessionPatch = measurementFailed ? interruptedMeasurementPatch(message) : { message };

    this.clearNotifyReadyWait();
    this.clearEventMonitor();
    this.set({
      connectionPhase: unsupported ? 'unsupported' : 'error',
      connectedDevice: null,
      deviceStatus: null,
      ...sessionPatch,
    });
  }

  private async startMockMeasurement(kind: MeasurementKind) {
    const sessionId = createMockSessionId(kind);
    this.clearMockTimers();
    this.set({
      measurementPhase: 'starting',
      activeMeasurementKind: kind,
      activeSessionId: sessionId,
      progress: null,
      result: null,
      resultSaved: false,
      deviceErrorCode: null,
      message: '시뮬레이터 측정을 시작했습니다.',
    });

    await this.handleEvent(createMockStartedEvent(sessionId, kind));

    if (this.cancelledSessionIds.has(sessionId) || !this.isActiveMeasurement()) {
      return;
    }

    mockProgressPlan.forEach((progress) => {
      this.scheduleMockEvent(async () => {
        await this.handleEvent(createMockProgressEvent(sessionId, progress.step, progress.percent));
      }, progress.delayMs);
    });

    this.scheduleMockEvent(async () => {
      await this.handleEvent(createMockResultEvent(sessionId, kind));
    }, 3800);
  }

  private scheduleMockEvent(callback: () => Promise<void>, delayMs: number) {
    const timer = setTimeout(() => {
      this.mockTimers.delete(timer);
      void callback();
    }, delayMs);

    this.mockTimers.add(timer);
  }

  private clearMockTimers() {
    this.mockTimers.forEach((timer) => clearTimeout(timer));
    this.mockTimers.clear();
  }

  private scheduleNotifyReadyTimeout(deviceId: string) {
    this.clearNotifyReadyTimer();
    this.notifyReadyTimer = setTimeout(() => {
      if (this.pendingConnectedDevice?.id === deviceId) {
        this.fail(new Error(notifySubscriptionTimeoutMessage));
      }
    }, notifySubscriptionReadyTimeoutMs);
  }

  private consumePendingConnectedDevice() {
    const device = this.pendingConnectedDevice;
    this.pendingConnectedDevice = null;
    this.clearNotifyReadyTimer();

    return device;
  }

  private clearNotifyReadyWait() {
    this.pendingConnectedDevice = null;
    this.clearNotifyReadyTimer();
  }

  private clearNotifyReadyTimer() {
    if (this.notifyReadyTimer) {
      clearTimeout(this.notifyReadyTimer);
      this.notifyReadyTimer = null;
    }
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
    connectMockDevice: bleSession.connectMockDevice,
    disconnect: bleSession.disconnect,
    cancelMeasurement: bleSession.cancelMeasurement,
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
