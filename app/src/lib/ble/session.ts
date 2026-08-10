import { useSyncExternalStore } from 'react';

import { DrunksafeBleClient } from '@/lib/ble/client';
import type { MeasurementKind } from '@/lib/ble/model';
import type { BleSessionState } from '@/lib/ble/session/reducer';
import { BleSessionStore } from '@/lib/ble/session/store';
import type { BleVerificationSnapshot } from '@/lib/ble/session/verification';

export type {
  BleSessionState,
  ConnectionState,
  MeasurementErrorCode,
  MeasurementState,
} from '@/lib/ble/session/reducer';
export type { BleVerificationSnapshot } from '@/lib/ble/session/verification';

export const bleSession = new BleSessionStore({
  createClient: () => new DrunksafeBleClient(),
});

export type BleSessionHook = BleSessionState & {
  initialize: () => void;
  startScan: () => Promise<void>;
  stopScan: () => Promise<void>;
  connect: (deviceId: string) => Promise<void>;
  disconnect: () => Promise<void>;
  startMeasurement: (kind?: MeasurementKind) => Promise<void>;
  cancelMeasurement: () => Promise<void>;
  connectMockDevice: () => Promise<void>;
};

export function useBleSession(): BleSessionHook {
  const snapshot = useSyncExternalStore<BleSessionState>(
    bleSession.subscribe,
    bleSession.getSnapshot,
    bleSession.getSnapshot
  );

  return {
    ...snapshot,
    initialize: bleSession.initialize,
    startScan: bleSession.startScan,
    stopScan: bleSession.stopScan,
    connect: bleSession.connect,
    disconnect: bleSession.disconnect,
    startMeasurement: bleSession.startMeasurement,
    cancelMeasurement: bleSession.cancelMeasurement,
    connectMockDevice: bleSession.connectMockDevice,
  };
}

export function useBleVerification(): BleVerificationSnapshot {
  return useSyncExternalStore<BleVerificationSnapshot>(
    bleSession.verification.subscribe,
    bleSession.verification.getSnapshot,
    bleSession.verification.getSnapshot
  );
}
