import type { HistoryEntry, MeasurementResult, Risk } from '@/lib/ble/model';
import { readJson, writeJson } from '@/lib/storage/json';

const historyKey = 'drunksafe.history.v1';
const historyLimit = 50;

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

export async function readHistory() {
  return readJson<MeasurementRecord[]>(
    historyKey,
    () => [],
    isMeasurementHistory,
    sanitizeMeasurementHistory
  );
}

export async function readHistoryEntries(limit: number): Promise<HistoryEntry[]> {
  const history = await readHistory();

  return history
    .filter((record) => record.kind === 'measurement')
    .slice(0, clampReadLimit(limit))
    .map((record) => ({
      measured_at_unix_ms: record.measured_at_unix_ms,
      alcohol_mg_l_x1000: record.alcohol_mg_l_x1000,
      bac_milli_percent: record.bac_milli_percent,
      risk: record.risk,
      confidence_percent: record.confidence_percent,
    }));
}

export async function latestMeasurement() {
  const history = await readHistory();
  return history.find((record) => record.kind === 'measurement') ?? null;
}

export async function saveMeasurement(record: MeasurementRecord) {
  if (!isMeasurementRecord(record)) {
    throw new Error('Invalid Drunksafe measurement record');
  }

  const history = await readHistory();
  const next = [record, ...history.filter((item) => item.id !== record.id)].slice(0, historyLimit);

  await writeJson(historyKey, next);
}

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

function isMeasurementHistory(value: unknown): value is MeasurementRecord[] {
  return Array.isArray(value) && value.every(isMeasurementRecord);
}

function sanitizeMeasurementHistory(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  return value.filter(isMeasurementRecord).slice(0, historyLimit);
}

function isMeasurementRecord(value: unknown): value is MeasurementRecord {
  return (
    isRecord(value) &&
    (value.kind === 'measurement' || value.kind === 'baseline') &&
    isString(value.id) &&
    isString(value.session_id) &&
    isU64(value.measured_at_unix_ms) &&
    isU16(value.alcohol_mg_l_x1000) &&
    isNullableU16(value.bac_milli_percent) &&
    isNullableU16(value.bac_upper_milli_percent) &&
    isNullableU16(value.sober_time_minutes) &&
    isRisk(value.risk) &&
    isPercent(value.confidence_percent) &&
    isNullableFiniteNumber(value.pulse_bpm) &&
    (value.pulse_stable === null || typeof value.pulse_stable === 'boolean')
  );
}

function isRisk(value: unknown): value is Risk {
  return value === 'safe' || value === 'caution' || value === 'danger';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isU16(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 65535;
}

function isU64(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPercent(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100;
}

function isNullableU16(value: unknown): value is number | null {
  return value === null || isU16(value);
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function clampReadLimit(limit: number) {
  if (!Number.isInteger(limit)) {
    return 0;
  }

  return Math.max(0, Math.min(limit, historyLimit));
}
