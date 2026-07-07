import type { MeasurementResult, Risk } from '@/lib/ble/model';

export const measurementHistoryLimit = 50;

export type MeasurementKind = 'measurement' | 'baseline';

export type MeasurementRecord = {
  id: string;
  kind: MeasurementKind;
  session_id: string;
  measured_at_unix_ms: number;
  alcohol_mg_l_x1000: number;
  bac_milli_percent: number | null;
  bac_upper_milli_percent: number | null;
  sober_time_minutes: number | null;
  risk: Risk;
  confidence_percent: number;
  pulse_bpm: number | null;
  pulse_stable: boolean | null;
};

export function recordFromResult(
  result: MeasurementResult,
  kind: MeasurementKind
): MeasurementRecord {
  const measuredAt = result.measured_at_unix_ms ?? Date.now();

  return {
    id: `${kind}:${result.session_id}:${measuredAt}`,
    kind,
    session_id: result.session_id,
    measured_at_unix_ms: measuredAt,
    alcohol_mg_l_x1000: result.alcohol.mg_l_x1000,
    bac_milli_percent: result.bac_milli_percent,
    bac_upper_milli_percent: result.bac_upper_milli_percent,
    sober_time_minutes: result.sober_time_minutes,
    risk: result.risk,
    confidence_percent: result.confidence_percent,
    pulse_bpm: result.pulse?.bpm ?? null,
    pulse_stable: result.pulse?.stable ?? null,
  };
}

export function insertMeasurementRecord(history: MeasurementRecord[], record: MeasurementRecord) {
  if (history.some((item) => isSameMeasurement(item, record))) {
    return history;
  }

  return [record, ...history].slice(0, measurementHistoryLimit);
}

function isSameMeasurement(left: MeasurementRecord, right: MeasurementRecord) {
  return left.id === right.id;
}
