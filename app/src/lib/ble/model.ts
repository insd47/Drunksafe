export const protocolVersion = 7;

export type Source = 'board_button' | 'phone';

export type MeasurementKind = 'measurement' | 'baseline';

export type StatusKind =
  | 'idle'
  | 'connected'
  | 'measuring'
  | 'result_ready'
  | 'error';

export type MeasurementStep =
  | 'preparing'
  | 'warming_sensor'
  | 'waiting_breath'
  | 'sampling_breath'
  | 'sampling_pulse'
  | 'analyzing'
  | 'done';

export type Risk = 'safe' | 'caution' | 'danger';

export type ErrorCode =
  | 'context_timeout'
  | 'alcohol_sensor'
  | 'measurement_timeout'
  | 'cancelled';

export type DeviceStatus = {
  v: number;
  status: StatusKind;
  active_session_id: string | null;
  battery_percent: number | null;
  firmware_version: string | null;
};

export type MeasurementStarted = {
  v: number;
  session_id: string;
  source: Source;
  kind: MeasurementKind;
  history_limit: number;
  needs_context: boolean;
  sync_time: boolean;
};

export type HistoryEntry = {
  measured_at_unix_ms: number;
  alcohol_mg_l_x1000: number;
  bac_milli_percent: number | null;
  risk: Risk;
  confidence_percent: number;
};

export type PhoneContext = {
  v: number;
  session_id: string;
  phone_time_unix_ms: number | null;
  recent: HistoryEntry[];
  sober_alcohol_mg_l_x1000: number | null;
  sober_alcohol_mad_mg_l_x1000: number | null;
  elimination_mg_l_per_hour_x1000: number | null;
  resting_bpm: number | null;
};

export type MeasurementProgress = {
  v: number;
  session_id: string;
  step: MeasurementStep;
  percent: number;
};

export type Alcohol = {
  mg_l_x1000: number;
};

export type Pulse = {
  bpm: number;
  stable: boolean;
  confidence_percent: number;
};

export type MeasurementResult = {
  v: number;
  session_id: string;
  kind: MeasurementKind;
  measured_at_unix_ms: number | null;
  alcohol: Alcohol;
  pulse: Pulse | null;
  bac_milli_percent: number | null;
  bac_upper_milli_percent: number | null;
  sober_time_minutes: number | null;
  risk: Risk;
  confidence_percent: number;
};

export type DeviceError = {
  v: number;
  session_id: string | null;
  code: ErrorCode;
};

export type PhoneCommand =
  | { cmd: 'start'; kind: MeasurementKind }
  | ({ cmd: 'context' } & PhoneContext)
  | { cmd: 'cancel'; session_id: string }
  | { cmd: 'time'; unix_time_ms: number }
  | { cmd: 'ack'; session_id: string };

export type DeviceEvent =
  | ({ event: 'status' } & DeviceStatus)
  | ({ event: 'measurement_started' } & MeasurementStarted)
  | ({ event: 'measurement_progress' } & MeasurementProgress)
  | ({ event: 'measurement_result' } & MeasurementResult)
  | ({ event: 'device_error' } & DeviceError);

export function toPhoneCommandPayload(command: PhoneCommand) {
  if (!isPhoneCommand(command)) {
    throw new Error('Invalid Drunksafe BLE command payload');
  }

  return JSON.stringify(command);
}

export function parseDeviceEvent(payload: string) {
  const value: unknown = JSON.parse(payload);

  if (!isDeviceEvent(value)) {
    throw new Error('Invalid Drunksafe BLE event payload');
  }

  return value;
}

function isDeviceEvent(value: unknown): value is DeviceEvent {
  if (!isRecord(value)) {
    return false;
  }

  switch (value.event) {
    case 'status':
      return isDeviceStatus(value);
    case 'measurement_started':
      return isMeasurementStarted(value);
    case 'measurement_progress':
      return isMeasurementProgress(value);
    case 'measurement_result':
      return isMeasurementResult(value);
    case 'device_error':
      return isDeviceError(value);
    default:
      return false;
  }
}

function isDeviceStatus(value: Record<string, unknown>): value is DeviceEvent {
  return (
    hasProtocolVersion(value) &&
    isStatusKind(value.status) &&
    isNullableString(value.active_session_id) &&
    isNullablePercent(value.battery_percent) &&
    isNullableString(value.firmware_version)
  );
}

function isMeasurementStarted(value: Record<string, unknown>): value is DeviceEvent {
  return (
    hasProtocolVersion(value) &&
    isString(value.session_id) &&
    isSource(value.source) &&
    isMeasurementKind(value.kind) &&
    isU8(value.history_limit) &&
    typeof value.needs_context === 'boolean' &&
    typeof value.sync_time === 'boolean'
  );
}

function isMeasurementProgress(value: Record<string, unknown>): value is DeviceEvent {
  return (
    hasProtocolVersion(value) &&
    isString(value.session_id) &&
    isMeasurementStep(value.step) &&
    isPercent(value.percent)
  );
}

function isMeasurementResult(value: Record<string, unknown>): value is DeviceEvent {
  return (
    hasProtocolVersion(value) &&
    isString(value.session_id) &&
    isMeasurementKind(value.kind) &&
    isNullableU64(value.measured_at_unix_ms) &&
    isAlcohol(value.alcohol) &&
    isNullablePulse(value.pulse) &&
    isNullableU16(value.bac_milli_percent) &&
    isNullableU16(value.bac_upper_milli_percent) &&
    isNullableU16(value.sober_time_minutes) &&
    isRisk(value.risk) &&
    isPercent(value.confidence_percent)
  );
}

function isDeviceError(value: Record<string, unknown>): value is DeviceEvent {
  return hasProtocolVersion(value) && isNullableString(value.session_id) && isErrorCode(value.code);
}

function hasProtocolVersion(value: Record<string, unknown>) {
  return value.v === protocolVersion;
}

function isAlcohol(value: unknown): value is Alcohol {
  return isRecord(value) && isU16(value.mg_l_x1000);
}

function isNullablePulse(value: unknown): value is Pulse | null {
  if (value === null) {
    return true;
  }

  return (
    isRecord(value) &&
    isFiniteNumber(value.bpm) &&
    typeof value.stable === 'boolean' &&
    isPercent(value.confidence_percent)
  );
}

function isPhoneCommand(value: unknown): value is PhoneCommand {
  if (!isRecord(value)) {
    return false;
  }

  switch (value.cmd) {
    case 'start':
      return isMeasurementKind(value.kind);
    case 'context':
      return isPhoneContext(value);
    case 'cancel':
    case 'ack':
      return isString(value.session_id);
    case 'time':
      return isU64(value.unix_time_ms);
    default:
      return false;
  }
}

function isPhoneContext(
  value: Record<string, unknown>
): value is { cmd: 'context' } & PhoneContext {
  return (
    hasProtocolVersion(value) &&
    isString(value.session_id) &&
    isNullableU64(value.phone_time_unix_ms) &&
    Array.isArray(value.recent) &&
    value.recent.every(isHistoryEntry) &&
    isNullableU16(value.sober_alcohol_mg_l_x1000) &&
    isNullableU16(value.sober_alcohol_mad_mg_l_x1000) &&
    isNullableU16(value.elimination_mg_l_per_hour_x1000) &&
    isNullableU16(value.resting_bpm)
  );
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  return (
    isRecord(value) &&
    isU64(value.measured_at_unix_ms) &&
    isU16(value.alcohol_mg_l_x1000) &&
    isNullableU16(value.bac_milli_percent) &&
    isRisk(value.risk) &&
    isPercent(value.confidence_percent)
  );
}

function isSource(value: unknown): value is Source {
  return value === 'board_button' || value === 'phone';
}

function isMeasurementKind(value: unknown): value is MeasurementKind {
  return value === 'measurement' || value === 'baseline';
}

function isStatusKind(value: unknown): value is StatusKind {
  return (
    value === 'idle' ||
    value === 'connected' ||
    value === 'measuring' ||
    value === 'result_ready' ||
    value === 'error'
  );
}

function isMeasurementStep(value: unknown): value is MeasurementStep {
  return (
    value === 'preparing' ||
    value === 'warming_sensor' ||
    value === 'waiting_breath' ||
    value === 'sampling_breath' ||
    value === 'sampling_pulse' ||
    value === 'analyzing' ||
    value === 'done'
  );
}

function isRisk(value: unknown): value is Risk {
  return value === 'safe' || value === 'caution' || value === 'danger';
}

function isErrorCode(value: unknown): value is ErrorCode {
  return (
    value === 'context_timeout' ||
    value === 'alcohol_sensor' ||
    value === 'measurement_timeout' ||
    value === 'cancelled'
  );
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isU8(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255;
}

function isU16(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 65535;
}

function isU64(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPercent(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isNullableU16(value: unknown): value is number | null {
  return value === null || isU16(value);
}

function isNullableU64(value: unknown): value is number | null {
  return value === null || isU64(value);
}

function isNullablePercent(value: unknown): value is number | null {
  return value === null || isPercent(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
