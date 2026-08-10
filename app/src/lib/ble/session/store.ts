import type { DrunksafeBleClient, DrunksafeBleDevice } from '@/lib/ble/client';
import {
  notifySubscriptionReadyTimeoutMs,
  notifySubscriptionTimeoutMessage,
} from '@/lib/ble/connection-readiness';
import type { DeviceEvent, MeasurementResult } from '@/lib/ble/model';
import { MockBleEventSource } from '@/lib/ble/mock';
import { persistMeasurementResult } from '@/lib/ble/session/persistence';
import {
  initialBleSessionState,
  reduceBleSession,
  type BleSessionState,
  type SessionEffect,
  type SessionEvent,
} from '@/lib/ble/session/reducer';
import { BleVerificationStore } from '@/lib/ble/session/verification';
import type { MeasurementKind } from '@/lib/storage/history-records';

type Removable = {
  remove: () => void;
};

type SessionBleClient = Pick<
  DrunksafeBleClient,
  | 'state'
  | 'onStateChange'
  | 'startScan'
  | 'stopScan'
  | 'connect'
  | 'disconnect'
  | 'onDisconnected'
  | 'monitorEvents'
  | 'send'
  | 'destroy'
>;

export type BleClientFactory = () => SessionBleClient;

const reconnectDelayMs = [500, 1500] as const;

export class BleSessionStore {
  readonly verification = new BleVerificationStore();

  private readonly createClient: BleClientFactory;
  private readonly listeners = new Set<() => void>();
  private readonly mockEvents = new MockBleEventSource();
  private readonly pendingResultSessions = new Set<string>();
  private client: SessionBleClient | null = null;
  private stateSubscription: Removable | null = null;
  private eventSubscription: Removable | null = null;
  private disconnectSubscription: Removable | null = null;
  private monitorGeneration = 0;
  private pendingConnectedDevice: DrunksafeBleDevice | null = null;
  private notifyReadyTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private persistenceTail: Promise<void> = Promise.resolve();
  private snapshot: BleSessionState = initialBleSessionState;

  constructor({ createClient }: { createClient: BleClientFactory }) {
    this.createClient = createClient;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  initialize = () => {
    void this.dispatch({ type: 'initialize_requested' });
  };

  startScan = async () => {
    await this.dispatch({ type: 'start_scan_requested' });
  };

  stopScan = async () => {
    await this.dispatch({ type: 'stop_scan_requested' });
  };

  connect = async (deviceId: string) => {
    await this.dispatch({ type: 'connect_requested', deviceId });
  };

  connectMockDevice = async () => {
    await this.dispatch({ type: 'connect_mock_requested' });
  };

  disconnect = async () => {
    await this.dispatch({ type: 'disconnect_requested' });
  };

  startMeasurement = async (kind: MeasurementKind = 'measurement') => {
    await this.dispatch({ type: 'start_measurement_requested', kind });
  };

  cancelMeasurement = async () => {
    await this.dispatch({ type: 'cancel_measurement_requested' });
  };

  destroy = async () => {
    await this.dispatch({ type: 'destroy_requested' });
    await this.persistenceTail;
    this.pendingResultSessions.clear();
    this.verification.clear();
  };

  private async dispatch(event: SessionEvent) {
    const { state, effects } = reduceBleSession(this.snapshot, event);

    if (state !== this.snapshot) {
      this.snapshot = state;
      this.listeners.forEach((listener) => listener());
    }

    for (const effect of effects) {
      await this.applyEffect(effect);
    }
  }

  private async applyEffect(effect: SessionEffect) {
    switch (effect.type) {
      case 'initialize_client':
        await this.initializeClient();
        return;
      case 'start_scan':
        await this.startClientScan();
        return;
      case 'stop_scan':
        await this.stopClientScan();
        return;
      case 'connect_device':
        await this.connectClient(effect.deviceId, effect.reconnectAttempt);
        return;
      case 'disconnect_client':
        await this.disconnectClient();
        return;
      case 'destroy_client':
        await this.destroyClient();
        return;
      case 'send_command':
        await this.sendCommand(effect.command);
        return;
      case 'schedule_reconnect':
        this.scheduleReconnect(effect.deviceId, effect.reconnectAttempt);
        return;
      case 'persist_record':
        await this.queuePersistence(effect.result, effect.measuredAtUnixMs);
        return;
      case 'start_mock':
        this.verification.command({ cmd: 'start', kind: effect.kind });
        this.mockEvents.start(effect.kind, (deviceEvent) => {
          void this.receiveDeviceEvent(deviceEvent);
        });
        return;
      case 'cancel_mock':
        this.verification.command({ cmd: 'cancel', session_id: effect.sessionId });
        this.mockEvents.cancel();
        this.verification.state('state:cancelled', 'mock device cancelled', effect.sessionId);
        return;
      case 'stop_mock':
        this.mockEvents.stop();
        return;
    }
  }

  private async initializeClient() {
    if (this.client) return;

    try {
      const client = this.createClient();
      this.client = client;
      this.stateSubscription = client.onStateChange((state) => {
        void this.dispatch({ type: 'bluetooth_changed', bluetoothState: String(state) });
      });
      const state = await client.state();
      await this.dispatch({ type: 'bluetooth_changed', bluetoothState: String(state) });
    } catch (error) {
      await this.fail(error);
    }
  }

  private async startClientScan() {
    if (!this.client) return;

    try {
      await this.client.startScan({
        onDevice: (device) => {
          void this.dispatch({ type: 'device_discovered', device });
        },
        onError: (error) => {
          void this.fail(error);
        },
      });
    } catch (error) {
      await this.fail(error);
    }
  }

  private async stopClientScan() {
    if (!this.client) return;

    try {
      await this.client.stopScan();
    } catch (error) {
      await this.fail(error);
    }
  }

  private async connectClient(deviceId: string, reconnectAttempt: number) {
    if (!this.client) return;

    this.clearReconnectTimer();
    this.clearNotifyReadyWait();
    this.clearMonitors();

    try {
      const device = await this.client.connect(deviceId);
      const connection = this.snapshot.connection;

      if (connection.phase !== 'connecting' || connection.deviceId !== deviceId) {
        await this.client.disconnect().catch(() => {});
        return;
      }

      this.pendingConnectedDevice = device;
      const generation = this.monitorGeneration;
      this.disconnectSubscription = this.client.onDisconnected((error) => {
        if (generation !== this.monitorGeneration) return;

        const message = error?.message ?? 'Drunksafe 장치 연결이 예기치 않게 해제되었습니다.';
        this.clearNotifyReadyWait();
        this.clearMonitors();
        void this.dispatch({ type: 'unexpected_disconnect', deviceId, message });
      });
      this.eventSubscription = this.client.monitorEvents(
        (event) => {
          void this.receiveDeviceEvent(event);
        },
        (error) => {
          void this.fail(error);
        }
      );
      await this.dispatch({ type: 'connection_pending', deviceId });
      this.scheduleNotifyReadyTimeout(deviceId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Drunksafe 장치 연결에 실패했습니다.';
      await this.dispatch({
        type: 'connection_attempt_failed',
        deviceId,
        reconnectAttempt,
        message,
      });
    }
  }

  private async disconnectClient() {
    this.clearReconnectTimer();
    this.clearNotifyReadyWait();
    this.clearMonitors();
    await this.client?.disconnect().catch(() => {});
  }

  private async destroyClient() {
    this.clearReconnectTimer();
    this.clearNotifyReadyWait();
    this.clearMonitors();
    this.stateSubscription?.remove();
    this.stateSubscription = null;
    const client = this.client;
    this.client = null;
    await client?.destroy().catch(() => {});
  }

  private async sendCommand(command: Extract<SessionEffect, { type: 'send_command' }>['command']) {
    if (!this.client) {
      await this.fail(new Error('Drunksafe BLE device is not connected'));
      return;
    }

    try {
      await this.client.send(command);
      this.verification.command(command);
    } catch (error) {
      await this.fail(error);
    }
  }

  private scheduleReconnect(deviceId: string, reconnectAttempt: number) {
    this.clearReconnectTimer();
    const delayMs = reconnectDelayMs[reconnectAttempt - 1];

    if (delayMs === undefined) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.applyEffect({ type: 'connect_device', deviceId, reconnectAttempt });
    }, delayMs);
  }

  private async receiveDeviceEvent(event: DeviceEvent) {
    this.verification.event(event);
    let readyDevice: DrunksafeBleDevice | null = null;

    if (event.event === 'status' && this.pendingConnectedDevice) {
      readyDevice = this.pendingConnectedDevice;
      this.pendingConnectedDevice = null;
      this.clearNotifyReadyTimer();
      this.verification.state(
        'state:notify-ready',
        `${readyDevice.name} status=${event.status}`,
        event.active_session_id
      );
    }

    await this.dispatch({ type: 'device_event', event, atUnixMs: Date.now(), readyDevice });
  }

  private async queuePersistence(result: MeasurementResult, measuredAtUnixMs: number) {
    const key = `${result.kind}:${result.session_id}`;

    if (this.pendingResultSessions.has(key)) {
      this.verification.state('state:ignored-event', 'duplicate result notify', result.session_id);
      return;
    }

    this.pendingResultSessions.add(key);
    this.verification.state('state:persist-start', 'serial result persistence', result.session_id);
    const run = this.persistenceTail.then(() => persistMeasurementResult(result, measuredAtUnixMs));
    this.persistenceTail = run.then(
      () => {},
      () => {}
    );
    const persisted = await run;
    this.pendingResultSessions.delete(key);

    this.verification.state(
      'state:persist-end',
      persisted.saved ? 'result saved' : 'result save failed',
      result.session_id
    );
    await this.dispatch({ type: 'record_persisted', ...persisted });
  }

  private scheduleNotifyReadyTimeout(deviceId: string) {
    this.clearNotifyReadyTimer();
    this.notifyReadyTimer = setTimeout(() => {
      this.notifyReadyTimer = null;

      if (this.pendingConnectedDevice?.id !== deviceId) return;

      this.pendingConnectedDevice = null;
      void this.dispatch({
        type: 'notify_ready_timeout',
        message: notifySubscriptionTimeoutMessage,
      });
    }, notifySubscriptionReadyTimeoutMs);
  }

  private async fail(error: unknown) {
    const message = error instanceof Error ? error.message : 'BLE 작업에 실패했습니다.';
    await this.dispatch({
      type: 'operation_failed',
      message,
      unsupported: /available only in native builds|unsupported/i.test(message),
    });
  }

  private clearNotifyReadyWait() {
    this.pendingConnectedDevice = null;
    this.clearNotifyReadyTimer();
  }

  private clearNotifyReadyTimer() {
    if (!this.notifyReadyTimer) return;

    clearTimeout(this.notifyReadyTimer);
    this.notifyReadyTimer = null;
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) return;

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearMonitors() {
    this.monitorGeneration += 1;
    this.eventSubscription?.remove();
    this.eventSubscription = null;
    this.disconnectSubscription?.remove();
    this.disconnectSubscription = null;
  }
}
