import { useSyncExternalStore } from 'react';

import BleSessionStore from '@/lib/ble/session/store';

export type { BleMeasurementPhase } from '@/lib/ble/measurement-phase';
export type { BleConnectionPhase, BleSessionSnapshot } from '@/lib/ble/session/state';

export const bleSession = new BleSessionStore();

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
