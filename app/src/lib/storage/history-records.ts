import type { MeasurementKind, MeasurementResult } from '@/lib/ble/model';
import {
  analyzeMeasurement,
  type MeasurementAnalysisState,
  type Risk,
} from '@/lib/personalization/analysis';

export const measurementHistoryLimit = 50;

export type { MeasurementKind } from '@/lib/ble/model';

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
  state: MeasurementAnalysisState,
  measuredAtUnixMs = Date.now()
): MeasurementRecord {
  const analysis = analyzeMeasurement(result, state);

  return {
    id: `${result.kind}:${result.session_id}:${measuredAtUnixMs}`,
    kind: result.kind,
    session_id: result.session_id,
    measured_at_unix_ms: measuredAtUnixMs,
    alcohol_mg_l_x1000: result.alcohol_mg_l_x1000,
    bac_milli_percent: analysis.bac_milli_percent,
    bac_upper_milli_percent: analysis.bac_upper_milli_percent,
    sober_time_minutes: analysis.sober_time_minutes,
    risk: analysis.risk,
    confidence_percent: analysis.confidence_percent,
    pulse_bpm: result.pulse?.bpm ?? null,
    pulse_stable: result.pulse?.stable ?? null,
  };
}

export type { Risk } from '@/lib/personalization/analysis';

export function insertMeasurementRecord(history: MeasurementRecord[], record: MeasurementRecord) {
  if (history.some((item) => isSameMeasurement(item, record))) {
    return history;
  }

  return [record, ...history].slice(0, measurementHistoryLimit);
}

function isSameMeasurement(left: MeasurementRecord, right: MeasurementRecord) {
  return left.id === right.id;
}
