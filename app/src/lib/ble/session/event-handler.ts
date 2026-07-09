import type { DrunksafeBleDevice } from '@/lib/ble/client';
import { connectedDeviceAfterNotifySubscriptionReady } from '@/lib/ble/connection-readiness';
import type { DeviceEvent, PhoneCommand } from '@/lib/ble/model';
import { measurementErrorMessage, measurementStepMessage } from '@/lib/ble/session/messages';
import { persistMeasurementResult } from '@/lib/ble/session/persistence';
import {
  activeSessionIdAfterStatusNotify,
  statusMessageAfterNotify,
  terminalDeviceErrorPatch,
} from '@/lib/ble/session-patches';
import type { BleSessionSnapshot } from '@/lib/ble/session/state';
import { buildPhoneContext } from '@/lib/storage/profile';

export default class BleEventHandler {
  constructor(private readonly session: EventSession) {}

  async handle(event: DeviceEvent) {
    this.session.logEvent(event);

    switch (event.event) {
      case 'status':
        this.handleStatus(event);
        return;
      case 'measurement_started':
        await this.handleStarted(event);
        return;
      case 'measurement_progress':
        this.handleProgress(event);
        return;
      case 'measurement_result':
        await this.handleResult(event);
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
    });
  }

  private async handleStarted(event: Extract<DeviceEvent, { event: 'measurement_started' }>) {
    this.session.set({
      measurementPhase: event.needs_context ? 'waiting_context' : 'measuring',
      activeMeasurementKind: event.kind,
      activeSessionId: event.session_id,
      progress: null,
      result: null,
      resultSaved: false,
      deviceErrorCode: null,
      message: event.needs_context ? '측정 context를 준비하는 중입니다.' : '측정이 시작됐습니다.',
    });

    if (this.session.getSnapshot().mockMode) {
      await this.prepareMockContext(event);
      return;
    }

    if (!this.session.isConnected()) return;

    try {
      if (event.sync_time) {
        await this.session.sendCommand({ cmd: 'time', unix_time_ms: Date.now() });
      }

      if (event.needs_context) {
        const context = await buildPhoneContext(event.session_id, event.history_limit);
        if (this.session.cancelled.has(event.session_id)) return;

        await this.session.sendCommand({ cmd: 'context', ...context });
        this.session.set({
          measurementPhase: 'measuring',
          contextSentSessionId: event.session_id,
          message: '측정 context를 보냈습니다.',
        });
      }
    } catch (error) {
      this.session.fail(error);
    }
  }

  private async prepareMockContext(event: Extract<DeviceEvent, { event: 'measurement_started' }>) {
    if (!event.needs_context) return;

    await buildPhoneContext(event.session_id, event.history_limit);
    if (this.session.cancelled.has(event.session_id)) return;

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

  private async handleResult(event: Extract<DeviceEvent, { event: 'measurement_result' }>) {
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

    const persistence = await persistMeasurementResult(event);

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
