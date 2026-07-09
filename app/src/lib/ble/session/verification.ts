import type { DeviceEvent, PhoneCommand } from '@/lib/ble/model';
import type { BleSessionSnapshot } from '@/lib/ble/session/state';
import {
  appendBleVerificationLog,
  bleCommandLogEntry,
  bleEventLogEntry,
  bleStateLogEntry,
  updateBleVerificationEvidenceWithCommand,
  updateBleVerificationEvidenceWithEvent,
  updateBleVerificationEvidenceWithState,
} from '@/lib/ble/verification-log';

export function commandVerificationPatch(
  snapshot: BleSessionSnapshot,
  command: PhoneCommand,
  atUnixMs = Date.now()
): VerificationPatch {
  return {
    verificationLog: appendBleVerificationLog(
      snapshot.verificationLog,
      { ...bleCommandLogEntry(command), atUnixMs },
      atUnixMs
    ),
    verificationEvidence: updateBleVerificationEvidenceWithCommand(
      snapshot.verificationEvidence,
      command,
      atUnixMs
    ),
  };
}

export function eventVerificationPatch(
  snapshot: BleSessionSnapshot,
  event: DeviceEvent,
  atUnixMs = Date.now()
): VerificationPatch {
  return {
    verificationLog: appendBleVerificationLog(
      snapshot.verificationLog,
      { ...bleEventLogEntry(event), atUnixMs },
      atUnixMs
    ),
    verificationEvidence: updateBleVerificationEvidenceWithEvent(
      snapshot.verificationEvidence,
      event,
      atUnixMs
    ),
  };
}

export function stateVerificationPatch(
  snapshot: BleSessionSnapshot,
  label: string,
  detail: string,
  sessionId: string | null = null,
  atUnixMs = Date.now()
): VerificationPatch {
  const input = { ...bleStateLogEntry(label, detail, sessionId), atUnixMs };

  return {
    verificationLog: appendBleVerificationLog(snapshot.verificationLog, input, atUnixMs),
    verificationEvidence: updateBleVerificationEvidenceWithState(
      snapshot.verificationEvidence,
      input,
      atUnixMs
    ),
  };
}

type VerificationPatch = Pick<BleSessionSnapshot, 'verificationLog' | 'verificationEvidence'>;
