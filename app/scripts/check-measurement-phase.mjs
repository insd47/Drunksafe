import assert from 'node:assert/strict';
import test from 'node:test';

import { hasActiveMeasurement, isActiveMeasurementPhase } from '@/lib/ble/measurement-phase';

test('active measurement phases block duplicate start commands', () => {
  for (const phase of ['starting', 'waiting_context', 'measuring']) {
    assert.equal(isActiveMeasurementPhase(phase), true);
  }

  for (const phase of ['idle', 'result', 'error']) {
    assert.equal(isActiveMeasurementPhase(phase), false);
  }
});

test('measuring status blocks duplicate start commands', () => {
  assert.equal(
    hasActiveMeasurement({
      measurementPhase: 'idle',
      deviceStatus: 'measuring',
      activeSessionId: 'fw-1',
    }),
    true
  );
});

test('result-ready and orphan status sessions allow the next measurement', () => {
  assert.equal(
    hasActiveMeasurement({
      measurementPhase: 'result',
      deviceStatus: 'result_ready',
      activeSessionId: 'fw-1',
    }),
    false
  );
  assert.equal(
    hasActiveMeasurement({
      measurementPhase: 'idle',
      deviceStatus: 'measuring',
      activeSessionId: null,
    }),
    false
  );
});
