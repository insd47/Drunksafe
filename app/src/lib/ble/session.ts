import { useSyncExternalStore } from 'react';

import { DrunksafeBleClient } from '@/lib/ble/client';
import { persistMeasurementResult } from '@/lib/ble/session/persistence';
import { BleSessionStore } from '@/lib/ble/session/store';
import { buildPhoneContext } from '@/lib/storage/profile';

export type { BleMeasurementPhase } from '@/lib/ble/measurement-phase';
export type { BleConnectionPhase, BleSessionSnapshot } from '@/lib/ble/session/state';

export const bleSession = new BleSessionStore({
  createClient: () => new DrunksafeBleClient(),
  buildContext: buildPhoneContext,
  persistResult: persistMeasurementResult,
  now: Date.now,
});

export function useBleSession() {
  const snapshot = useSyncExternalStore(
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
    connectMockDevice: bleSession.connectMockDevice,
    disconnect: bleSession.disconnect,
    cancelMeasurement: bleSession.cancelMeasurement,
    startMeasurement: bleSession.startMeasurement,
    destroy: bleSession.destroy,
  };
}

export type BleSession = ReturnType<typeof useBleSession>;
