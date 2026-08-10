import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeMeasurement } from '@/lib/personalization/analysis';
import { protocolVersion } from '@/lib/ble/model';
import { insertMeasurementRecord, recordFromResult } from '@/lib/storage/history-records';

test('record from result uses the BLE result kind without external session memory', () => {
  const result = measurementResult({ kind: 'baseline' });
  const record = recordFromResult(result, analysisState(), 1798848000000);

  assert.equal(record.kind, 'baseline');
  assert.equal(record.id, 'baseline:fw-baseline:1798848000000');
});

test('risk thresholds classify exact BAC boundaries conservatively', () => {
  assert.equal(
    analyzeMeasurement(measurementResult({ alcohol: 69 }), analysisState()).risk,
    'safe'
  );
  assert.equal(
    analyzeMeasurement(measurementResult({ alcohol: 70 }), analysisState()).risk,
    'caution'
  );
  assert.equal(
    analyzeMeasurement(measurementResult({ alcohol: 140 }), analysisState()).risk,
    'caution'
  );
  assert.equal(
    analyzeMeasurement(measurementResult({ alcohol: 141 }), analysisState()).risk,
    'danger'
  );
});

test('sober baseline corrects the estimate while raw BAC remains the upper bound', () => {
  const result = measurementResult({ alcohol: 100 });
  const withoutBaseline = analyzeMeasurement(result, analysisState());
  const withBaseline = analyzeMeasurement(
    result,
    analysisState({
      sober_alcohol_mg_l_x1000: 20,
      sober_alcohol_mad_mg_l_x1000: 0,
    })
  );

  assert.equal(withoutBaseline.bac_milli_percent, 21);
  assert.equal(withBaseline.bac_milli_percent, 17);
  assert.equal(withoutBaseline.bac_upper_milli_percent, 21);
  assert.equal(withBaseline.bac_upper_milli_percent, 21);
});

test('sober-time estimate uses the conservative 62 mg/L x1000 hourly fallback', () => {
  const analysis = analyzeMeasurement(measurementResult({ alcohol: 165 }), analysisState());

  assert.equal(analysis.sober_time_minutes, 160);
});

test('pulse-null analysis keeps a valid record and lowers resting-pulse confidence', () => {
  const result = measurementResult({ alcohol: 0, pulse: null });
  const state = analysisState({ resting_bpm: 70 });
  const analysis = analyzeMeasurement(result, state);
  const record = recordFromResult(result, state, 1798848000000);

  assert.equal(analysis.confidence_percent, 50);
  assert.equal(record.pulse_bpm, null);
  assert.equal(record.pulse_stable, null);
});

test('raw pulse stability is preserved in the saved record', () => {
  const result = measurementResult({ pulse: { bpm: 96, stable: false } });
  const record = recordFromResult(result, analysisState(), 1798848000000);

  assert.equal(record.pulse_bpm, 96);
  assert.equal(record.pulse_stable, false);
});

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

function measurementResult({ kind = 'measurement', alcohol = 8, pulse = null } = {}) {
  return {
    v: protocolVersion,
    session_id: 'fw-baseline',
    kind,
    alcohol_mg_l_x1000: alcohol,
    pulse,
  };
}

function analysisState(baseline = {}) {
  return {
    baseline: {
      sober_alcohol_mg_l_x1000: null,
      sober_alcohol_mad_mg_l_x1000: null,
      elimination_mg_l_per_hour_x1000: null,
      resting_bpm: null,
      sample_count: 0,
      updated_at_unix_ms: null,
      ...baseline,
    },
    conservativeEliminationMgLPerHourX1000: 62,
    recentMeasurementCount: 0,
  };
}
