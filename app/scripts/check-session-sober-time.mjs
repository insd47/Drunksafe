import assert from 'node:assert/strict';
import test from 'node:test';

import { estimateSessionSoberTime } from '@/lib/personalization/session-sober-time';

test('uses the personal linear elimination rate above the measured sober baseline', () => {
  assert.deepEqual(estimateSessionSoberTime(132, baseline({ sober: 8, elimination: 62 })), {
    minutes: 120,
    eliminationMgLPerHourX1000: 62,
    alcoholAboveBaselineMgLX1000: 124,
  });
});

test('does not invent an estimate without a learned personal rate', () => {
  assert.equal(estimateSessionSoberTime(132, baseline({ elimination: null })), null);
});

test('never returns negative time below the sober baseline', () => {
  assert.equal(estimateSessionSoberTime(5, baseline({ sober: 8, elimination: 62 }))?.minutes, 0);
});

function baseline({ sober = null, elimination = null } = {}) {
  return {
    sober_alcohol_mg_l_x1000: sober,
    sober_alcohol_mad_mg_l_x1000: null,
    elimination_mg_l_per_hour_x1000: elimination,
    resting_bpm: 72,
    sample_count: 1,
    updated_at_unix_ms: null,
  };
}
