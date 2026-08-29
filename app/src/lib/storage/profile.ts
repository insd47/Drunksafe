import { readJson, writeJson } from '@/lib/storage/json';

const baselineKey = 'drunksafe.baseline.v1';
const conservativeBacEliminationMilliPercentPerHour = 13;

export type UserBaseline = {
  sober_alcohol_mg_l_x1000: number | null;
  sober_alcohol_mad_mg_l_x1000: number | null;
  elimination_mg_l_per_hour_x1000: number | null;
  resting_bpm: number | null;
  sample_count: number;
  updated_at_unix_ms: number | null;
};

export const emptyBaseline: UserBaseline = {
  sober_alcohol_mg_l_x1000: null,
  sober_alcohol_mad_mg_l_x1000: null,
  elimination_mg_l_per_hour_x1000: null,
  resting_bpm: null,
  sample_count: 0,
  updated_at_unix_ms: null,
};

export async function readBaseline() {
  return readJson(baselineKey, createEmptyBaseline, isUserBaseline);
}

export async function writeBaseline(baseline: UserBaseline) {
  if (!isUserBaseline(baseline)) {
    throw new Error('Invalid Drunksafe user baseline');
  }

  await writeJson(baselineKey, baseline);
}

/** Clear only sober reference values; keep separately learned elimination rate. */
export async function clearSoberBaseline() {
  const current = await readBaseline();
  const next: UserBaseline = {
    ...current,
    sober_alcohol_mg_l_x1000: null,
    sober_alcohol_mad_mg_l_x1000: null,
    resting_bpm: null,
    sample_count: 0,
    updated_at_unix_ms: null,
  };
  await writeBaseline(next);
  return next;
}

export function conservativeEliminationMgLPerHourX1000() {
  return Math.ceil((conservativeBacEliminationMilliPercentPerHour * 100) / 21);
}

function createEmptyBaseline() {
  return { ...emptyBaseline };
}

function isUserBaseline(value: unknown): value is UserBaseline {
  return (
    isRecord(value) &&
    isNullableU16(value.sober_alcohol_mg_l_x1000) &&
    isNullableU16(value.sober_alcohol_mad_mg_l_x1000) &&
    isNullableU16(value.elimination_mg_l_per_hour_x1000) &&
    isNullableU16(value.resting_bpm) &&
    isU16(value.sample_count) &&
    isNullableU64(value.updated_at_unix_ms)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isU16(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 65535;
}

function isU64(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isNullableU16(value: unknown): value is number | null {
  return value === null || isU16(value);
}

function isNullableU64(value: unknown): value is number | null {
  return value === null || isU64(value);
}
