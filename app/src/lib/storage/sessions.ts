import type { SessionRecord, SessionRecordKind, SessionStateLabel } from '@/lib/ble/model';
import { estimateEliminationMgLPerHourX1000 } from '@/lib/personalization/session-beta';
import { readJson, writeJson } from '@/lib/storage/json';
import { readBaseline, writeBaseline } from '@/lib/storage/profile';

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
  samples: StoredSessionSample[];
};

export type SessionSummary = {
  id: string;
  downloaded_at_unix_ms: number;
  record_count: number;
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
  downloadedAtUnixMs: number
): Promise<ProcessedSession> {
  const ordered = [...records].sort((left, right) => left.index - right.index);
  const id = ordered[0]?.session_id ?? `session-${downloadedAtUnixMs}`;
  const lastT = ordered.reduce((max, record) => Math.max(max, record.t_ms), 0);
  const sessionStart = downloadedAtUnixMs - lastT;

  const stored: StoredSession = {
    id,
    downloaded_at_unix_ms: downloadedAtUnixMs,
    session_start_unix_ms: sessionStart,
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

  const elimination = estimateEliminationMgLPerHourX1000(records);
  const index = await readSessionIndex();
  const summary: SessionSummary = {
    id,
    downloaded_at_unix_ms: downloadedAtUnixMs,
    record_count: ordered.length,
    elimination_mg_l_per_hour_x1000: elimination,
  };
  const nextIndex = [summary, ...index.filter((item) => item.id !== id)].slice(0, maxStoredSessions);
  await writeJson(sessionIndexKey, nextIndex);

  const valid = nextIndex
    .map((item) => item.elimination_mg_l_per_hour_x1000)
    .filter((value): value is number => value !== null);

  let applied: number | null = null;

  if (valid.length >= minSessionsForElimination) {
    const average = clampU16(Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length));
    const baseline = await readBaseline();
    await writeBaseline({
      ...baseline,
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

function sessionDataKey(id: string) {
  return `drunksafe.session.${id}.v1`;
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
