import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWeeklyHistoryInsight } from '@/lib/personalization/history-insights';

const now = 1798848000000;

test('weekly insight ignores baseline and stale measurement records', () => {
  const insight = buildWeeklyHistoryInsight(
    [
      record({ kind: 'baseline', risk: 'danger', measured_at_unix_ms: now - 60_000 }),
      record({ risk: 'danger', measured_at_unix_ms: now - 8 * 24 * 60 * 60 * 1000 }),
      record({ risk: 'safe', measured_at_unix_ms: now - 60_000 }),
    ],
    now
  );

  assert.equal(insight.totalCount, 1);
  assert.equal(insight.dangerCount, 0);
  assert.equal(insight.guidanceLevel, 'none');
});

test('single danger result recommends rest but not support escalation', () => {
  const insight = buildWeeklyHistoryInsight([record({ risk: 'danger' })], now);

  assert.equal(insight.totalCount, 1);
  assert.equal(insight.dangerCount, 1);
  assert.equal(insight.guidanceLevel, 'rest');
});

test('repeated danger results recommend support resources', () => {
  const insight = buildWeeklyHistoryInsight(
    [
      record({ risk: 'danger', bac_upper_milli_percent: 42 }),
      record({ risk: 'danger', bac_upper_milli_percent: 36 }),
    ],
    now
  );

  assert.equal(insight.guidanceLevel, 'support');
  assert.equal(insight.averageBacUpperMilliPercent, 39);
  assert.equal(insight.peakBacUpperMilliPercent, 42);
});

test('frequent safe records do not recommend support resources', () => {
  const insight = buildWeeklyHistoryInsight(
    [
      record({ risk: 'safe', bac_upper_milli_percent: 2 }),
      record({ risk: 'safe', bac_upper_milli_percent: 3 }),
      record({ risk: 'safe', bac_upper_milli_percent: 1 }),
      record({ risk: 'safe', bac_upper_milli_percent: 4 }),
    ],
    now
  );

  assert.equal(insight.totalCount, 4);
  assert.equal(insight.guidanceLevel, 'none');
});

test('frequent mixed risk records recommend support resources', () => {
  const insight = buildWeeklyHistoryInsight(
    [
      record({ risk: 'safe' }),
      record({ risk: 'caution' }),
      record({ risk: 'caution' }),
      record({ risk: 'safe' }),
    ],
    now
  );

  assert.equal(insight.totalCount, 4);
  assert.equal(insight.guidanceLevel, 'support');
});

function record(overrides = {}) {
  return {
    id: `measurement:${Math.random()}`,
    kind: 'measurement',
    session_id: 'test-session',
    measured_at_unix_ms: now - 60_000,
    alcohol_mg_l_x1000: 120,
    bac_milli_percent: 25,
    bac_upper_milli_percent: 30,
    sober_time_minutes: 90,
    risk: 'safe',
    confidence_percent: 80,
    pulse_bpm: null,
    pulse_stable: null,
    ...overrides,
  };
}
