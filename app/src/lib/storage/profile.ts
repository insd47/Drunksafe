import { protocolVersion } from '@/lib/ble/model';
import type { PhoneContext } from '@/lib/ble/model';
import { readHistoryEntries } from '@/lib/storage/history';
import { readJson, writeJson } from '@/lib/storage/json';

const profileKey = 'drunksafe.profile.v1';
const baselineKey = 'drunksafe.baseline.v1';

export type Sex = 'male' | 'female';

export type UserProfile = {
  age_years: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  sex: Sex | null;
};

export type UserBaseline = {
  sober_alcohol_mg_l_x1000: number | null;
  sober_alcohol_mad_mg_l_x1000: number | null;
  elimination_mg_l_per_hour_x1000: number | null;
  resting_bpm: number | null;
  sample_count: number;
  updated_at_unix_ms: number | null;
};

export const emptyProfile: UserProfile = {
  age_years: null,
  height_cm: null,
  weight_kg: null,
  sex: null,
};

export const emptyBaseline: UserBaseline = {
  sober_alcohol_mg_l_x1000: null,
  sober_alcohol_mad_mg_l_x1000: null,
  elimination_mg_l_per_hour_x1000: null,
  resting_bpm: null,
  sample_count: 0,
  updated_at_unix_ms: null,
};

export async function readProfile() {
  return readJson(profileKey, createEmptyProfile, isUserProfile);
}

export async function writeProfile(profile: UserProfile) {
  if (!isUserProfile(profile)) {
    throw new Error('Invalid Drunksafe user profile');
  }

  await writeJson(profileKey, profile);
}

export async function readBaseline() {
  return readJson(baselineKey, createEmptyBaseline, isUserBaseline);
}

export async function writeBaseline(baseline: UserBaseline) {
  if (!isUserBaseline(baseline)) {
    throw new Error('Invalid Drunksafe user baseline');
  }

  await writeJson(baselineKey, baseline);
}

export async function buildPhoneContext(
  sessionId: string,
  historyLimit: number
): Promise<PhoneContext> {
  const baseline = await readBaseline();
  const recent = await readHistoryEntries(clampHistoryLimit(historyLimit));

  return {
    v: protocolVersion,
    session_id: sessionId,
    phone_time_unix_ms: Date.now(),
    recent,
    sober_alcohol_mg_l_x1000: baseline.sober_alcohol_mg_l_x1000,
    sober_alcohol_mad_mg_l_x1000: baseline.sober_alcohol_mad_mg_l_x1000,
    elimination_mg_l_per_hour_x1000: baseline.elimination_mg_l_per_hour_x1000,
    resting_bpm: baseline.resting_bpm,
  };
}

function createEmptyProfile() {
  return { ...emptyProfile };
}

function createEmptyBaseline() {
  return { ...emptyBaseline };
}

function isUserProfile(value: unknown): value is UserProfile {
  return (
    isRecord(value) &&
    isNullableRange(value.age_years, 1, 130) &&
    isNullableRange(value.height_cm, 30, 250) &&
    isNullableRange(value.weight_kg, 2, 500) &&
    (value.sex === null || value.sex === 'male' || value.sex === 'female')
  );
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

function isNullableRange(value: unknown, min: number, max: number): value is number | null {
  return (
    value === null ||
    (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max)
  );
}

function clampHistoryLimit(limit: number) {
  if (!Number.isInteger(limit)) {
    return 0;
  }

  return Math.max(0, Math.min(limit, 50));
}
