import { useSyncExternalStore } from 'react';

import { DrunksafeBleClient } from '@/lib/ble/client';
import type { AlcoholStateLabel, MeasurementKind, PulseReading } from '@/lib/ble/model';
import type { BleSessionState } from '@/lib/ble/session/reducer';
import {
  BleSessionStore,
  type PpgPoint,
  type SessionUiSnapshot,
} from '@/lib/ble/session/store';
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
  startPulsePhase: () => Promise<void>;
  cancelMeasurement: () => Promise<void>;
  timeoutMeasurement: () => Promise<void>;
  connectMockDevice: () => Promise<void>;
  startPulseStream: (streamRaw: boolean) => Promise<void>;
  stopPulseStream: () => Promise<void>;
  startSession: () => Promise<void>;
  startAlcoholTrack: () => Promise<void>;
  endSession: () => Promise<void>;
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
    startPulsePhase: bleSession.startPulsePhase,
    cancelMeasurement: bleSession.cancelMeasurement,
    timeoutMeasurement: bleSession.timeoutMeasurement,
    connectMockDevice: bleSession.connectMockDevice,
    startPulseStream: bleSession.startPulseStream,
    stopPulseStream: bleSession.stopPulseStream,
    startSession: bleSession.startSession,
    startAlcoholTrack: bleSession.startAlcoholTrack,
    endSession: bleSession.endSession,
  };
}

export function useBleVerification(): BleVerificationSnapshot {
  return useSyncExternalStore<BleVerificationSnapshot>(
    bleSession.verification.subscribe,
    bleSession.verification.getSnapshot,
    bleSession.verification.getSnapshot
  );
}

export type { PpgPoint } from '@/lib/ble/session/store';
export type { PulseReading } from '@/lib/ble/model';

/** 측정 중 스트리밍되는 PPG raw waveform 링버퍼 — 진단 화면에서 사용한다. */
export function usePpgSnapshot(): PpgPoint[] {
  return useSyncExternalStore<PpgPoint[]>(
    bleSession.subscribePpg,
    bleSession.getPpgSnapshot,
    bleSession.getPpgSnapshot
  );
}

/** 실시간 pulse 진단 스트리밍의 최신 reading — 개발자 도구에서 사용한다. */
export function usePulseReading(): PulseReading | null {
  return useSyncExternalStore<PulseReading | null>(
    bleSession.subscribePulseReading,
    bleSession.getPulseReadingSnapshot,
    bleSession.getPulseReadingSnapshot
  );
}

/** pulse 스트리밍 활성 여부 — 화면을 벗어났다 돌아와도 유지된다 (개발자 도구). */
export function usePulseStreaming(): boolean {
  return useSyncExternalStore<boolean>(
    bleSession.subscribePulseStreaming,
    bleSession.getPulseStreamingSnapshot,
    bleSession.getPulseStreamingSnapshot
  );
}

export type { SessionUiSnapshot } from '@/lib/ble/session/store';

/** ESP32 음주 세션의 진행/다운로드/결과 상태. */
export function useSession(): SessionUiSnapshot {
  return useSyncExternalStore<SessionUiSnapshot>(
    bleSession.subscribeSession,
    bleSession.getSessionSnapshot,
    bleSession.getSessionSnapshot
  );
}

/** 알코올 측정 중 ZE29A 실시간 상태 — "지금 부세요" 타이밍 안내용. */
export function useAlcoholState(): AlcoholStateLabel | null {
  return useSyncExternalStore<AlcoholStateLabel | null>(
    bleSession.subscribeAlcoholState,
    bleSession.getAlcoholStateSnapshot,
    bleSession.getAlcoholStateSnapshot
  );
}
