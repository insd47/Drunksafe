import type { DeviceError, ErrorCode, StatusKind } from '@/lib/ble/model';
import type { BleMeasurementPhase } from '@/lib/ble/measurement-phase';
import type { MeasurementRecord } from '@/lib/storage/history';

export type TerminalErrorPatch = {
  measurementPhase: 'error';
  activeSessionId: string | null;
  result: null;
  resultSaved: false;
  deviceStatus: 'error';
  deviceErrorCode: ErrorCode;
  message: string;
};

export type IdleSessionPatch = {
  measurementPhase: 'idle';
  activeSessionId: null;
  result: null;
  resultSaved: false;
  deviceErrorCode: null;
  message: null;
};

export type DisconnectSessionPatch = {
  measurementPhase: 'idle' | 'result';
  activeSessionId: string | null;
  result: MeasurementRecord | null;
  resultSaved: boolean;
  deviceErrorCode: null;
  message: string | null;
};

export type InterruptedMeasurementPatch = {
  measurementPhase: 'error';
  result: null;
  resultSaved: false;
  deviceErrorCode: null;
  message: string;
};

export type DisconnectOrInterruptSessionPatch =
  | DisconnectSessionPatch
  | InterruptedMeasurementPatch;

export function terminalDeviceErrorPatch(event: DeviceError, message: string): TerminalErrorPatch {
  return {
    measurementPhase: 'error',
    activeSessionId: event.session_id,
    result: null,
    resultSaved: false,
    deviceStatus: 'error',
    deviceErrorCode: event.code,
    message,
  };
}

export function idleSessionPatch(): IdleSessionPatch {
  return {
    measurementPhase: 'idle',
    activeSessionId: null,
    result: null,
    resultSaved: false,
    deviceErrorCode: null,
    message: null,
  };
}

export function disconnectSessionPatch({
  result,
  resultSaved,
}: {
  result: MeasurementRecord | null;
  resultSaved: boolean;
}): DisconnectSessionPatch {
  if (result && !resultSaved) {
    return {
      measurementPhase: 'result',
      activeSessionId: result.session_id,
      result,
      resultSaved: false,
      deviceErrorCode: null,
      message: '결과 저장에 실패했습니다. 화면을 닫기 전에 결과를 확인하세요.',
    };
  }

  return idleSessionPatch();
}

export function disconnectOrInterruptSessionPatch({
  activeMeasurement,
  result,
  resultSaved,
  interruptedMessage,
}: {
  activeMeasurement: boolean;
  result: MeasurementRecord | null;
  resultSaved: boolean;
  interruptedMessage: string;
}): DisconnectOrInterruptSessionPatch {
  if (activeMeasurement) {
    return interruptedMeasurementPatch(interruptedMessage);
  }

  return disconnectSessionPatch({ result, resultSaved });
}

export function interruptedMeasurementPatch(message: string): InterruptedMeasurementPatch {
  return {
    measurementPhase: 'error',
    result: null,
    resultSaved: false,
    deviceErrorCode: null,
    message,
  };
}

export function activeSessionIdAfterStatusNotify({
  status,
  measurementPhase,
  currentActiveSessionId,
  notifiedActiveSessionId,
}: {
  status: StatusKind;
  measurementPhase: BleMeasurementPhase;
  currentActiveSessionId: string | null;
  notifiedActiveSessionId: string | null;
}) {
  if (
    notifiedActiveSessionId === null &&
    currentActiveSessionId !== null &&
    shouldPreserveSessionMessage(status, measurementPhase)
  ) {
    return currentActiveSessionId;
  }

  return notifiedActiveSessionId;
}

export function statusMessageAfterNotify({
  status,
  measurementPhase,
  currentMessage,
}: {
  status: StatusKind;
  measurementPhase: BleMeasurementPhase;
  currentMessage: string | null;
}) {
  return shouldPreserveSessionMessage(status, measurementPhase) ? currentMessage : null;
}

export function shouldPreserveSessionMessage(
  status: StatusKind,
  measurementPhase: BleMeasurementPhase
) {
  return (
    status === 'result_ready' ||
    status === 'error' ||
    (status === 'idle' && measurementPhase === 'error')
  );
}
