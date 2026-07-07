import assert from 'node:assert/strict';
import test from 'node:test';

import { insertMeasurementRecord } from '@/lib/storage/history-records';

test('history insert is idempotent for repeated result notify from the same session', () => {
  const first = record({ id: 'measurement:fw-1:1000', session_id: 'fw-1', measured_at: 1000 });
  const repeated = record({
    id: 'measurement:fw-1:1000',
    session_id: 'fw-1',
    measured_at: 1000,
    alcohol: 99,
  });
  const history = [first];

  const next = insertMeasurementRecord(history, repeated);

  assert.equal(next, history);
  assert.deepEqual(next, [first]);
});

test('history insert preserves reused firmware session ids when measured time differs', () => {
  const previousBoot = record({
    id: 'measurement:fw-1:1000',
    session_id: 'fw-1',
    measured_at: 1000,
  });
  const nextBoot = record({
    id: 'measurement:fw-1:2000',
    session_id: 'fw-1',
    measured_at: 2000,
  });

  assert.deepEqual(insertMeasurementRecord([previousBoot], nextBoot), [nextBoot, previousBoot]);
});

test('history insert keeps baseline and measurement sessions isolated by kind', () => {
  const measurement = record({
    id: 'measurement:shared:1000',
    kind: 'measurement',
    session_id: 'shared',
  });
  const baseline = record({
    id: 'baseline:shared:1000',
    kind: 'baseline',
    session_id: 'shared',
  });

  assert.deepEqual(insertMeasurementRecord([measurement], baseline), [baseline, measurement]);
});

test('history insert keeps the newest 50 unique sessions', () => {
  const history = Array.from({ length: 50 }, (_, index) =>
    record({
      id: `measurement:fw-${index}:1000`,
      session_id: `fw-${index}`,
      measured_at: 1000 + index,
    })
  );
  const next = insertMeasurementRecord(
    history,
    record({ id: 'measurement:fw-new:2000', session_id: 'fw-new', measured_at: 2000 })
  );

  assert.equal(next.length, 50);
  assert.equal(next[0].session_id, 'fw-new');
  assert.equal(next.at(-1)?.session_id, 'fw-48');
});

function record({ id, kind = 'measurement', session_id, measured_at = 1000, alcohol = 8 }) {
  return {
    id,
    kind,
    session_id,
    measured_at_unix_ms: measured_at,
    alcohol_mg_l_x1000: alcohol,
    bac_milli_percent: 2,
    bac_upper_milli_percent: 3,
    sober_time_minutes: 0,
    risk: 'safe',
    confidence_percent: 82,
    pulse_bpm: null,
    pulse_stable: null,
  };
}
