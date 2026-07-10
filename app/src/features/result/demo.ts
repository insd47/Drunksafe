import { protocolVersion, type MeasurementResult } from '@/lib/ble/model';
import type { MeasurementKind } from '@/lib/storage/history';

export default function createDemoResult(kind: MeasurementKind): MeasurementResult {
  const baseline = kind === 'baseline';

  return {
    v: protocolVersion,
    session_id: baseline ? 'baseline-demo' : 'demo-session',
    kind,
    measured_at_unix_ms: Date.now(),
    alcohol: { mg_l_x1000: baseline ? 8 : 80 },
    pulse: {
      bpm: baseline ? 72 : 92,
      stable: true,
      confidence_percent: baseline ? 88 : 82,
    },
    bac_milli_percent: baseline ? 4 : 38,
    bac_upper_milli_percent: baseline ? 6 : 46,
    sober_time_minutes: baseline ? null : 130,
    risk: baseline ? 'safe' : 'danger',
    confidence_percent: baseline ? 88 : 82,
  };
}
