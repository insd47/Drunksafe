import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSessionStorageId,
  formatSessionMeasurementTitle,
  sessionMeasurementNumber,
} from '@/lib/sessions/identity';

test('reused firmware session IDs produce unique local storage IDs', () => {
  assert.notEqual(
    createSessionStorageId('fw-hrwatch-1', 1_000),
    createSessionStorageId('fw-hrwatch-1', 2_000)
  );
});

test('same-day sessions are numbered oldest-first regardless of index order', () => {
  const first = session('first', new Date(2026, 7, 29, 9, 0).getTime());
  const second = session('second', new Date(2026, 7, 29, 18, 0).getTime());
  const nextDay = session('next-day', new Date(2026, 7, 30, 8, 0).getTime());
  const newestFirst = [nextDay, second, first];

  assert.equal(sessionMeasurementNumber(newestFirst, first), 1);
  assert.equal(sessionMeasurementNumber(newestFirst, second), 2);
  assert.equal(sessionMeasurementNumber(newestFirst, nextDay), 1);
  assert.equal(
    formatSessionMeasurementTitle(second.downloaded_at_unix_ms, 2),
    '8월 29일 2번째 측정'
  );
});

function session(id, downloaded_at_unix_ms) {
  return { id, downloaded_at_unix_ms };
}
