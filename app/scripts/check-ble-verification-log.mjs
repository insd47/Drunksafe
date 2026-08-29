import assert from 'node:assert/strict';
import test from 'node:test';

import { protocolVersion } from '@/lib/ble/model';
import {
  appendBleVerificationLog,
  bleCommandLogEntry,
  bleEventLogEntry,
  bleStateLogEntry,
  emptyBleVerificationEvidenceSummary,
  maxBleVerificationLogEntries,
  updateBleVerificationEvidenceWithCommand,
  updateBleVerificationEvidenceWithEvent,
  updateBleVerificationEvidenceWithState,
} from '@/lib/ble/verification-log';

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

test('verification log formats core v12 phone commands', () => {
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
});

test('verification log formats v12 device events', () => {
  assert.deepEqual(
    bleEventLogEntry({
      event: 'status',
      v: protocolVersion,
      status: 'connected',
      active_session_id: null,
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
      event: 'measurement_started',
      v: protocolVersion,
      session_id: 'fw-result',
      source: 'phone',
      kind: 'measurement',
    }),
    {
      kind: 'event',
      label: 'event:started',
      detail: 'kind=measurement source=phone',
      sessionId: 'fw-result',
    }
  );
  assert.deepEqual(
    bleEventLogEntry({
      event: 'measurement_result',
      v: protocolVersion,
      session_id: 'fw-result',
      kind: 'measurement',
      alcohol_mg_l_x1000: 120,
      pulse: { status: 'unavailable', reason: 'no_signal' },
    }),
    {
      kind: 'event',
      label: 'event:result',
      detail: 'alcohol=120 pulse=unavailable:no_signal',
      sessionId: 'fw-result',
    }
  );
});

test('cancel evidence derives latency from command and terminal error entries', () => {
  let entries = [];

  entries = appendBleVerificationLog(
    entries,
    bleCommandLogEntry({ cmd: 'cancel', session_id: 'fw-cancel' }),
    1800000000420
  );
  entries = appendBleVerificationLog(
    entries,
    bleEventLogEntry({
      event: 'device_error',
      v: protocolVersion,
      session_id: 'fw-cancel',
      code: 'cancelled',
    }),
    1800000000880
  );

  assert.equal(entries[1].atUnixMs - entries[0].atUnixMs, 460);
});

test('verification evidence summary keeps current v12 proof fields beyond the timeline', () => {
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
  appendEvent(startedEvent('baseline-1', 'baseline', 'phone'), 1800000000100);

  for (let index = 0; index < maxBleVerificationLogEntries + 2; index += 1) {
    appendEvent(
      {
        event: 'status',
        v: protocolVersion,
        status: 'measuring',
        active_session_id: `overflow-${index}`,
      },
      1800000000200 + index
    );
  }

  appendEvent(startedEvent('measure-1', 'measurement', 'board_button'), 1800000000400);
  appendCommand({ cmd: 'cancel', session_id: 'measure-1' }, 1800000000500);
  appendEvent(
    {
      event: 'device_error',
      v: protocolVersion,
      session_id: 'measure-1',
      code: 'cancelled',
    },
    1800000000980
  );
  appendEvent(
    {
      event: 'measurement_result',
      v: protocolVersion,
      session_id: 'measure-2',
      kind: 'measurement',
      alcohol_mg_l_x1000: 120,
      pulse: { status: 'unavailable', reason: 'no_signal' },
    },
    1800000001100
  );

  assert.equal(entries.length, maxBleVerificationLogEntries);
  assert.ok(entries.every((entry) => entry.label !== 'state:notify-ready'));
  assert.deepEqual(summary, {
    notifyReadyAtUnixMs: 1800000000000,
    baselineSessionId: 'baseline-1',
    measurementSessionId: 'measure-1',
    boardButtonSessionId: 'measure-1',
    resultSessionId: 'measure-2',
    cancelSessionId: 'measure-1',
    cancelCommandAtUnixMs: 1800000000500,
    cancelErrorSessionId: 'measure-1',
    cancelLatencyMs: 480,
  });
});

function startedEvent(sessionId, kind, source) {
  return {
    event: 'measurement_started',
    v: protocolVersion,
    session_id: sessionId,
    source,
    kind,
  };
}
