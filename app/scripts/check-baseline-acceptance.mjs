import assert from 'node:assert/strict';
import test from 'node:test';

import {
  maxSoberBaselineAlcoholMgLX1000,
  savedResultMessage,
  shouldUpdateSoberBaseline,
} from '@/lib/personalization/baseline-acceptance';

test('sober baseline accepts only low safe alcohol results', () => {
  assert.equal(shouldUpdateSoberBaseline(result({ risk: 'safe', alcohol: 8 })), true);
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
});

test('baseline result copy distinguishes history save from baseline acceptance', () => {
  assert.equal(
    savedResultMessage({ kind: 'baseline', baselineAccepted: false }),
    '결과를 히스토리에 저장했습니다. Baseline 조건은 충족하지 못했습니다.'
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

function result({ risk, alcohol }) {
  return {
    v: 6,
    session_id: `baseline-${risk}-${alcohol}`,
    measured_at_unix_ms: 1798848000000,
    alcohol: {
      mg_l_x1000: alcohol,
    },
    pulse: {
      bpm: 72,
      stable: true,
      confidence_percent: 88,
    },
    bac_milli_percent: Math.round(alcohol * 0.21),
    bac_upper_milli_percent: Math.round(alcohol * 0.21),
    sober_time_minutes: 0,
    risk,
    confidence_percent: 88,
  };
}
