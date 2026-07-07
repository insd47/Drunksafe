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

export type BleVerificationEvidenceSummary = {
  notifyReadyAtUnixMs: number | null;
  baselineSessionId: string | null;
  measurementSessionId: string | null;
  boardButtonSessionId: string | null;
  resultSessionId: string | null;
  ackSessionId: string | null;
  cancelSessionId: string | null;
  cancelCommandAtUnixMs: number | null;
  cancelErrorSessionId: string | null;
  cancelLatencyMs: number | null;
};

export const emptyBleVerificationEvidenceSummary: BleVerificationEvidenceSummary = {
  notifyReadyAtUnixMs: null,
  baselineSessionId: null,
  measurementSessionId: null,
  boardButtonSessionId: null,
  resultSessionId: null,
  ackSessionId: null,
  cancelSessionId: null,
  cancelCommandAtUnixMs: null,
  cancelErrorSessionId: null,
  cancelLatencyMs: null,
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

export function updateBleVerificationEvidenceWithCommand(
  summary: BleVerificationEvidenceSummary,
  command: PhoneCommand,
  atUnixMs: number
): BleVerificationEvidenceSummary {
  switch (command.cmd) {
    case 'cancel':
      return {
        ...summary,
        cancelSessionId: command.session_id,
        cancelCommandAtUnixMs: atUnixMs,
        cancelErrorSessionId: null,
        cancelLatencyMs: null,
      };
    case 'ack':
      return {
        ...summary,
        ackSessionId: command.session_id,
      };
    default:
      return summary;
  }
}

export function updateBleVerificationEvidenceWithEvent(
  summary: BleVerificationEvidenceSummary,
  event: DeviceEvent,
  atUnixMs: number
): BleVerificationEvidenceSummary {
  switch (event.event) {
    case 'measurement_started':
      return {
        ...summary,
        baselineSessionId: event.kind === 'baseline' ? event.session_id : summary.baselineSessionId,
        measurementSessionId:
          event.kind === 'measurement' ? event.session_id : summary.measurementSessionId,
        boardButtonSessionId:
          event.source === 'board_button' ? event.session_id : summary.boardButtonSessionId,
      };
    case 'measurement_result':
      return {
        ...summary,
        resultSessionId: event.session_id,
      };
    case 'device_error':
      if (
        event.code === 'cancelled' &&
        event.session_id &&
        summary.cancelCommandAtUnixMs !== null &&
        summary.cancelSessionId === event.session_id
      ) {
        return {
          ...summary,
          cancelErrorSessionId: event.session_id,
          cancelLatencyMs: Math.max(0, atUnixMs - summary.cancelCommandAtUnixMs),
        };
      }

      return summary;
    default:
      return summary;
  }
}

export function updateBleVerificationEvidenceWithState(
  summary: BleVerificationEvidenceSummary,
  input: BleVerificationLogInput,
  atUnixMs: number
): BleVerificationEvidenceSummary {
  if (input.label !== 'state:notify-ready') {
    return summary;
  }

  return {
    ...summary,
    notifyReadyAtUnixMs: atUnixMs,
  };
}

export function isBleVerificationAckCorrelated(summary: BleVerificationEvidenceSummary) {
  return Boolean(summary.resultSessionId && summary.ackSessionId === summary.resultSessionId);
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
