import type { MeasurementProgress, MeasurementResult } from '@/lib/ble/model';
import type { MeasurementKind } from '@/lib/storage/history';

type MeasureRouteSnapshot = {
  routeSessionId: string;
  activeMeasurementKind: MeasurementKind;
  activeSessionId: string | null;
  progress: MeasurementProgress | null;
  result: MeasurementResult | null;
};

export function resolveMeasureRoute(snapshot: MeasureRouteSnapshot) {
  const tracksActiveSession =
    snapshot.routeSessionId === 'live' ||
    (snapshot.routeSessionId === 'baseline' && snapshot.activeMeasurementKind === 'baseline');

  const progress =
    tracksActiveSession || snapshot.routeSessionId === snapshot.progress?.session_id
      ? snapshot.progress
      : null;
  const result =
    tracksActiveSession || snapshot.routeSessionId === snapshot.result?.session_id
      ? snapshot.result
      : null;
  const activeSessionId = tracksActiveSession
    ? (result?.session_id ??
      progress?.session_id ??
      snapshot.activeSessionId ??
      snapshot.routeSessionId)
    : snapshot.routeSessionId;

  return {
    progress,
    result,
    activeSessionId,
    routeMatchesActive: tracksActiveSession || snapshot.routeSessionId === snapshot.activeSessionId,
  };
}
