import type { DrunksafeBleClient, DrunksafeBleDevice } from '@/lib/ble/client';
import {
  notifySubscriptionReadyTimeoutMs,
  notifySubscriptionTimeoutMessage,
} from '@/lib/ble/connection-readiness';
import type {
  AlcoholStateLabel,
  DeviceEvent,
  MeasurementResult,
  PpgSampleBatch,
  PulseReading,
  SessionRecord,
  SessionAlcoholResult,
  SessionStatus,
} from '@/lib/ble/model';
import { preserveCompletedMinute } from '@/lib/ble/pulse-feedback';
import { readBaseline, type UserBaseline } from '@/lib/storage/profile';
import { baselineIssues } from '@/lib/personalization/baseline-acceptance';
import { persistSessionDownload, type ProcessedSession } from '@/lib/storage/sessions';
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
import { appendConnectionIncident } from '@/lib/storage/connection-incidents';

type Removable = {
  remove: () => void;
};

/** A single PPG data point kept in the ring buffer. */
export type PpgPoint = {
  /** Monotonically increasing timestamp in ms from session start */
  t: number;
  /** Raw 12-bit ADC value (0-4095) */
  raw: number;
};

/** Max number of PPG points kept in the app-side ring buffer (~50 seconds at 10 Hz notify) */
const MAX_PPG_BUFFER = 500;

/** UI snapshot for an ESP32-run drinking session (start → download at end). */
export type SessionUiSnapshot = {
  phase: 'idle' | 'active' | 'downloading' | 'complete';
  status: SessionStatus | null;
  received: number;
  total: number;
  result: ProcessedSession | null;
  alcoholResults: SessionAlcoholResult[];
  alcoholMeasurementPending: boolean;
};

const idleSessionSnapshot: SessionUiSnapshot = {
  phase: 'idle',
  status: null,
  received: 0,
  total: 0,
  result: null,
  alcoholResults: [],
  alcoholMeasurementPending: false,
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
  private readonly readBaselineValue: () => Promise<UserBaseline>;
  private readonly listeners = new Set<() => void>();
  private readonly ppgListeners = new Set<() => void>();
  private readonly pulseReadingListeners = new Set<() => void>();
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
  private ppgBuffer: PpgPoint[] = [];
  private ppgSnapshot: PpgPoint[] = [];
  private latestPulseReading: PulseReading | null = null;
  private pulseReadingReceivedAt = 0;
  private startingHrWatch = false;
  private pulseStreaming = false;
  private readonly pulseStreamingListeners = new Set<() => void>();
  private sessionUi: SessionUiSnapshot = idleSessionSnapshot;
  private sessionRecordsBuffer: SessionRecord[] = [];
  private readonly sessionListeners = new Set<() => void>();
  private alcoholState: AlcoholStateLabel | null = null;
  private readonly alcoholStateListeners = new Set<() => void>();

  constructor({
    createClient,
    baselineReader = readBaseline,
  }: {
    createClient: BleClientFactory;
    baselineReader?: () => Promise<UserBaseline>;
  }) {
    this.createClient = createClient;
    this.readBaselineValue = baselineReader;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Subscribe to PPG data updates only (does not trigger on other state changes). */
  subscribePpg = (listener: () => void) => {
    this.ppgListeners.add(listener);
    return () => {
      this.ppgListeners.delete(listener);
    };
  };

  /** Subscribe to live pulse-diagnostic reading updates only (developer tools). */
  subscribePulseReading = (listener: () => void) => {
    this.pulseReadingListeners.add(listener);
    return () => {
      this.pulseReadingListeners.delete(listener);
    };
  };

  /** Subscribe to pulse-stream on/off changes (developer tools). Survives screen navigation. */
  subscribePulseStreaming = (listener: () => void) => {
    this.pulseStreamingListeners.add(listener);
    return () => {
      this.pulseStreamingListeners.delete(listener);
    };
  };

  /** Whether a developer-tools pulse stream is currently active on the device. */
  getPulseStreamingSnapshot = (): boolean => this.pulseStreaming;

  /** Subscribe to drinking-session UI changes (status/download/result). */
  subscribeSession = (listener: () => void) => {
    this.sessionListeners.add(listener);
    return () => {
      this.sessionListeners.delete(listener);
    };
  };

  getSessionSnapshot = (): SessionUiSnapshot => this.sessionUi;

  /** Subscribe to ZE29A alcohol-state changes (blow-timing guidance). */
  subscribeAlcoholState = (listener: () => void) => {
    this.alcoholStateListeners.add(listener);
    return () => {
      this.alcoholStateListeners.delete(listener);
    };
  };

  getAlcoholStateSnapshot = (): AlcoholStateLabel | null => this.alcoholState;

  private setAlcoholState(state: AlcoholStateLabel | null) {
    if (this.alcoholState === state) return;

    this.alcoholState = state;
    this.alcoholStateListeners.forEach((listener) => listener());
  }

  private setSessionUi(next: SessionUiSnapshot) {
    this.sessionUi = next;
    this.sessionListeners.forEach((listener) => listener());
  }

  /** Start HR monitoring with alcohol-check recommendations at +10/+15/+20%. */
  startSession = async () => {
    if (this.startingHrWatch || ['active', 'downloading'].includes(this.sessionUi.phase)) {
      throw new Error('이미 세션을 시작했거나 진행 중입니다.');
    }
    this.startingHrWatch = true;
    try {
      const baseline = await this.readBaselineValue();
      const bpm = baseline.resting_bpm;
      if (baselineIssues(baseline).length > 0 || bpm === null) {
        throw new Error(
          '저장된 baseline을 사용할 수 없습니다. 설정에서 기준값 상태를 확인하고 다시 측정해 주세요.'
        );
      }
      if (!this.client || this.snapshot.connection.phase !== 'connected') {
        throw new Error('먼저 ESP32 기기를 연결해 주세요.');
      }
      this.sessionRecordsBuffer = [];
      this.setSessionUi({ ...idleSessionSnapshot });
      const command = { cmd: 'start_hr_watch' as const, resting_bpm: bpm };
      await this.client.send(command);
      this.verification.command(command);
      await this.waitForHrWatchStart();
    } catch (error) {
      this.setSessionUi({ ...idleSessionSnapshot });
      throw error;
    } finally {
      this.startingHrWatch = false;
    }
  };

  private waitForHrWatchStart(): Promise<void> {
    const acknowledged = () => this.sessionUi.status?.session_id.startsWith('fw-hrwatch-') === true;
    if (acknowledged()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(
          new Error(
            '기기 시작 응답이 없습니다. 권장 전용 모드를 지원하는 ESP32 펌웨어로 업데이트해 주세요.'
          )
        );
      }, 8000);
      const unsubscribe = this.subscribeSession(() => {
        if (acknowledged()) {
          clearTimeout(timer);
          unsubscribe();
          resolve();
        }
      });
    });
  }

  /** Developer tool: alcohol-only tracking session (no HR/schedule) for descent fitting. */
  startAlcoholTrack = async () => {
    this.sessionRecordsBuffer = [];
    this.setSessionUi({ ...idleSessionSnapshot, phase: 'active' });
    await this.sendCommand({ cmd: 'start_alcohol_track' });
  };

  /** End the session and download its log (device streams records back). */
  endSession = async () => {
    this.setSessionUi({ ...this.sessionUi, phase: 'downloading' });
    await this.sendCommand({ cmd: 'end_session' });
  };

  /** Request an alcohol measurement at any time during an active HR-watch session. */
  measureSessionAlcohol = async () => {
    if (
      this.sessionUi.phase !== 'active' ||
      (this.sessionUi.status?.session_id.startsWith('fw-hrwatch-') !== true &&
        this.sessionUi.status?.session_id.startsWith('fw-alctrack-') !== true)
    ) {
      throw new Error('진행 중인 음주 또는 fitting 세션에서 사용할 수 있습니다.');
    }
    if (this.sessionUi.alcoholMeasurementPending) {
      throw new Error('알코올 측정이 이미 진행 중입니다.');
    }
    if (!this.client || this.snapshot.connection.phase !== 'connected') {
      throw new Error('먼저 ESP32 기기를 연결해 주세요.');
    }

    const command = { cmd: 'measure_session_alcohol' as const };
    this.setAlcoholState(null);
    this.setSessionUi({ ...this.sessionUi, alcoholMeasurementPending: true });
    try {
      await this.client.send(command);
      this.verification.command(command);
    } catch (error) {
      this.setSessionUi({ ...this.sessionUi, alcoholMeasurementPending: false });
      throw error;
    }
  };

  private async processSessionComplete(records: SessionRecord[]) {
    try {
      const result = await persistSessionDownload(
        records,
        Date.now(),
        this.sessionUi.status?.r0_bpm ?? null
      );
      this.setSessionUi({
        ...this.sessionUi,
        phase: 'complete',
        received: records.length,
        total: records.length,
        result,
        alcoholMeasurementPending: false,
      });
    } catch {
      this.setSessionUi({ ...this.sessionUi, phase: 'complete', result: null });
    }
  }

  private setPulseStreaming(active: boolean) {
    if (this.pulseStreaming === active) return;

    this.pulseStreaming = active;
    this.pulseStreamingListeners.forEach((listener) => listener());
  }

  getSnapshot = () => this.snapshot;

  /** Returns the current PPG ring buffer snapshot (stable reference changes only when new data arrives). */
  getPpgSnapshot = (): PpgPoint[] => this.ppgSnapshot;

  /** Returns the latest live pulse-diagnostic reading (null until one arrives). */
  getPulseReadingSnapshot = (): PulseReading | null => this.latestPulseReading;
  getPulseReadingReceivedAtSnapshot = (): number => this.pulseReadingReceivedAt;
  initialize = () => {
    void this.dispatch({ type: 'initialize_requested' });
  };

  /** Clear the PPG ring buffer (call when starting a new measurement session). */
  clearPpgBuffer = () => {
    this.ppgBuffer = [];
    this.ppgSnapshot = [];
    this.ppgListeners.forEach((l) => l());
  };

  private clearPulseReading() {
    this.latestPulseReading = null;
    this.pulseReadingListeners.forEach((listener) => listener());
  }

  /**
   * Ask the device to stream pulse diagnostics only (no alcohol). Developer tools.
   * `streamRaw` additionally streams the raw PPG waveform (heavier BLE traffic).
   */
  startPulseStream = async (streamRaw: boolean) => {
    this.clearPpgBuffer();
    this.clearPulseReading();
    this.setPulseStreaming(true);
    await this.sendCommand({ cmd: 'start_pulse_stream', stream_raw: streamRaw });
  };

  /** Stop an in-progress pulse-only diagnostic stream. */
  stopPulseStream = async () => {
    this.setPulseStreaming(false);
    await this.sendCommand({ cmd: 'stop_pulse_stream' });
  };

  private appendPpgSamples(batch: PpgSampleBatch) {
    batch.samples.forEach((raw, index) => {
      this.ppgBuffer.push({ t: batch.t0_ms + index * batch.dt_ms, raw });
    });

    if (this.ppgBuffer.length > MAX_PPG_BUFFER) {
      this.ppgBuffer.splice(0, this.ppgBuffer.length - MAX_PPG_BUFFER);
    }

    this.ppgSnapshot = this.ppgBuffer.slice();
    this.ppgListeners.forEach((listener) => listener());
  }

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

  /** 알코올 측정 완료(awaiting_pulse) 후, 이어서 심박 측정 단계를 시작한다. */
  startPulsePhase = async () => {
    this.latestPulseReading = null;
    this.pulseReadingListeners.forEach((listener) => listener());
    await this.dispatch({ type: 'start_pulse_phase_requested' });
  };

  cancelMeasurement = async () => {
    await this.dispatch({ type: 'cancel_measurement_requested' });
  };

  /** Client-side safety net: end an active measurement whose result never arrived. */
  timeoutMeasurement = async () => {
    await this.dispatch({ type: 'measurement_client_timeout' });
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
        void appendConnectionIncident({
          atUnixMs: Date.now(),
          deviceId,
          sessionId: this.sessionUi.status?.session_id ?? null,
          message,
        });
        this.clearNotifyReadyWait();
        this.clearMonitors();
        this.setPulseStreaming(false);
        this.clearPulseReading();
        this.clearPpgBuffer();
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
    this.setPulseStreaming(false);
    await this.client?.disconnect().catch(() => {});
  }

  private async destroyClient() {
    this.clearReconnectTimer();
    this.clearNotifyReadyWait();
    this.clearMonitors();
    this.setPulseStreaming(false);
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
    if (event.event === 'ppg_sample') {
      this.appendPpgSamples(event);
      return;
    }

    if (event.event === 'pulse_reading') {
      const measurement = this.snapshot.measurement;
      const measurementReading =
        measurement.phase === 'active' &&
        measurement.stage === 'pulse' &&
        measurement.sessionId === event.session_id;
      const developerReading =
        event.session_id.startsWith('fw-pulse-') &&
        measurement.phase !== 'active' &&
        measurement.phase !== 'awaiting_pulse';
      const sessionReading =
        event.session_id.startsWith('fw-hrwatch-') && this.sessionUi.phase === 'active';
      if (!measurementReading && !developerReading && !sessionReading) return;
      if (sessionReading && preserveCompletedMinute(this.latestPulseReading, event)) return;
      this.latestPulseReading = event;
      this.pulseReadingReceivedAt = Date.now();
      this.pulseReadingListeners.forEach((listener) => listener());
      // Only developer-stream events recover its start/stop flag; normal pulse
      // phase telemetry must not make the developer stop button look active.
      if (developerReading) this.setPulseStreaming(true);
      return;
    }

    if (event.event === 'session_status') {
      if (this.alcoholState !== null) {
        this.alcoholState = null;
        this.alcoholStateListeners.forEach((listener) => listener());
      }
      this.setSessionUi({
        ...this.sessionUi,
        phase: this.sessionUi.phase === 'idle' ? 'active' : this.sessionUi.phase,
        status: event,
        // Firmware emits no session status while ZE29A is busy. The first status
        // afterward also recovers the UI if the terminal result notify was missed.
        alcoholMeasurementPending: false,
      });
      return;
    }

    if (event.event === 'session_record') {
      const existing = this.sessionRecordsBuffer.findIndex(
        (record) => record.session_id === event.session_id && record.index === event.index
      );
      if (existing >= 0) this.sessionRecordsBuffer[existing] = event;
      else this.sessionRecordsBuffer.push(event);
      this.setSessionUi({
        ...this.sessionUi,
        phase: 'downloading',
        received: this.sessionRecordsBuffer.length,
        total: event.total,
      });
      return;
    }

    if (event.event === 'session_complete') {
      const records = this.sessionRecordsBuffer.slice();
      void this.processSessionComplete(records);
      return;
    }

    if (event.event === 'session_alcohol_result') {
      if (event.session_id !== this.sessionUi.status?.session_id) return;
      this.setAlcoholState(null);
      this.setSessionUi({
        ...this.sessionUi,
        alcoholResults: [...this.sessionUi.alcoholResults, event],
        alcoholMeasurementPending: false,
      });
      this.verification.event(event);
      return;
    }

    if (event.event === 'alcohol_state') {
      this.setAlcoholState(event.state);
      if (
        event.session_id === this.sessionUi.status?.session_id &&
        !this.sessionUi.alcoholMeasurementPending
      ) {
        this.setSessionUi({ ...this.sessionUi, alcoholMeasurementPending: true });
      }
      this.verification.event(event);
      return;
    }

    this.verification.event(event);

    if (event.event === 'measurement_started') {
      this.clearPpgBuffer();
      this.setAlcoholState(null);
    }

    if (event.event === 'status' && event.status === 'idle') {
      this.setPulseStreaming(false);
      this.clearPulseReading();
      this.clearPpgBuffer();
    }

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
