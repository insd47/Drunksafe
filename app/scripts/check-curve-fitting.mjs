import assert from 'node:assert/strict';
import test from 'node:test';

import {
  estimateExponentialSoberTime,
  fitExponentialProfile,
} from '@/lib/personalization/fitting-profile';
import { protocolVersion } from '@/lib/ble/model';

function alcohol(index, minutes, value) {
  return {
    v: protocolVersion,
    session_id: 'curve-test',
    index,
    total: 8,
    t_ms: minutes * 60_000,
    kind: 'alcohol',
    state: null,
    mg_l_x1000: value,
    bpm: null,
  };
}

test('curve fitting starts at the first maximum without requiring a Ct=10 reading', () => {
  const records = [20, 40, 80, 64, 51, 41, 33, 26].map((value, index) =>
    alcohol(index, index * 10, value)
  );
  const profile = fitExponentialProfile(records);
  assert.ok(profile);
  assert.equal(profile.diagnostics?.c0, 80);
  assert.equal(profile.diagnostics?.peakAtMs, 20 * 60_000);
  assert.ok(profile.kPerMinute > 0);
  assert.ok(profile.kLowPerMinute <= profile.kPerMinute);
  assert.ok(profile.kHighPerMinute >= profile.kPerMinute);
  assert.ok(records.every((record) => (record.mg_l_x1000 ?? 0) > 10));
});

test('missed fitting slots are excluded and Ct=10 prediction is bounded', () => {
  const records = [80, 64, 51, 41, 33, 26].map((value, index) => alcohol(index, index * 10, value));
  records.splice(3, 0, {
    ...alcohol(99, 25, 0),
    kind: 'alcohol_missed',
    mg_l_x1000: null,
  });
  const profile = fitExponentialProfile(records);
  assert.ok(profile);
  const estimate = estimateExponentialSoberTime(50, profile);
  assert.ok(estimate);
  assert.ok(estimate.earliestMinutes <= estimate.minutes);
  assert.ok(estimate.minutes <= estimate.latestMinutes);
});
