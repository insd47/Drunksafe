import type { SessionRecord, SessionRecordKind, SessionStateLabel } from '@/lib/ble/model';
import { estimateEliminationMgLPerHourX1000 } from '@/lib/personalization/session-beta';
import { createSessionStorageId } from '@/lib/sessions/identity';
import { readJson, writeJson } from '@/lib/storage/json';
import { readBaseline, writeBaseline } from '@/lib/storage/profile';
import { fitExponentialProfile, writeFittingProfile } from '@/lib/personalization/fitting-profile';

const sessionIndexKey = 'drunksafe.sessions.index.v1';
/** 이만큼 세션이 모여야 분해속도 평균을 baseline에 반영한다. */
const minSessionsForElimination = 3;
const maxStoredSessions = 50;

/** 저장되는 세션 샘플 한 건 — 세션 상대시간과 절대시각을 함께 남긴다. */
export type StoredSessionSample = {
  t_ms: number;
  at_unix_ms: number;
  kind: SessionRecordKind;
  state: SessionStateLabel | null;
  mg_l_x1000: number | null;
  bpm: number | null;
};

export type StoredSession = {
  id: string;
  downloaded_at_unix_ms: number;
  session_start_unix_ms: number;
  /** 세션 시작 명령에 사용한 개인 휴식 심박. 이전 저장본에는 없을 수 있다. */
  resting_bpm?: number | null;
  /** 이번 세션 결과를 반영하기 전의 sober BrAC 기준값. */
  sober_alcohol_mg_l_x1000_at_start?: number | null;
  /** 이번 세션 결과를 반영하기 전의 개인 분해속도. */
  elimination_mg_l_per_hour_x1000_at_start?: number | null;
  samples: StoredSessionSample[];
};

export type SessionSummary = {
  id: string;
  downloaded_at_unix_ms: number;
  record_count: number;
  /** 세션 길이(ms). 이전 버전 데이터에는 없을 수 있다. */
  duration_ms?: number;
  elimination_mg_l_per_hour_x1000: number | null;
};

export type ProcessedSession = {
  id: string;
  eliminationMgLPerHourX1000: number | null;
  sessionsCounted: number;
  validCount: number;
  appliedEliminationMgLPerHourX1000: number | null;
};

/** 다운로드된 세션 로그를 저장하고, 분해속도를 추정해 필요 시 baseline에 평균 반영한다. */
export async function persistSessionDownload(
  records: SessionRecord[],
  downloadedAtUnixMs: number,
  restingBpm: number | null = null
): Promise<ProcessedSession> {
  const ordered = [...records].sort((left, right) => left.index - right.index);
  const deviceSessionId = ordered[0]?.session_id ?? 'session';
  const id = createSessionStorageId(deviceSessionId, downloadedAtUnixMs);
  const lastT = ordered.reduce((max, record) => Math.max(max, record.t_ms), 0);
  const sessionStart = downloadedAtUnixMs - lastT;
  const baselineBeforeSessionUpdate = await readBaseline();

  const stored: StoredSession = {
    id,
    downloaded_at_unix_ms: downloadedAtUnixMs,
    session_start_unix_ms: sessionStart,
    resting_bpm: restingBpm,
    sober_alcohol_mg_l_x1000_at_start: baselineBeforeSessionUpdate.sober_alcohol_mg_l_x1000,
    elimination_mg_l_per_hour_x1000_at_start:
      baselineBeforeSessionUpdate.elimination_mg_l_per_hour_x1000,
    samples: ordered.map((record) => ({
      t_ms: record.t_ms,
      at_unix_ms: sessionStart + record.t_ms,
      kind: record.kind,
      state: record.state,
      mg_l_x1000: record.mg_l_x1000,
      bpm: record.bpm,
    })),
  };

  await writeJson(sessionDataKey(id), stored);

  if (deviceSessionId.startsWith('fw-alctrack-')) {
    const profile = fitExponentialProfile(ordered);
    if (profile) await writeFittingProfile(profile);
  }

  const elimination = estimateEliminationMgLPerHourX1000(records);
  const index = await readSessionIndex();
  const summary: SessionSummary = {
    id,
    downloaded_at_unix_ms: downloadedAtUnixMs,
    record_count: ordered.length,
    duration_ms: lastT,
    elimination_mg_l_per_hour_x1000: elimination,
  };
  const nextIndex = [summary, ...index.filter((item) => item.id !== id)].slice(
    0,
    maxStoredSessions
  );
  await writeJson(sessionIndexKey, nextIndex);

  const valid = nextIndex
    .map((item) => item.elimination_mg_l_per_hour_x1000)
    .filter((value): value is number => value !== null);

  let applied: number | null = null;

  if (elimination !== null && valid.length >= minSessionsForElimination) {
    const average = clampU16(
      Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length)
    );
    await writeBaseline({
      ...baselineBeforeSessionUpdate,
      elimination_mg_l_per_hour_x1000: average,
      updated_at_unix_ms: downloadedAtUnixMs,
    });
    applied = average;
  }

  return {
    id,
    eliminationMgLPerHourX1000: elimination,
    sessionsCounted: nextIndex.length,
    validCount: valid.length,
    appliedEliminationMgLPerHourX1000: applied,
  };
}

export async function readSessionIndex(): Promise<SessionSummary[]> {
  return readJson(sessionIndexKey, () => [], isSessionIndex);
}

/** 저장된 세션 원본(샘플 포함)을 읽는다. 없거나 손상되면 null. */
export async function readSession(id: string): Promise<StoredSession | null> {
  return readJson<StoredSession | null>(sessionDataKey(id), () => null, isNullableStoredSession);
}

function sessionDataKey(id: string) {
  return `drunksafe.session.${id}.v1`;
}

function isNullableStoredSession(value: unknown): value is StoredSession | null {
  return value === null || isStoredSession(value);
}

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.session_start_unix_ms === 'number' &&
    Array.isArray(record.samples)
  );
}

function isSessionIndex(value: unknown): value is SessionSummary[] {
  return Array.isArray(value) && value.every(isSessionSummary);
}

function isSessionSummary(value: unknown): value is SessionSummary {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.downloaded_at_unix_ms === 'number' &&
    typeof record.record_count === 'number' &&
    (record.elimination_mg_l_per_hour_x1000 === null ||
      typeof record.elimination_mg_l_per_hour_x1000 === 'number')
  );
}

function clampU16(value: number) {
  return Math.max(0, Math.min(65535, value));
}
