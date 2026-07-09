import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { protocolVersion } from '@/lib/ble/model';
import {
  resolveMeasureKind,
  resolveMeasureRoute,
  shouldShowResultPreview,
} from '@/lib/ble/measure-route';

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const connectScreenSource = readFileSync(
  join(appDir, 'src', 'screens', 'connect', 'index.tsx'),
  'utf8'
);

test('baseline route follows the active baseline BLE session id', () => {
  const result = measurementResult('baseline-mock-123', 'baseline');
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

test('result preview is hidden while a real measurement is active', () => {
  assert.equal(
    shouldShowResultPreview({
      hasResult: false,
      hasActiveMeasurement: true,
    }),
    false
  );
  assert.equal(
    shouldShowResultPreview({
      hasResult: false,
      hasActiveMeasurement: false,
    }),
    true
  );
  assert.equal(
    shouldShowResultPreview({
      hasResult: true,
      hasActiveMeasurement: false,
    }),
    false
  );
});

test('explicit baseline route wins over a previous measurement error kind', () => {
  assert.equal(
    resolveMeasureKind({
      routeSessionId: 'baseline',
      activeSessionId: 'fw-previous',
      activeMeasurementKind: 'measurement',
    }),
    'baseline'
  );
});

test('live route starts fresh while an exact active route preserves its kind', () => {
  assert.equal(
    resolveMeasureKind({
      routeSessionId: 'live',
      activeSessionId: 'fw-baseline',
      activeMeasurementKind: 'baseline',
    }),
    'measurement'
  );
  assert.equal(
    resolveMeasureKind({
      routeSessionId: 'fw-baseline',
      activeSessionId: 'fw-baseline',
      activeMeasurementKind: 'baseline',
    }),
    'baseline'
  );
});

test('new phone measurements always navigate to the live session route', () => {
  assert.match(connectScreenSource, /router\.push\('\/measure\/live'\)/);
  assert.doesNotMatch(connectScreenSource, /router\.push\(`\/measure\/\$\{ble\.activeSessionId/);
});

function measurementResult(sessionId, kind = 'measurement') {
  return {
    event: 'measurement_result',
    v: protocolVersion,
    session_id: sessionId,
    kind,
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
