import type { DeviceEvent, PhoneCommand, PulseResult } from '@/lib/ble/model';

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
    case 'cancel':
      return {
        kind: 'command',
        label: 'cmd:cancel',
        detail: 'phone requested cancel',
        sessionId: command.session_id,
      };
    case 'start_pulse_phase':
      return {
        kind: 'command',
        label: 'cmd:pulse_phase',
        detail: 'phone requested pulse phase',
        sessionId: command.session_id,
      };
    case 'start_pulse_stream':
      return {
        kind: 'command',
        label: 'cmd:pulse_stream_start',
        detail: `stream_raw=${command.stream_raw}`,
        sessionId: null,
      };
    case 'stop_pulse_stream':
      return {
        kind: 'command',
        label: 'cmd:pulse_stream_stop',
        detail: 'phone stopped pulse stream',
        sessionId: null,
      };
    case 'start_session':
    case 'start_hr_watch':
      return {
        kind: 'command',
        label: command.cmd === 'start_hr_watch' ? 'cmd:hr_watch_start' : 'cmd:session_start',
        detail: `resting_bpm=${command.resting_bpm ?? '-'}`,
        sessionId: null,
      };
    case 'start_alcohol_track':
      return {
        kind: 'command',
        label: 'cmd:alcohol_track',
        detail: 'phone started alcohol track',
        sessionId: null,
      };
    case 'measure_session_alcohol':
      return {
        kind: 'command',
        label: 'cmd:session_alcohol',
        detail: 'phone requested session alcohol measurement',
        sessionId: null,
      };
    case 'end_session':
      return {
        kind: 'command',
        label: 'cmd:session_end',
        detail: 'phone ended session',
        sessionId: null,
      };
    case 'warn':
      return {
        kind: 'command',
        label: 'cmd:warn',
        detail: 'phone triggered device buzzer',
        sessionId: null,
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
        detail: `kind=${event.kind} source=${event.source}`,
        sessionId: event.session_id,
      };
    case 'measurement_result':
      return {
        kind: 'event',
        label: 'event:result',
        detail: `alcohol=${event.alcohol_mg_l_x1000} pulse=${pulseLogDetail(event.pulse)}`,
        sessionId: event.session_id,
      };
    case 'device_error':
      return {
        kind: 'event',
        label: 'event:error',
        detail: `code=${event.code}`,
        sessionId: event.session_id,
      };
    case 'alcohol_state':
      return {
        kind: 'event',
        label: 'event:alcohol_state',
        detail: `state=${event.state}`,
        sessionId: event.session_id,
      };
    case 'ppg_sample':
      return {
        kind: 'event',
        label: 'event:ppg_sample',
        detail: `samples=${event.samples.length} t0_ms=${event.t0_ms}`,
        sessionId: event.session_id,
      };
    case 'pulse_reading':
      return {
        kind: 'event',
        label: 'event:pulse_reading',
        detail: `bpm=${event.bpm} peaks=${event.peak_count} stable=${event.stable}`,
        sessionId: event.session_id,
      };
    case 'session_status':
      return {
        kind: 'event',
        label: 'event:session_status',
        detail: `state=${event.state} elapsed=${event.elapsed_ms} n=${event.records}`,
        sessionId: event.session_id,
      };
    case 'session_record':
      return {
        kind: 'event',
        label: 'event:session_record',
        detail: `${event.index + 1}/${event.total} ${event.kind}`,
        sessionId: event.session_id,
      };
    case 'session_complete':
      return {
        kind: 'event',
        label: 'event:session_complete',
        detail: `total=${event.total}`,
        sessionId: event.session_id,
      };
    case 'session_alcohol_result':
      return {
        kind: 'event',
        label: 'event:session_alcohol_result',
        detail: `trigger=${event.trigger_percent ?? 'manual'} alcohol=${event.alcohol_mg_l_x1000 ?? 'failed'}`,
        sessionId: event.session_id,
      };
  }
}

function pulseLogDetail(pulse: PulseResult) {
  return pulse.status === 'measured' ? `${pulse.bpm}` : `unavailable:${pulse.reason}`;
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

function nextLogEntryId(entries: BleVerificationLogEntry[], idBase: string) {
  let id = idBase;
  let suffix = 1;

  while (entries.some((entry) => entry.id === id)) {
    id = `${idBase}:${suffix}`;
    suffix += 1;
  }

  return id;
}
