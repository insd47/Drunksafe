import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectMvpVerificationRunData,
  assertCleanMainStatus,
  isCleanMainStatus,
  outputPathForRun,
  renderMvpVerificationRun,
  requiredEvidenceFields,
} from './create-mvp-verification-run.mjs';

test('MVP evidence run template covers every required evidence field', () => {
  const data = {
    branch: 'main',
    commit: '0123456789abcdef0123456789abcdef01234567',
    shortCommit: '0123456',
    createdAt: '2026-07-07T00:00:00.000Z',
    fileStamp: '2026-07-07T00-00-00-000Z',
    status: '## main...origin/main',
    recentPrCommits: ['0123456 MVP 고위험 항목 상태 갱신 (#59)'],
    serialPorts: ['/dev/cu.usbserial-0001'],
    likelyEsp32SerialPorts: ['/dev/cu.usbserial-0001'],
  };
  const markdown = renderMvpVerificationRun(data);

  for (const field of requiredEvidenceFields) {
    assert.match(markdown, new RegExp(`\\| ${escapeRegExp(field)} \\|`));
  }

  assert.match(markdown, /0-6번 항목이 실제 보드에서 모두 통과/);
  assert.match(markdown, /ESP32 flash 완료/);
  assert.match(markdown, /measurement_started\.kind=baseline/);
  assert.match(markdown, /measurement_started\.source=board_button/);
  assert.match(markdown, /raw-only 측정이 즉시 시작/);
  assert.match(markdown, /Notify subscription race/);
  assert.match(markdown, /ZE29 work mode 잔류/);
  assert.match(markdown, /ESP32 후보 serial port/);
  assert.match(markdown, /실기기 preflight/);
  assert.match(markdown, /pnpm mvp:hardware-preflight/);
  assert.match(markdown, /129\/109\/지역 센터/);
  assert.match(markdown, /반복 위험 샘플 개선 안내 캡처/);
});

test('MVP evidence run collector records current git and serial context', () => {
  const data = collectMvpVerificationRunData({
    now: new Date('2026-07-07T00:00:00.000Z'),
  });

  assert.match(data.commit, /^[0-9a-f]{40}$/);
  assert.match(data.shortCommit, /^[0-9a-f]+$/);
  assert.match(data.status, /^## /);
  assert.equal(data.createdAt, '2026-07-07T00:00:00.000Z');
  assert.ok(Array.isArray(data.serialPorts));
  assert.ok(Array.isArray(data.likelyEsp32SerialPorts));
});

test('MVP evidence run files require a clean main checkout by default', () => {
  assert.equal(isCleanMainStatus('## main...origin/main'), true);
  assert.equal(isCleanMainStatus('## feature/mvp-evidence-run-template'), false);
  assert.equal(
    isCleanMainStatus(`## main...origin/main
 M .DS_Store`),
    false
  );

  assert.doesNotThrow(() => assertCleanMainStatus('## main...origin/main'));
  assert.throws(
    () =>
      assertCleanMainStatus(`## main...origin/main
 M .DS_Store
?? matches_move`),
    /clean main\.\.\.origin\/main checkout/
  );
});

test('MVP evidence run output path is timestamped by commit', () => {
  const outPath = outputPathForRun(
    {
      fileStamp: '2026-07-07T00-00-00-000Z',
      shortCommit: '0123456',
    },
    { repoDir: '/repo' }
  );

  assert.equal(outPath, '/repo/.docs/mvp-runs/2026-07-07T00-00-00-000Z-0123456.md');
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
