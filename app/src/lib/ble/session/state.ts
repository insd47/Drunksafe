import type { DrunksafeBleDevice } from '@/lib/ble/client';
import type {
  ErrorCode,
  MeasurementProgress,
  MeasurementResult,
  StatusKind,
} from '@/lib/ble/model';
import type { BleMeasurementPhase } from '@/lib/ble/measurement-phase';
import { emptyBleVerificationEvidenceSummary } from '@/lib/ble/verification-log';
import type {
  BleVerificationEvidenceSummary,
  BleVerificationLogEntry,
} from '@/lib/ble/verification-log';
import type { MeasurementKind } from '@/lib/storage/history';

export type BleConnectionPhase =
  | 'idle'
  | 'bluetooth_off'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'unsupported'
  | 'error';

export interface BleSessionSnapshot {
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
  verificationLog: BleVerificationLogEntry[];
  verificationEvidence: BleVerificationEvidenceSummary;
  mockMode: boolean;
}

export const initialBleSession: BleSessionSnapshot = {
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
  verificationLog: [],
  verificationEvidence: emptyBleVerificationEvidenceSummary,
  mockMode: false,
};
