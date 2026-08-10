export const protocolVersion = 8;

export type Source = 'board_button' | 'phone';

export type MeasurementKind = 'measurement' | 'baseline';

export type StatusKind = 'idle' | 'connected' | 'measuring' | 'result_ready' | 'error';

export type ErrorCode = 'alcohol_sensor' | 'measurement_timeout' | 'cancelled';

export type DeviceStatus = {
  v: number;
  status: StatusKind;
  active_session_id: string | null;
};

export type MeasurementStarted = {
  v: number;
  session_id: string;
  source: Source;
  kind: MeasurementKind;
};

export type Pulse = {
  bpm: number;
  stable: boolean;
};

export type MeasurementResult = {
  v: number;
  session_id: string;
  kind: MeasurementKind;
  alcohol_mg_l_x1000: number;
  pulse: Pulse | null;
};

export type DeviceError = {
  v: number;
  session_id: string | null;
  code: ErrorCode;
};

export type PhoneCommand =
  | { cmd: 'start'; kind: MeasurementKind }
  | { cmd: 'cancel'; session_id: string };

export type DeviceEvent =
  | ({ event: 'status' } & DeviceStatus)
  | ({ event: 'measurement_started' } & MeasurementStarted)
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
    isNullableString(value.active_session_id)
  );
}

function isMeasurementStarted(value: Record<string, unknown>): value is DeviceEvent {
  return (
    hasProtocolVersion(value) &&
    isString(value.session_id) &&
    isSource(value.source) &&
    isMeasurementKind(value.kind)
  );
}

function isMeasurementResult(value: Record<string, unknown>): value is DeviceEvent {
  return (
    hasProtocolVersion(value) &&
    isString(value.session_id) &&
    isMeasurementKind(value.kind) &&
    isU16(value.alcohol_mg_l_x1000) &&
    isNullablePulse(value.pulse)
  );
}

function isDeviceError(value: Record<string, unknown>): value is DeviceEvent {
  return hasProtocolVersion(value) && isNullableString(value.session_id) && isErrorCode(value.code);
}

function hasProtocolVersion(value: Record<string, unknown>) {
  return value.v === protocolVersion;
}

function isNullablePulse(value: unknown): value is Pulse | null {
  if (value === null) {
    return true;
  }

  return isRecord(value) && isU16(value.bpm) && typeof value.stable === 'boolean';
}

function isPhoneCommand(value: unknown): value is PhoneCommand {
  if (!isRecord(value)) {
    return false;
  }

  switch (value.cmd) {
    case 'start':
      return isMeasurementKind(value.kind);
    case 'cancel':
      return isString(value.session_id);
    default:
      return false;
  }
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

function isErrorCode(value: unknown): value is ErrorCode {
  return value === 'alcohol_sensor' || value === 'measurement_timeout' || value === 'cancelled';
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isU16(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 65535;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
