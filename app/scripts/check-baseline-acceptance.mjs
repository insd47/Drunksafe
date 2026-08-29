import assert from 'node:assert/strict';
import test from 'node:test';

import {
  maxSoberBaselineAlcoholMgLX1000,
  baselineIssueCopy,
  baselineIssues,
  savedResultMessage,
  shouldAcceptSoberBaselineSample,
  shouldUpdateSoberBaseline,
} from '@/lib/personalization/baseline-acceptance';
import { baselineAfterResult } from '@/lib/ble/session/persistence';

test('sober baseline accepts only low alcohol and stable resting HR', () => {
  assert.equal(shouldUpdateSoberBaseline(result({ risk: 'safe', alcohol: 8 })), true);
  assert.equal(
    shouldAcceptSoberBaselineSample({
      risk: 'safe',
      alcohol_mg_l_x1000: 8,
      pulse_bpm: 72,
      pulse_stable: true,
    }),
    true
  );
  assert.equal(
    shouldUpdateSoberBaseline(
      result({
        risk: 'safe',
        alcohol: maxSoberBaselineAlcoholMgLX1000,
      })
    ),
    true
  );
});

test('sober baseline rejects high or risky baseline sessions', () => {
  assert.equal(
    shouldUpdateSoberBaseline(
      result({
        risk: 'safe',
        alcohol: maxSoberBaselineAlcoholMgLX1000 + 1,
      })
    ),
    false
  );
  assert.equal(shouldUpdateSoberBaseline(result({ risk: 'caution', alcohol: 20 })), false);
  assert.equal(shouldUpdateSoberBaseline(result({ risk: 'danger', alcohol: 20 })), false);
  assert.equal(shouldUpdateSoberBaseline(result({ risk: 'safe', alcohol: 8, bpm: 59 })), false);
  assert.equal(shouldUpdateSoberBaseline(result({ risk: 'safe', alcohol: 8, bpm: 91 })), false);
  assert.equal(
    shouldUpdateSoberBaseline(result({ risk: 'safe', alcohol: 8, stable: false })),
    false
  );
});

test('baseline reports heart-rate and alcohol failures independently', () => {
  assert.deepEqual(
    baselineIssues({
      risk: 'safe',
      alcohol_mg_l_x1000: 8,
      pulse_bpm: 96,
      pulse_stable: true,
    }),
    ['heart_rate']
  );
  assert.deepEqual(
    baselineIssues({
      risk: 'caution',
      alcohol_mg_l_x1000: 51,
      pulse_bpm: 72,
      pulse_stable: true,
    }),
    ['alcohol']
  );
  assert.deepEqual(
    baselineIssues({
      risk: 'caution',
      alcohol_mg_l_x1000: 51,
      pulse_bpm: null,
      pulse_stable: false,
    }),
    ['heart_rate', 'alcohol']
  );
  assert.match(baselineIssueCopy('heart_rate').description, /60~90 BPM/);
  assert.match(baselineIssueCopy('alcohol').description, /환기/);
});

test('stored baseline uses the same validity rules', () => {
  assert.deepEqual(
    baselineIssues({
      sample_count: 2,
      resting_bpm: 95,
      sober_alcohol_mg_l_x1000: 8,
    }),
    ['heart_rate']
  );
  assert.deepEqual(
    baselineIssues({
      sample_count: 2,
      resting_bpm: 72,
      sober_alcohol_mg_l_x1000: 51,
    }),
    ['alcohol']
  );
  assert.deepEqual(
    baselineIssues({
      sample_count: 0,
      resting_bpm: null,
      sober_alcohol_mg_l_x1000: null,
    }),
    ['missing', 'heart_rate', 'alcohol']
  );
});

test('baseline result copy distinguishes history save from baseline acceptance', () => {
  assert.equal(
    savedResultMessage({ kind: 'baseline', baselineAccepted: false }),
    '결과를 히스토리에 저장했지만, 개인 baseline에는 반영하지 않았습니다.'
  );
  assert.equal(
    savedResultMessage({ kind: 'baseline', baselineAccepted: true }),
    '결과를 히스토리에 저장했습니다.'
  );
  assert.equal(
    savedResultMessage({ kind: 'measurement', baselineAccepted: null }),
    '결과를 히스토리에 저장했습니다.'
  );
});

test('a valid controlled baseline replaces a stale reference instead of averaging with it', () => {
  const next = baselineAfterResult(
    {
      sober_alcohol_mg_l_x1000: 40,
      sober_alcohol_mad_mg_l_x1000: 5,
      elimination_mg_l_per_hour_x1000: 62,
      resting_bpm: 60,
      sample_count: 100,
      updated_at_unix_ms: 1,
    },
    result({ risk: 'safe', alcohol: 8, bpm: 76 })
  );
  assert.equal(next.resting_bpm, 76);
  assert.equal(next.sober_alcohol_mg_l_x1000, 8);
  assert.equal(next.sample_count, 1);
  assert.equal(next.elimination_mg_l_per_hour_x1000, 62);
});

function result({ risk, alcohol, bpm = 72, stable = true }) {
  return {
    id: `baseline:${risk}:${alcohol}`,
    session_id: `baseline-${risk}-${alcohol}`,
    kind: 'baseline',
    measured_at_unix_ms: 1798848000000,
    alcohol_mg_l_x1000: alcohol,
    bac_milli_percent: Math.round(alcohol * 0.21),
    bac_upper_milli_percent: Math.round(alcohol * 0.21),
    sober_time_minutes: 0,
    risk,
    confidence_percent: 88,
    pulse_bpm: bpm,
    pulse_stable: stable,
  };
}
