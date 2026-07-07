import type { DeviceError, ErrorCode, MeasurementResult, StatusKind } from '@/lib/ble/model';
import type { BleMeasurementPhase } from '@/lib/ble/measurement-phase';

export type TerminalErrorPatch = {
  measurementPhase: 'error';
  activeSessionId: string | null;
  progress: null;
  result: null;
  resultSaved: false;
  deviceStatus: 'error';
  deviceErrorCode: ErrorCode;
  contextSentSessionId: null;
  message: string;
};

export type IdleSessionPatch = {
  measurementPhase: 'idle';
  activeSessionId: null;
  progress: null;
  result: null;
  resultSaved: false;
  deviceErrorCode: null;
  contextSentSessionId: null;
  message: null;
};

export type DisconnectSessionPatch = {
  measurementPhase: 'idle' | 'result';
  activeSessionId: string | null;
  progress: null;
  result: MeasurementResult | null;
  resultSaved: boolean;
  deviceErrorCode: null;
  contextSentSessionId: null;
  message: string | null;
};

export type InterruptedMeasurementPatch = {
  measurementPhase: 'error';
  progress: null;
  result: null;
  resultSaved: false;
  deviceErrorCode: null;
  contextSentSessionId: null;
  message: string;
};

export type DisconnectOrInterruptSessionPatch =
  | DisconnectSessionPatch
  | InterruptedMeasurementPatch;

export function terminalDeviceErrorPatch(event: DeviceError, message: string): TerminalErrorPatch {
  return {
    measurementPhase: 'error',
    activeSessionId: event.session_id,
    progress: null,
    result: null,
    resultSaved: false,
    deviceStatus: 'error',
    deviceErrorCode: event.code,
    contextSentSessionId: null,
    message,
  };
}

export function idleSessionPatch(): IdleSessionPatch {
  return {
    measurementPhase: 'idle',
    activeSessionId: null,
    progress: null,
    result: null,
    resultSaved: false,
    deviceErrorCode: null,
    contextSentSessionId: null,
    message: null,
  };
}

export function disconnectSessionPatch({
  result,
  resultSaved,
}: {
  result: MeasurementResult | null;
  resultSaved: boolean;
}): DisconnectSessionPatch {
  if (result && !resultSaved) {
    return {
      measurementPhase: 'result',
      activeSessionId: result.session_id,
      progress: null,
      result,
      resultSaved: false,
      deviceErrorCode: null,
      contextSentSessionId: null,
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
  result: MeasurementResult | null;
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
    progress: null,
    result: null,
    resultSaved: false,
    deviceErrorCode: null,
    contextSentSessionId: null,
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
