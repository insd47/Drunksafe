import assert from 'node:assert/strict';
import test from 'node:test';

import { protocolVersion } from '@/lib/ble/model';
import { resolveMeasureRoute } from '@/lib/ble/measure-route';

test('baseline route follows the active baseline BLE session id', () => {
  const result = measurementResult('baseline-mock-123');
  const route = resolveMeasureRoute({
    routeSessionId: 'baseline',
    activeMeasurementKind: 'baseline',
    activeSessionId: 'baseline-mock-123',
    progress: null,
    result,
  });

  assert.equal(route.result, result);
  assert.equal(route.activeSessionId, 'baseline-mock-123');
  assert.equal(route.routeMatchesActive, true);
});

test('baseline route does not borrow a normal measurement result', () => {
  const result = measurementResult('measurement-mock-123');
  const route = resolveMeasureRoute({
    routeSessionId: 'baseline',
    activeMeasurementKind: 'measurement',
    activeSessionId: 'measurement-mock-123',
    progress: null,
    result,
  });

  assert.equal(route.result, null);
  assert.equal(route.activeSessionId, 'baseline');
  assert.equal(route.routeMatchesActive, false);
});

test('exact session routes still show their matching saved live result', () => {
  const result = measurementResult('fw-42');
  const route = resolveMeasureRoute({
    routeSessionId: 'fw-42',
    activeMeasurementKind: 'measurement',
    activeSessionId: 'fw-42',
    progress: null,
    result,
  });

  assert.equal(route.result, result);
  assert.equal(route.activeSessionId, 'fw-42');
});

function measurementResult(sessionId) {
  return {
    event: 'measurement_result',
    v: protocolVersion,
    session_id: sessionId,
    measured_at_unix_ms: 1798848000000,
    alcohol: {
      mg_l_x1000: 8,
    },
    pulse: null,
    bac_milli_percent: 2,
    bac_upper_milli_percent: 3,
    sober_time_minutes: 0,
    risk: 'safe',
    confidence_percent: 82,
  };
}
