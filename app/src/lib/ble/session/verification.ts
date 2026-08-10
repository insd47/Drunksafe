import type { DeviceEvent, PhoneCommand } from '@/lib/ble/model';
import {
  appendBleVerificationLog,
  bleCommandLogEntry,
  bleEventLogEntry,
  bleStateLogEntry,
  emptyBleVerificationEvidenceSummary,
  updateBleVerificationEvidenceWithCommand,
  updateBleVerificationEvidenceWithEvent,
  updateBleVerificationEvidenceWithState,
  type BleVerificationEvidenceSummary,
  type BleVerificationLogEntry,
  type BleVerificationLogInput,
} from '@/lib/ble/verification-log';

export type BleVerificationSnapshot = {
  verificationLog: BleVerificationLogEntry[];
  verificationEvidence: BleVerificationEvidenceSummary;
};

const initialVerificationSnapshot: BleVerificationSnapshot = {
  verificationLog: [],
  verificationEvidence: emptyBleVerificationEvidenceSummary,
};

export class BleVerificationStore {
  private readonly listeners = new Set<() => void>();
  private snapshot = initialVerificationSnapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  command(command: PhoneCommand) {
    if (!verificationEnabled()) return;

    const atUnixMs = Date.now();
    const input = bleCommandLogEntry(command);
    this.set({
      verificationLog: appendBleVerificationLog(
        this.snapshot.verificationLog,
        { ...input, atUnixMs },
        atUnixMs
      ),
      verificationEvidence: updateBleVerificationEvidenceWithCommand(
        this.snapshot.verificationEvidence,
        command,
        atUnixMs
      ),
    });
  }

  event(event: DeviceEvent) {
    if (!verificationEnabled()) return;

    const atUnixMs = Date.now();
    const input = bleEventLogEntry(event);
    this.set({
      verificationLog: appendBleVerificationLog(
        this.snapshot.verificationLog,
        { ...input, atUnixMs },
        atUnixMs
      ),
      verificationEvidence: updateBleVerificationEvidenceWithEvent(
        this.snapshot.verificationEvidence,
        event,
        atUnixMs
      ),
    });
  }

  state(label: string, detail: string, sessionId: string | null = null) {
    if (!verificationEnabled()) return;

    const atUnixMs = Date.now();
    const input: BleVerificationLogInput = {
      ...bleStateLogEntry(label, detail, sessionId),
      atUnixMs,
    };
    this.set({
      verificationLog: appendBleVerificationLog(this.snapshot.verificationLog, input, atUnixMs),
      verificationEvidence: updateBleVerificationEvidenceWithState(
        this.snapshot.verificationEvidence,
        input,
        atUnixMs
      ),
    });
  }

  clear() {
    this.set(initialVerificationSnapshot);
  }

  private set(snapshot: BleVerificationSnapshot) {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }
}

function verificationEnabled() {
  return typeof __DEV__ === 'undefined' || __DEV__;
}
