import type { DrunksafeBleDevice } from '@/lib/ble/client';
import { connectedDeviceAfterNotifySubscriptionReady } from '@/lib/ble/connection-readiness';
import type { DeviceEvent, MeasurementResult, PhoneCommand, PhoneContext } from '@/lib/ble/model';
import { hasActiveMeasurement } from '@/lib/ble/measurement-phase';
import { measurementErrorMessage, measurementStepMessage } from '@/lib/ble/session/messages';
import {
  activeSessionIdAfterStatusNotify,
  interruptedMeasurementPatch,
  statusMessageAfterNotify,
  terminalDeviceErrorPatch,
} from '@/lib/ble/session-patches';
import type { BleSessionSnapshot } from '@/lib/ble/session/state';

export default class BleEventHandler {
  private epoch = 0;
  private queue = Promise.resolve();
  private persistenceQueue = Promise.resolve();

  constructor(
    private readonly session: EventSession,
    private readonly dependencies: EventDependencies
  ) {}

  handle(event: DeviceEvent) {
    const epoch = this.epoch;
    const task = this.queue.then(() => this.dispatch(event, epoch));

    this.queue = task.catch((error) => {
      if (this.isCurrent(epoch)) this.session.fail(error);
    });

    return this.queue;
  }

  invalidate() {
    this.epoch += 1;
    this.queue = Promise.resolve();
  }

  private async dispatch(event: DeviceEvent, epoch: number) {
    if (!this.isCurrent(epoch)) return;

    const snapshot = this.session.getSnapshot();

    if (!shouldHandleEvent(snapshot, event)) {
      this.session.logState('state:ignored-event', `event=${event.event}`, eventSessionId(event));
      return;
    }

    this.session.logEvent(event);

    switch (event.event) {
      case 'status':
        this.handleStatus(event);
        return;
      case 'measurement_started':
        await this.handleStarted(event, epoch);
        return;
      case 'measurement_progress':
        this.handleProgress(event);
        return;
      case 'measurement_result':
        await this.handleResult(event, epoch);
        return;
      case 'device_error':
        this.handleError(event);
        return;
    }
  }

  private handleStatus(event: Extract<DeviceEvent, { event: 'status' }>) {
    const snapshot = this.session.getSnapshot();
    const pendingDevice = this.session.consumePendingDevice();
    const connectedDevice = connectedDeviceAfterNotifySubscriptionReady({
      currentConnectedDevice: snapshot.connectedDevice,
      pendingConnectedDevice: pendingDevice,
    });
    const interrupted =
      event.active_session_id === null &&
      (event.status === 'idle' || event.status === 'connected') &&
      hasActiveMeasurement(snapshot);
    const interruptionPatch = interrupted
      ? interruptedMeasurementPatch('장치에서 측정 세션이 예기치 않게 종료됐습니다.')
      : {};

    if (pendingDevice && connectedDevice) {
      this.session.logState(
        'state:notify-ready',
        `${connectedDevice.name} status=${event.status}`,
        event.active_session_id
      );
    }

    this.session.set({
      connectedDevice,
      deviceStatus: event.status,
      activeSessionId: activeSessionIdAfterStatusNotify({
        status: event.status,
        measurementPhase: snapshot.measurementPhase,
        currentActiveSessionId: snapshot.activeSessionId,
        notifiedActiveSessionId: event.active_session_id,
      }),
      connectionPhase: 'connected',
      message: statusMessageAfterNotify({
        status: event.status,
        measurementPhase: snapshot.measurementPhase,
        currentMessage: snapshot.message,
      }),
      ...interruptionPatch,
    });
  }

  private async handleStarted(
    event: Extract<DeviceEvent, { event: 'measurement_started' }>,
    epoch: number
  ) {
    this.session.set({
      measurementPhase: event.needs_context ? 'waiting_context' : 'measuring',
      activeMeasurementKind: event.kind,
      activeSessionId: event.session_id,
      progress: null,
      result: null,
      resultSaved: false,
      deviceErrorCode: null,
      contextSentSessionId: null,
      message: event.needs_context ? '측정 context를 준비하는 중입니다.' : '측정이 시작됐습니다.',
    });

    if (this.session.getSnapshot().mockMode) {
      await this.prepareMockContext(event, epoch);
      return;
    }

    if (!this.session.isConnected()) return;

    try {
      if (event.sync_time) {
        await this.session.sendCommand({ cmd: 'time', unix_time_ms: this.dependencies.now() });
        if (!this.isCurrent(epoch)) return;
      }

      if (event.needs_context) {
        const context = await this.dependencies.buildContext(event.session_id, event.history_limit);
        if (!this.isCurrent(epoch) || this.session.cancelled.has(event.session_id)) return;

        await this.session.sendCommand({ cmd: 'context', ...context });
        if (!this.isCurrent(epoch)) return;

        this.session.set({
          measurementPhase: 'measuring',
          contextSentSessionId: event.session_id,
          message: '측정 context를 보냈습니다.',
        });
      }
    } catch (error) {
      if (this.isCurrent(epoch)) this.session.fail(error);
    }
  }

  private async prepareMockContext(
    event: Extract<DeviceEvent, { event: 'measurement_started' }>,
    epoch: number
  ) {
    if (!event.needs_context) return;

    await this.dependencies.buildContext(event.session_id, event.history_limit);
    if (!this.isCurrent(epoch) || this.session.cancelled.has(event.session_id)) return;

    this.session.set({
      measurementPhase: 'measuring',
      contextSentSessionId: event.session_id,
      message: '시뮬레이터 측정 context를 준비했습니다.',
    });
  }

  private handleProgress(event: Extract<DeviceEvent, { event: 'measurement_progress' }>) {
    if (this.session.cancelled.has(event.session_id)) return;

    this.session.set({
      measurementPhase: event.step === 'done' ? 'result' : 'measuring',
      activeSessionId: event.session_id,
      progress: event,
      message: measurementStepMessage(event),
    });
  }

  private async handleResult(
    event: Extract<DeviceEvent, { event: 'measurement_result' }>,
    epoch: number
  ) {
    if (this.session.cancelled.delete(event.session_id)) {
      this.session.set({
        measurementPhase: 'error',
        activeSessionId: event.session_id,
        progress: null,
        result: null,
        resultSaved: false,
        deviceErrorCode: 'cancelled',
        message: measurementErrorMessage('cancelled'),
      });
      return;
    }

    const persistence = await this.persist(event);
    if (!this.isCurrent(epoch)) return;

    this.session.set({
      measurementPhase: 'result',
      activeMeasurementKind: event.kind,
      activeSessionId: event.session_id,
      progress: null,
      result: event,
      resultSaved: persistence.saved,
      message: persistence.message,
    });

    if (this.session.isConnected() && persistence.saved) {
      await this.session.sendCommand({ cmd: 'ack', session_id: event.session_id }).catch(() => {});
    }
  }

  private handleError(event: Extract<DeviceEvent, { event: 'device_error' }>) {
    if (event.session_id) this.session.cancelled.delete(event.session_id);
    this.session.set(terminalDeviceErrorPatch(event, measurementErrorMessage(event.code)));
  }

  private isCurrent(epoch: number) {
    return epoch === this.epoch;
  }

  private persist(result: MeasurementResult) {
    const task = this.persistenceQueue.then(() => this.dependencies.persistResult(result));
    this.persistenceQueue = task.then(
      () => undefined,
      () => undefined
    );
    return task;
  }
}

function shouldHandleEvent(snapshot: BleSessionSnapshot, event: DeviceEvent) {
  if (event.event === 'status') return true;

  if (event.event === 'measurement_started') {
    return (
      !hasActiveMeasurement(snapshot) ||
      snapshot.activeSessionId === null ||
      snapshot.activeSessionId === event.session_id
    );
  }

  if (event.event === 'device_error' && event.session_id === null) return true;

  return snapshot.activeSessionId !== null && snapshot.activeSessionId === event.session_id;
}

function eventSessionId(event: DeviceEvent) {
  return event.event === 'status' ? event.active_session_id : event.session_id;
}

interface EventSession {
  cancelled: Set<string>;
  getSnapshot: () => BleSessionSnapshot;
  set: (patch: Partial<BleSessionSnapshot>) => void;
  sendCommand: (command: PhoneCommand) => Promise<void>;
  isConnected: () => boolean;
  consumePendingDevice: () => DrunksafeBleDevice | null;
  logEvent: (event: DeviceEvent) => void;
  logState: (label: string, detail: string, sessionId?: string | null) => void;
  fail: (error: unknown) => void;
}

export interface EventDependencies {
  buildContext: (sessionId: string, historyLimit: number) => Promise<PhoneContext>;
  persistResult: (result: MeasurementResult) => Promise<ResultPersistence>;
  now: () => number;
}

interface ResultPersistence {
  saved: boolean;
  message: string;
}
