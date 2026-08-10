import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activeSessionIdAfterStatusNotify,
  disconnectOrInterruptSessionPatch,
  disconnectSessionPatch,
  idleSessionPatch,
  interruptedMeasurementPatch,
  shouldPreserveSessionMessage,
  statusMessageAfterNotify,
  terminalDeviceErrorPatch,
} from '@/lib/ble/session-patches';

test('terminal device error clears stale measurement artifacts', () => {
  const patch = terminalDeviceErrorPatch(
    {
      v: 7,
      session_id: 'fw-7',
      code: 'alcohol_sensor',
    },
    '알코올 센서 오류가 감지됐습니다.'
  );

  assert.equal(patch.measurementPhase, 'error');
  assert.equal(patch.activeSessionId, 'fw-7');
  assert.equal(patch.progress, null);
  assert.equal(patch.result, null);
  assert.equal(patch.resultSaved, false);
  assert.equal(patch.deviceStatus, 'error');
  assert.equal(patch.deviceErrorCode, 'alcohol_sensor');
  assert.equal(patch.contextSentSessionId, null);
});

test('idle session patch clears visible session artifacts after disconnect', () => {
  const patch = idleSessionPatch();

  assert.equal(patch.measurementPhase, 'idle');
  assert.equal(patch.activeSessionId, null);
  assert.equal(patch.progress, null);
  assert.equal(patch.result, null);
  assert.equal(patch.resultSaved, false);
  assert.equal(patch.deviceErrorCode, null);
  assert.equal(patch.contextSentSessionId, null);
  assert.equal(patch.message, null);
});

test('disconnect session patch preserves unsaved live results', () => {
  const result = measurementResult('fw-unsaved');
  const patch = disconnectSessionPatch({ result, resultSaved: false });

  assert.equal(patch.measurementPhase, 'result');
  assert.equal(patch.activeSessionId, 'fw-unsaved');
  assert.equal(patch.progress, null);
  assert.equal(patch.result, result);
  assert.equal(patch.resultSaved, false);
  assert.equal(patch.deviceErrorCode, null);
  assert.equal(patch.contextSentSessionId, null);
  assert.match(patch.message, /저장에 실패/);
});

test('disconnect session patch clears saved live results', () => {
  const patch = disconnectSessionPatch({
    result: measurementResult('fw-saved'),
    resultSaved: true,
  });

  assert.equal(patch.measurementPhase, 'idle');
  assert.equal(patch.activeSessionId, null);
  assert.equal(patch.result, null);
  assert.equal(patch.resultSaved, false);
});

test('disconnect during an active measurement leaves an interruption message', () => {
  const patch = disconnectOrInterruptSessionPatch({
    activeMeasurement: true,
    result: null,
    resultSaved: false,
    interruptedMessage: '측정 중 연결이 해제되었습니다.',
  });

  assert.equal(patch.measurementPhase, 'error');
  assert.equal(patch.progress, null);
  assert.equal(patch.result, null);
  assert.equal(patch.resultSaved, false);
  assert.equal(patch.contextSentSessionId, null);
  assert.match(patch.message, /연결이 해제/);
});

test('interrupted measurement patch clears stale progress and result artifacts', () => {
  const patch = interruptedMeasurementPatch('Bluetooth를 켜야 장치를 찾을 수 있습니다.');

  assert.equal(patch.measurementPhase, 'error');
  assert.equal(patch.progress, null);
  assert.equal(patch.result, null);
  assert.equal(patch.resultSaved, false);
  assert.equal(patch.deviceErrorCode, null);
  assert.equal(patch.contextSentSessionId, null);
  assert.equal(patch.message, 'Bluetooth를 켜야 장치를 찾을 수 있습니다.');
  assert.equal(Object.hasOwn(patch, 'activeSessionId'), false);
});

test('terminal status notify preserves the last terminal session id', () => {
  assert.equal(
    activeSessionIdAfterStatusNotify({
      status: 'idle',
      measurementPhase: 'error',
      currentActiveSessionId: 'fw-7',
      notifiedActiveSessionId: null,
    }),
    'fw-7'
  );
  assert.equal(
    activeSessionIdAfterStatusNotify({
      status: 'connected',
      measurementPhase: 'idle',
      currentActiveSessionId: 'fw-7',
      notifiedActiveSessionId: null,
    }),
    null
  );
});

test('terminal status notify preserves result and error messages', () => {
  assert.equal(shouldPreserveSessionMessage('result_ready', 'result'), true);
  assert.equal(shouldPreserveSessionMessage('error', 'error'), true);
  assert.equal(shouldPreserveSessionMessage('idle', 'error'), true);
  assert.equal(shouldPreserveSessionMessage('connected', 'idle'), false);
  assert.equal(
    statusMessageAfterNotify({
      status: 'result_ready',
      measurementPhase: 'result',
      currentMessage: '결과를 히스토리에 저장했습니다.',
    }),
    '결과를 히스토리에 저장했습니다.'
  );
  assert.equal(
    statusMessageAfterNotify({
      status: 'connected',
      measurementPhase: 'idle',
      currentMessage: '장치가 연결됐습니다.',
    }),
    null
  );
});

function measurementResult(sessionId) {
  return {
    v: 7,
    session_id: sessionId,
    kind: 'measurement',
    measured_at_unix_ms: 1798848000000,
    alcohol: {
      mg_l_x1000: 80,
    },
    pulse: null,
    bac_milli_percent: 17,
    bac_upper_milli_percent: 21,
    sober_time_minutes: 84,
    risk: 'caution',
    confidence_percent: 78,
  };
}
