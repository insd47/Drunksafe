import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatDrivingDescription,
  formatDrivingStatus,
  formatRisk,
  riskTone,
} from '@/lib/format/measurement';

test('driving status copy does not promise that safe measurements allow driving', () => {
  assert.equal(formatRisk('safe'), '안전');
  assert.equal(formatDrivingStatus('safe'), '위험 낮음');
  assert.doesNotMatch(formatDrivingStatus('safe'), /가능/);
  assert.match(formatDrivingDescription('safe'), /보증하지 않습니다/);
  assert.equal(riskTone('safe'), 'safe');
});

test('caution and danger driving copy gives conservative next actions', () => {
  assert.equal(formatDrivingStatus('caution'), '운전 보류');
  assert.match(formatDrivingDescription('caution'), /재측정/);
  assert.equal(riskTone('caution'), 'caution');

  assert.equal(formatDrivingStatus('danger'), '운전 금지');
  assert.match(formatDrivingDescription('danger'), /운전하지 마세요/);
  assert.equal(riskTone('danger'), 'danger');
});
