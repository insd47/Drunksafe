import assert from 'node:assert/strict';
import test from 'node:test';

import {
  shouldPreserveSessionMessage,
  statusMessageAfterNotify,
  terminalDeviceErrorPatch,
} from '@/lib/ble/session-patches';

test('terminal device error clears stale measurement artifacts', () => {
  const patch = terminalDeviceErrorPatch(
    {
      v: 6,
      session_id: 'fw-7',
      code: 'weak_breath',
    },
    '호기 입력이 약합니다.'
  );

  assert.equal(patch.measurementPhase, 'error');
  assert.equal(patch.activeSessionId, 'fw-7');
  assert.equal(patch.progress, null);
  assert.equal(patch.result, null);
  assert.equal(patch.resultSaved, false);
  assert.equal(patch.deviceStatus, 'error');
  assert.equal(patch.deviceErrorCode, 'weak_breath');
  assert.equal(patch.contextSentSessionId, null);
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
