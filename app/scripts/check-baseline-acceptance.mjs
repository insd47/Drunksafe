import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  maxSoberBaselineAlcoholMgLX1000,
  baselineResultDescription,
  savedResultMessage,
  shouldAcceptSoberBaselineSample,
  shouldUpdateSoberBaseline,
} from '@/lib/personalization/baseline-acceptance';

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const onboardingProfileSource = readFileSync(
  join(appDir, 'src', 'screens', 'onboarding', 'use-profile-form.ts'),
  'utf8'
);

test('sober baseline accepts only low safe alcohol results', () => {
  assert.equal(shouldUpdateSoberBaseline(result({ risk: 'safe', alcohol: 8 })), true);
  assert.equal(shouldAcceptSoberBaselineSample({ risk: 'safe', alcohol_mg_l_x1000: 8 }), true);
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

test('baseline result copy explains whether the sample updates sober baseline', () => {
  assert.equal(
    baselineResultDescription({ risk: 'safe', alcohol_mg_l_x1000: 8 }),
    '개인 sober 기준값에 반영 가능한 결과입니다.'
  );
  assert.equal(
    baselineResultDescription({
      risk: 'safe',
      alcohol_mg_l_x1000: maxSoberBaselineAlcoholMgLX1000 + 1,
    }),
    '히스토리에는 저장하지만 sober baseline에는 반영하지 않습니다.'
  );
  assert.equal(
    baselineResultDescription({ risk: 'caution', alcohol_mg_l_x1000: 8 }),
    '히스토리에는 저장하지만 sober baseline에는 반영하지 않습니다.'
  );
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

test('onboarding refreshes saved baseline evidence when the screen focuses', () => {
  assert.match(onboardingProfileSource, /useFocusEffect/);
  assert.match(onboardingProfileSource, /Promise\.all\(\[readProfile\(\), readBaseline\(\)\]\)/);
  assert.ok(
    onboardingProfileSource.indexOf('useFocusEffect') <
      onboardingProfileSource.indexOf('setBaseline')
  );
});

function result({ risk, alcohol }) {
  return {
    v: 7,
    session_id: `baseline-${risk}-${alcohol}`,
    kind: 'baseline',
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
