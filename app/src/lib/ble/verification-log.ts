import type { DeviceEvent, PhoneCommand } from '@/lib/ble/model';

export type BleVerificationLogKind = 'command' | 'event' | 'state';

export type BleVerificationLogEntry = {
  id: string;
  kind: BleVerificationLogKind;
  label: string;
  detail: string;
  sessionId: string | null;
  atUnixMs: number;
};

export type BleVerificationLogInput = Omit<BleVerificationLogEntry, 'id' | 'atUnixMs'> & {
  atUnixMs?: number;
};

export const maxBleVerificationLogEntries = 20;

export function appendBleVerificationLog(
  entries: BleVerificationLogEntry[],
  input: BleVerificationLogInput,
  now = Date.now()
) {
  const atUnixMs = input.atUnixMs ?? now;
  const idBase = `${atUnixMs}:${input.kind}:${input.label}`;
  const entry: BleVerificationLogEntry = {
    ...input,
    atUnixMs,
    id: nextLogEntryId(entries, idBase),
  };

  return [...entries, entry].slice(-maxBleVerificationLogEntries);
}

export function bleCommandLogEntry(command: PhoneCommand): BleVerificationLogInput {
  switch (command.cmd) {
    case 'start':
      return {
        kind: 'command',
        label: 'cmd:start',
        detail: `kind=${command.kind}`,
        sessionId: null,
      };
    case 'context':
      return {
        kind: 'command',
        label: 'cmd:context',
        detail: `recent=${command.recent.length} baseline=${nullableNumber(command.sober_alcohol_mg_l_x1000)}`,
        sessionId: command.session_id,
      };
    case 'cancel':
      return {
        kind: 'command',
        label: 'cmd:cancel',
        detail: 'phone requested cancel',
        sessionId: command.session_id,
      };
    case 'time':
      return {
        kind: 'command',
        label: 'cmd:time',
        detail: `unix=${command.unix_time_ms}`,
        sessionId: null,
      };
    case 'ack':
      return {
        kind: 'command',
        label: 'cmd:ack',
        detail: 'result acknowledged',
        sessionId: command.session_id,
      };
  }
}

export function bleEventLogEntry(event: DeviceEvent): BleVerificationLogInput {
  switch (event.event) {
    case 'status':
      return {
        kind: 'event',
        label: 'event:status',
        detail: `status=${event.status} active=${event.active_session_id ?? '-'}`,
        sessionId: event.active_session_id,
      };
    case 'measurement_started':
      return {
        kind: 'event',
        label: 'event:started',
        detail: `kind=${event.kind} source=${event.source} context=${event.needs_context ? 'needed' : 'none'}`,
        sessionId: event.session_id,
      };
    case 'measurement_progress':
      return {
        kind: 'event',
        label: 'event:progress',
        detail: `${event.step} ${event.percent}%`,
        sessionId: event.session_id,
      };
    case 'measurement_result':
      return {
        kind: 'event',
        label: 'event:result',
        detail: `risk=${event.risk} bac=${nullableNumber(event.bac_milli_percent)} upper=${nullableNumber(
          event.bac_upper_milli_percent
        )}`,
        sessionId: event.session_id,
      };
    case 'device_error':
      return {
        kind: 'event',
        label: 'event:error',
        detail: `code=${event.code}`,
        sessionId: event.session_id,
      };
  }
}

export function bleStateLogEntry(
  label: string,
  detail: string,
  sessionId: string | null = null
): BleVerificationLogInput {
  return {
    kind: 'state',
    label,
    detail,
    sessionId,
  };
}

function nullableNumber(value: number | null) {
  return value === null ? '-' : String(value);
}

function nextLogEntryId(entries: BleVerificationLogEntry[], idBase: string) {
  let id = idBase;
  let suffix = 1;

  while (entries.some((entry) => entry.id === id)) {
    id = `${idBase}:${suffix}`;
    suffix += 1;
  }

  return id;
}
