import type { DrunksafeBleDevice } from '@/lib/ble/client';
import {
  canRequestBleScan,
  notifySubscriptionPendingMessage,
} from '@/lib/ble/connection-readiness';
import type { DeviceEvent, PhoneCommand } from '@/lib/ble/model';
import { createMockSessionId, createMockStartedEvent, mockBleDevice } from '@/lib/ble/mock';
import { hasActiveMeasurement } from '@/lib/ble/measurement-phase';
import BleConnection, {
  BleConnectionCancelledError,
  type BleClientFactory,
} from '@/lib/ble/session/connection';
import BleEventHandler, { type EventDependencies } from '@/lib/ble/session/event-handler';
import { measurementErrorMessage } from '@/lib/ble/session/messages';
import MockTimeline from '@/lib/ble/session/mock-timeline';
import {
  disconnectOrInterruptSessionPatch,
  interruptedMeasurementPatch,
} from '@/lib/ble/session-patches';
import { initialBleSession, type BleSessionSnapshot } from '@/lib/ble/session/state';
import {
  commandVerificationPatch,
  eventVerificationPatch,
  stateVerificationPatch,
} from '@/lib/ble/session/verification';
import type { MeasurementKind } from '@/lib/storage/history';

export class BleSessionStore {
  private readonly cancelledSessionIds = new Set<string>();
  private readonly events: BleEventHandler;
  private readonly connection: BleConnection;
  private readonly mockTimeline = new MockTimeline();
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;
  private snapshot = initialBleSession;

  constructor({ createClient, ...eventDependencies }: StoreDependencies) {
    this.now = eventDependencies.now;
    this.events = new BleEventHandler(
      {
        cancelled: this.cancelledSessionIds,
        getSnapshot: () => this.snapshot,
        set: (patch) => this.set(patch),
        sendCommand: (command) => this.sendCommand(command),
        isConnected: () => this.connection.connected,
        consumePendingDevice: () => this.connection.consumePendingDevice(),
        logEvent: (event) => this.logEvent(event),
        logState: (label, detail, sessionId) => this.logState(label, detail, sessionId),
        fail: (error) => this.fail(error),
      },
      eventDependencies
    );
    this.connection = new BleConnection(createClient, {
      onState: (state) => this.setBluetoothState(state),
      onDevice: (device) => this.addDevice(device),
      onEvent: (event) => this.events.handle(event),
      onError: (error) => this.fail(error),
    });
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  initialize = () => {
    try {
      this.connection.initialize();
    } catch (error) {
      this.fail(error);
    }
  };

  startScan = async () => {
    this.initialize();

    if (
      !this.connection.initialized ||
      !canRequestBleScan(this.snapshot.bluetoothState) ||
      this.snapshot.connectedDevice ||
      this.snapshot.connectionPhase === 'connecting' ||
      this.isActiveMeasurement()
    ) {
      return;
    }

    this.connection.clearNotifyReadyWait();
    this.set({
      connectionPhase: 'scanning',
      devices: [],
      message: 'Drunksafe 장치를 찾는 중입니다.',
    });

    try {
      await this.connection.startScan();
    } catch (error) {
      this.fail(error);
    }
  };

  stopScan = async () => {
    if (!this.connection.initialized) {
      return;
    }

    try {
      await this.connection.stopScan();

      if (this.snapshot.connectionPhase === 'scanning') {
        this.set({
          connectionPhase: this.snapshot.connectedDevice ? 'connected' : 'idle',
          message: null,
        });
      }
    } catch (error) {
      this.fail(error);
    }
  };

  connect = async (deviceId: string) => {
    this.initialize();

    if (
      !this.connection.initialized ||
      !this.canUseBluetooth() ||
      this.snapshot.connectedDevice ||
      this.snapshot.connectionPhase === 'connecting' ||
      this.isActiveMeasurement()
    ) {
      return;
    }

    this.events.invalidate();
    this.cancelledSessionIds.clear();
    this.connection.clearNotifyReadyWait();
    this.set({
      connectionPhase: 'connecting',
      message: 'Drunksafe 장치에 연결하는 중입니다.',
    });

    try {
      await this.connection.connect(deviceId, () => {
        this.set({
          connectionPhase: 'connecting',
          connectedDevice: null,
          deviceStatus: null,
          message: notifySubscriptionPendingMessage,
        });
      });
      await this.sendCommand({ cmd: 'time', unix_time_ms: this.now() });
    } catch (error) {
      const phase = this.getSnapshot().connectionPhase;

      if (
        error instanceof BleConnectionCancelledError ||
        (phase !== 'connecting' && phase !== 'connected')
      ) {
        return;
      }

      this.fail(error);
    }
  };

  connectMockDevice = async () => {
    this.events.invalidate();
    this.cancelledSessionIds.clear();
    this.connection.clearNotifyReadyWait();
    this.mockTimeline.clear();
    this.connection.clearEventMonitor();

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
    this.events.invalidate();
    this.cancelledSessionIds.clear();
    this.connection.clearNotifyReadyWait();
    const activeMeasurement = this.isActiveMeasurement();
    const sessionPatch = disconnectOrInterruptSessionPatch({
      activeMeasurement,
      result: this.snapshot.result,
      resultSaved: this.snapshot.resultSaved,
      interruptedMessage: '측정 중 연결이 해제되었습니다.',
    });

    if (this.snapshot.mockMode) {
      this.mockTimeline.clear();
      this.set({
        connectionPhase: this.snapshot.bluetoothState === 'Unsupported' ? 'unsupported' : 'idle',
        devices: [],
        connectedDevice: null,
        deviceStatus: null,
        mockMode: false,
        ...sessionPatch,
      });
      return;
    }

    if (!this.connection.initialized) {
      return;
    }

    try {
      await this.connection.disconnect();
      this.set({
        connectionPhase: this.canUseBluetooth() ? 'idle' : this.snapshot.connectionPhase,
        connectedDevice: null,
        deviceStatus: null,
        ...sessionPatch,
      });
    } catch (error) {
      this.fail(error);
    }
  };

  cancelMeasurement = async () => {
    const sessionId = this.snapshot.activeSessionId;

    if (!sessionId || !this.isActiveMeasurement()) {
      return;
    }

    const command: PhoneCommand = { cmd: 'cancel', session_id: sessionId };

    if (this.snapshot.mockMode) {
      this.logCommand(command);
      this.cancelledSessionIds.add(sessionId);
      this.mockTimeline.clear();
      this.logState('state:cancelled', 'mock device cancelled', sessionId);
      this.set({
        measurementPhase: 'error',
        progress: null,
        result: null,
        resultSaved: false,
        deviceErrorCode: 'cancelled',
        message: measurementErrorMessage('cancelled'),
      });
      this.cancelledSessionIds.delete(sessionId);
      return;
    }

    if (!this.connection.initialized) {
      return;
    }

    this.set({
      message: '측정 취소를 요청했습니다.',
    });

    try {
      this.cancelledSessionIds.add(sessionId);
      await this.sendCommand(command);
    } catch (error) {
      this.cancelledSessionIds.delete(sessionId);
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

    const command: PhoneCommand = { cmd: 'start', kind };

    if (this.snapshot.mockMode) {
      this.logCommand(command);
      await this.startMockMeasurement(kind);
      return;
    }

    if (
      !this.connection.initialized ||
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
      await this.sendCommand(command);
    } catch (error) {
      this.fail(error);
    }
  };

  destroy = async () => {
    this.events.invalidate();
    this.cancelledSessionIds.clear();
    this.connection.clearNotifyReadyWait();
    this.mockTimeline.clear();
    await this.connection.destroy();

    this.set(initialBleSession);
  };

  private addDevice(device: DrunksafeBleDevice) {
    if (this.snapshot.connectionPhase !== 'scanning') return;

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
      this.dropConnection();
      patch.connectionPhase = 'unsupported';
      patch.devices = [];
      patch.connectedDevice = null;
      patch.deviceStatus = null;
      patch.message = '이 환경에서는 BLE를 사용할 수 없습니다.';
    } else if (state !== 'PoweredOn') {
      this.dropConnection();
      const message = 'Bluetooth를 켜야 장치를 찾을 수 있습니다.';

      patch.connectionPhase = 'bluetooth_off';
      patch.devices = [];
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

  private async sendCommand(command: PhoneCommand) {
    await this.connection.send(command);
    this.logCommand(command);
  }

  private logCommand(command: PhoneCommand) {
    this.set(commandVerificationPatch(this.snapshot, command));
  }

  private logEvent(event: DeviceEvent) {
    this.set(eventVerificationPatch(this.snapshot, event));
  }

  private logState(label: string, detail: string, sessionId: string | null = null) {
    this.set(stateVerificationPatch(this.snapshot, label, detail, sessionId));
  }

  private isActiveMeasurement() {
    return hasActiveMeasurement(this.snapshot);
  }

  private fail(error: unknown) {
    const message = error instanceof Error ? error.message : 'BLE 작업에 실패했습니다.';
    const unsupported = /available only in native builds|unsupported/i.test(message);
    const measurementFailed = this.isActiveMeasurement();
    const sessionPatch = measurementFailed ? interruptedMeasurementPatch(message) : { message };

    this.dropConnection();
    this.set({
      connectionPhase: unsupported ? 'unsupported' : 'error',
      connectedDevice: null,
      deviceStatus: null,
      ...sessionPatch,
    });
  }

  private dropConnection() {
    this.events.invalidate();
    this.cancelledSessionIds.clear();
    this.connection.clearNotifyReadyWait();
    this.connection.clearEventMonitor();
    void this.connection.disconnect().catch(() => {});
  }

  private async startMockMeasurement(kind: MeasurementKind) {
    const sessionId = createMockSessionId(kind);
    this.mockTimeline.clear();
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

    await this.events.handle(createMockStartedEvent(sessionId, kind));

    if (this.cancelledSessionIds.has(sessionId) || !this.isActiveMeasurement()) {
      return;
    }

    this.mockTimeline.schedule(sessionId, kind, (event) => void this.events.handle(event));
  }

  private set(patch: Partial<BleSessionSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }
}

interface StoreDependencies extends EventDependencies {
  createClient: BleClientFactory;
}
