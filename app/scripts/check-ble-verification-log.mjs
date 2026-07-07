import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  appendBleVerificationLog,
  bleCommandLogEntry,
  bleEventLogEntry,
  bleStateLogEntry,
  emptyBleVerificationEvidenceSummary,
  isBleVerificationAckCorrelated,
  maxBleVerificationLogEntries,
  updateBleVerificationEvidenceWithCommand,
  updateBleVerificationEvidenceWithEvent,
  updateBleVerificationEvidenceWithState,
} from '@/lib/ble/verification-log';

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const sessionSource = readFileSync(join(appDir, 'src', 'lib', 'ble', 'session.ts'), 'utf8');
const connectScreenSource = readFileSync(
  join(appDir, 'src', 'screens', 'connect', 'index.tsx'),
  'utf8'
);

test('verification log keeps the newest bounded timeline with stable keys', () => {
  let entries = [];

  for (let index = 0; index < maxBleVerificationLogEntries + 5; index += 1) {
    entries = appendBleVerificationLog(
      entries,
      bleStateLogEntry('state:test', `entry=${index}`),
      1800000000000
    );
  }

  assert.equal(entries.length, maxBleVerificationLogEntries);
  assert.equal(entries[0].detail, 'entry=5');
  assert.equal(entries.at(-1)?.detail, `entry=${maxBleVerificationLogEntries + 4}`);
  assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length);
});

test('verification log formats phone commands with session correlation fields', () => {
  assert.deepEqual(bleCommandLogEntry({ cmd: 'start', kind: 'measurement' }), {
    kind: 'command',
    label: 'cmd:start',
    detail: 'kind=measurement',
    sessionId: null,
  });

  assert.deepEqual(bleCommandLogEntry({ cmd: 'cancel', session_id: 'fw-cancel' }), {
    kind: 'command',
    label: 'cmd:cancel',
    detail: 'phone requested cancel',
    sessionId: 'fw-cancel',
  });

  assert.deepEqual(
    bleCommandLogEntry({
      cmd: 'context',
      v: 7,
      session_id: 'fw-context',
      phone_time_unix_ms: 1800000000000,
      recent: [],
      sober_alcohol_mg_l_x1000: null,
      sober_alcohol_mad_mg_l_x1000: null,
      elimination_mg_l_per_hour_x1000: null,
      resting_bpm: null,
    }),
    {
      kind: 'command',
      label: 'cmd:context',
      detail: 'recent=0 baseline=-',
      sessionId: 'fw-context',
    }
  );
});

test('verification log formats device events needed for MVP evidence', () => {
  assert.deepEqual(
    bleEventLogEntry({
      event: 'status',
      v: 7,
      status: 'connected',
      active_session_id: null,
      battery_percent: null,
      firmware_version: 'mvp',
    }),
    {
      kind: 'event',
      label: 'event:status',
      detail: 'status=connected active=-',
      sessionId: null,
    }
  );

  assert.deepEqual(
    bleEventLogEntry({
      event: 'measurement_result',
      v: 7,
      session_id: 'fw-result',
      kind: 'measurement',
      measured_at_unix_ms: 1800000001000,
      alcohol: {
        mg_l_x1000: 120,
      },
      pulse: null,
      bac_milli_percent: 25,
      bac_upper_milli_percent: 31,
      sober_time_minutes: 90,
      risk: 'caution',
      confidence_percent: 80,
    }),
    {
      kind: 'event',
      label: 'event:result',
      detail: 'risk=caution bac=25 upper=31',
      sessionId: 'fw-result',
    }
  );

  assert.deepEqual(
    bleEventLogEntry({
      event: 'device_error',
      v: 7,
      session_id: 'fw-cancel',
      code: 'cancelled',
    }),
    {
      kind: 'event',
      label: 'event:error',
      detail: 'code=cancelled',
      sessionId: 'fw-cancel',
    }
  );
});

test('cancel evidence can derive latency from command and terminal error entries', () => {
  let entries = [];

  entries = appendBleVerificationLog(
    entries,
    bleEventLogEntry({
      event: 'measurement_started',
      v: 7,
      session_id: 'fw-cancel',
      source: 'phone',
      kind: 'measurement',
      history_limit: 8,
      needs_context: true,
      sync_time: true,
    }),
    1800000000000
  );
  entries = appendBleVerificationLog(
    entries,
    bleCommandLogEntry({ cmd: 'cancel', session_id: 'fw-cancel' }),
    1800000000420
  );
  entries = appendBleVerificationLog(
    entries,
    bleEventLogEntry({
      event: 'device_error',
      v: 7,
      session_id: 'fw-cancel',
      code: 'cancelled',
    }),
    1800000000880
  );

  const cancelCommand = entries.find(
    (entry) => entry.label === 'cmd:cancel' && entry.sessionId === 'fw-cancel'
  );
  const cancelError = entries.find(
    (entry) =>
      entry.label === 'event:error' &&
      entry.sessionId === 'fw-cancel' &&
      entry.detail === 'code=cancelled'
  );

  assert.ok(cancelCommand);
  assert.ok(cancelError);
  assert.equal(cancelError.atUnixMs - cancelCommand.atUnixMs, 460);
});

test('verification evidence summary keeps MVP proof fields beyond bounded timeline', () => {
  let entries = [];
  let summary = emptyBleVerificationEvidenceSummary;

  const appendState = (input, atUnixMs) => {
    entries = appendBleVerificationLog(entries, input, atUnixMs);
    summary = updateBleVerificationEvidenceWithState(summary, input, atUnixMs);
  };

  const appendCommand = (command, atUnixMs) => {
    entries = appendBleVerificationLog(entries, bleCommandLogEntry(command), atUnixMs);
    summary = updateBleVerificationEvidenceWithCommand(summary, command, atUnixMs);
  };

  const appendEvent = (event, atUnixMs) => {
    entries = appendBleVerificationLog(entries, bleEventLogEntry(event), atUnixMs);
    summary = updateBleVerificationEvidenceWithEvent(summary, event, atUnixMs);
  };

  appendState(bleStateLogEntry('state:notify-ready', 'Drunksafe status=connected'), 1800000000000);
  appendEvent(
    {
      event: 'measurement_started',
      v: 7,
      session_id: 'baseline-1',
      source: 'phone',
      kind: 'baseline',
      history_limit: 8,
      needs_context: true,
      sync_time: true,
    },
    1800000000100
  );
  appendEvent(
    {
      event: 'measurement_progress',
      v: 7,
      session_id: 'baseline-1',
      step: 'preparing',
      percent: 5,
    },
    1800000000200
  );

  for (let index = 0; index < maxBleVerificationLogEntries + 2; index += 1) {
    appendEvent(
      {
        event: 'measurement_progress',
        v: 7,
        session_id: 'baseline-1',
        step: 'sampling_pulse',
        percent: Math.min(99, index + 10),
      },
      1800000000300 + index
    );
  }

  appendEvent(
    {
      event: 'measurement_started',
      v: 7,
      session_id: 'measure-1',
      source: 'board_button',
      kind: 'measurement',
      history_limit: 8,
      needs_context: true,
      sync_time: true,
    },
    1800000000400
  );
  appendCommand({ cmd: 'cancel', session_id: 'measure-1' }, 1800000000500);
  appendEvent(
    {
      event: 'device_error',
      v: 7,
      session_id: 'measure-1',
      code: 'cancelled',
    },
    1800000000980
  );
  appendEvent(
    {
      event: 'measurement_result',
      v: 7,
      session_id: 'measure-2',
      kind: 'measurement',
      measured_at_unix_ms: 1800000001000,
      alcohol: {
        mg_l_x1000: 120,
      },
      pulse: null,
      bac_milli_percent: 25,
      bac_upper_milli_percent: 31,
      sober_time_minutes: 90,
      risk: 'caution',
      confidence_percent: 80,
    },
    1800000001100
  );
  appendCommand({ cmd: 'ack', session_id: 'measure-2' }, 1800000001200);

  assert.equal(entries.length, maxBleVerificationLogEntries);
  assert.ok(entries.every((entry) => entry.label !== 'state:notify-ready'));
  assert.deepEqual(summary, {
    notifyReadyAtUnixMs: 1800000000000,
    baselineSessionId: 'baseline-1',
    measurementSessionId: 'measure-1',
    boardButtonSessionId: 'measure-1',
    resultSessionId: 'measure-2',
    ackSessionId: 'measure-2',
    cancelSessionId: 'measure-1',
    cancelCommandAtUnixMs: 1800000000500,
    cancelErrorSessionId: 'measure-1',
    cancelLatencyMs: 480,
  });
  assert.equal(isBleVerificationAckCorrelated(summary), true);

  const mismatch = updateBleVerificationEvidenceWithCommand(
    {
      ...summary,
      resultSessionId: 'measure-2',
      ackSessionId: null,
    },
    { cmd: 'ack', session_id: 'other-session' },
    1800000001300
  );

  assert.equal(isBleVerificationAckCorrelated(mismatch), false);
});

test('BLE session and connect screen expose the verification timeline', () => {
  assert.match(sessionSource, /verificationLog: BleVerificationLogEntry\[\]/);
  assert.match(sessionSource, /bleEventLogEntry\(event\)/);
  assert.match(sessionSource, /bleCommandLogEntry\(command\)/);
  assert.match(sessionSource, /state:notify-ready/);
  assert.match(sessionSource, /verificationEvidence: BleVerificationEvidenceSummary/);
  assert.match(connectScreenSource, /BLE 검증 로그/);
  assert.match(connectScreenSource, /MVP 증거 누적/);
  assert.match(connectScreenSource, /ble\.verificationEvidence/);
  assert.match(connectScreenSource, /isBleVerificationAckCorrelated/);
  assert.match(connectScreenSource, /ble\.verificationLog/);
});
