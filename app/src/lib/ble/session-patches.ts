import type { DeviceError, ErrorCode, StatusKind } from '@/lib/ble/model';
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
