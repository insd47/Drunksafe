import type { StatusKind } from '@/lib/ble/model';

export type BleMeasurementPhase =
  | 'idle'
  | 'starting'
  | 'waiting_context'
  | 'measuring'
  | 'result'
  | 'error';

export function isActiveMeasurementPhase(phase: BleMeasurementPhase) {
  return phase === 'starting' || phase === 'waiting_context' || phase === 'measuring';
}

export function isActiveMeasurementStatus(status: StatusKind | null) {
  return status === 'measuring';
}

export function hasActiveMeasurement(snapshot: {
  measurementPhase: BleMeasurementPhase;
  deviceStatus: StatusKind | null;
  activeSessionId: string | null;
}) {
  return (
    isActiveMeasurementPhase(snapshot.measurementPhase) ||
    (snapshot.activeSessionId !== null && isActiveMeasurementStatus(snapshot.deviceStatus))
  );
}
