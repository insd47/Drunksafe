import type { Risk } from '@/lib/personalization/analysis';
import {
  insertMeasurementRecord,
  measurementHistoryLimit,
  recordFromResult,
  type MeasurementRecord,
} from '@/lib/storage/history-records';
import { readJson, writeJson } from '@/lib/storage/json';

const historyKey = 'drunksafe.history.v1';

export { insertMeasurementRecord, recordFromResult };
export type { MeasurementKind, MeasurementRecord, Risk } from '@/lib/storage/history-records';

export async function readHistory() {
  return readJson<MeasurementRecord[]>(
    historyKey,
    () => [],
    isMeasurementHistory,
    sanitizeMeasurementHistory
  );
}

export async function latestMeasurement() {
  const history = await readHistory();
  return history.find((record) => record.kind === 'measurement') ?? null;
}

export async function readMeasurementById(id: string) {
  const history = await readHistory();
  return history.find((record) => record.id === id || record.session_id === id) ?? null;
}

export async function saveMeasurement(record: MeasurementRecord) {
  if (!isMeasurementRecord(record)) {
    throw new Error('Invalid Drunksafe measurement record');
  }

  const history = await readHistory();
  const next = insertMeasurementRecord(history, record);

  if (next === history) {
    return { inserted: false };
  }

  await writeJson(historyKey, next);
  return { inserted: true };
}

function isMeasurementHistory(value: unknown): value is MeasurementRecord[] {
  return Array.isArray(value) && value.every(isMeasurementRecord);
}

function sanitizeMeasurementHistory(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  return value.filter(isMeasurementRecord).slice(0, measurementHistoryLimit);
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
