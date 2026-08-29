import assert from 'node:assert/strict';
import test from 'node:test';
import {
  preserveCompletedMinute,
  pulseFeedback,
  pulseReadingFreshnessMs,
} from '@/lib/ble/pulse-feedback';

const reading = {
  v: 9,
  session_id: 'fw-1',
  elapsed_ms: 9000,
  bpm: 72,
  peak_count: 9,
  accepted_intervals: 8,
  phase: 'waiting_next',
  reason: null,
  last_failure: null,
  contact_good: true,
  slot_index: 0,
  slot_elapsed_ms: 20_000,
  attempt_elapsed_ms: 20_000,
  consecutive_misses: 0,
  failed_attempts: 0,
  ibi_stddev_ms: 130,
  stable: true,
};
test('stale or absent telemetry never claims valid contact', () => {
  assert.equal(pulseFeedback(null, false).level, 0);
  assert.equal(pulseFeedback(reading, false).level, 0);
});
test('weak, collecting, unstable and stable signals have distinct guidance', () => {
  assert.equal(
    pulseFeedback({ ...reading, stable: false, peak_count: 0, accepted_intervals: 0 }, true).level,
    1
  );
  assert.equal(
    pulseFeedback({ ...reading, stable: false, peak_count: 2, accepted_intervals: 1 }, true).level,
    2
  );
  assert.equal(pulseFeedback({ ...reading, stable: false }, true).level, 3);
  assert.equal(pulseFeedback(reading, true).level, 4);
});
test('a completed minute stays visible until the next minute starts', () => {
  assert.equal(
    preserveCompletedMinute(reading, {
      ...reading,
      stable: false,
      phase: 'collecting',
      attempt_elapsed_ms: 1000,
    }),
    true
  );
  assert.equal(
    preserveCompletedMinute(reading, {
      ...reading,
      stable: false,
      slot_index: 1,
      phase: 'collecting',
      attempt_elapsed_ms: 1000,
    }),
    false
  );
});
test('session completion remains fresh through the fixed minute boundary', () => {
  assert.equal(pulseReadingFreshnessMs(reading, true), 47_000);
  assert.equal(pulseReadingFreshnessMs(reading, false), 3500);
  assert.equal(
    pulseReadingFreshnessMs({ ...reading, stable: false, phase: 'collecting' }, true),
    23_000
  );
});
