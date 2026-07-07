import assert from 'node:assert/strict';
import test from 'node:test';

import {
  measurementReadinessDescription,
  measurementStartBlocker,
  measurementStartBlockerMessage,
} from '@/lib/ble/start-readiness';

test('measurement start requires a connected device first', () => {
  const blocker = measurementStartBlocker({
    connected: false,
    activeMeasurement: false,
    contextReady: true,
    mockMode: false,
  });

  assert.equal(blocker, 'not_connected');
  assert.match(measurementStartBlockerMessage(blocker), /연결/);
});

test('measurement start blocks duplicate active sessions', () => {
  const blocker = measurementStartBlocker({
    connected: true,
    activeMeasurement: true,
    contextReady: true,
    mockMode: false,
  });

  assert.equal(blocker, 'active_measurement');
  assert.match(measurementStartBlockerMessage(blocker), /진행 중/);
});

test('real BLE measurement requires personalization context', () => {
  const blocker = measurementStartBlocker({
    connected: true,
    activeMeasurement: false,
    contextReady: false,
    mockMode: false,
  });

  assert.equal(blocker, 'context_required');
  assert.match(measurementStartBlockerMessage(blocker), /프로필|baseline/);
});

test('mock measurement can run without personalization context', () => {
  assert.equal(
    measurementStartBlocker({
      connected: true,
      activeMeasurement: false,
      contextReady: false,
      mockMode: true,
    }),
    null
  );
});

test('baseline measurement can pass the context gate by marking context ready upstream', () => {
  assert.equal(
    measurementStartBlocker({
      connected: true,
      activeMeasurement: false,
      contextReady: true,
      mockMode: false,
    }),
    null
  );
});

test('measurement start is ready when connected, idle, and context-ready', () => {
  assert.equal(
    measurementStartBlocker({
      connected: true,
      activeMeasurement: false,
      contextReady: true,
      mockMode: false,
    }),
    null
  );
  assert.equal(measurementStartBlockerMessage(null), null);
});

test('live idle route shows the disabled start reason instead of waiting for notify', () => {
  assert.equal(
    measurementReadinessDescription({
      routeMatchesActive: true,
      activeMeasurement: false,
      hasResult: false,
      message: null,
      blocker: 'context_required',
      contextLoadFailed: false,
    }),
    '프로필 또는 sober baseline을 먼저 준비하세요.'
  );
});

test('active route keeps BLE notify progress copy', () => {
  assert.equal(
    measurementReadinessDescription({
      routeMatchesActive: true,
      activeMeasurement: true,
      hasResult: false,
      message: null,
      blocker: 'active_measurement',
      contextLoadFailed: false,
    }),
    'BLE notify를 기다리는 중입니다.'
  );
});
