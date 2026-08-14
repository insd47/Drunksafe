export const protocolVersion = 9;

export type Source = 'board_button' | 'phone';

export type MeasurementKind = 'measurement' | 'baseline';

export type StatusKind =
  | 'idle'
  | 'connected'
  | 'measuring'
  | 'awaiting_pulse'
  | 'result_ready'
  | 'error';

export type ErrorCode = 'alcohol_sensor' | 'measurement_timeout' | 'cancelled';

export type PpgSampleBatch = {
  v: number;
  session_id: string;
  /** elapsed_ms of the first sample */
  t0_ms: number;
  /** approximate ms between consecutive samples (e.g. 10 for 100 Hz) */
  dt_ms: number;
  /** raw 12-bit ADC values */
  samples: number[];
};

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

export type PulseUnavailableReason = 'no_signal' | 'unstable';

export type PulseResult =
  | { status: 'measured'; bpm: number; stable: boolean }
  | { status: 'unavailable'; reason: PulseUnavailableReason };

export type MeasurementResult = {
  v: number;
  session_id: string;
  kind: MeasurementKind;
  alcohol_mg_l_x1000: number;
  pulse: PulseResult;
};

export type DeviceError = {
  v: number;
  session_id: string | null;
  code: ErrorCode;
};

export type AlcoholStateLabel =
  | 'idle'
  | 'preheating'
  | 'wait_blow'
  | 'blowing'
  | 'blow_interrupted'
  | 'calculating'
  | 'read_result'
  | 'unknown';

/** 알코올 측정 중 ZE29A 실시간 상태 — "지금 부세요" 타이밍 안내용. */
export type AlcoholState = {
  v: number;
  session_id: string;
  state: AlcoholStateLabel;
};

/** 실시간 pulse 진단 스트리밍(개발자 도구) 중 주기적으로 받는 즉석 분석 값. */
export type PulseReading = {
  v: number;
  session_id: string;
  /** pulse 스트림 세션 시작 이후 흐른 시간(ms) */
  elapsed_ms: number;
  /** 현재 window에서 계산한 BPM. peak가 2개 미만이면 0 */
  bpm: number;
  ibi_stddev_ms: number;
  peak_count: number;
  stable: boolean;
};

export type SessionStateLabel = 'dormant' | 'probe' | 'track';

export type SessionRecordKind = 'state' | 'alcohol' | 'heart' | 'drink_confirmed';

/** 세션 진행 상태 (연결돼 있을 때 주기적으로 수신). */
export type SessionStatus = {
  v: number;
  session_id: string;
  state: SessionStateLabel;
  elapsed_ms: number;
  records: number;
  r0_bpm: number | null;
  last_bpm: number | null;
};

/** 세션 종료 시 다운로드되는 로그 한 건. 값은 kind에 따라 채워진다. */
export type SessionRecord = {
  v: number;
  session_id: string;
  index: number;
  total: number;
  /** 세션 시작 이후 경과 시간(ms) */
  t_ms: number;
  kind: SessionRecordKind;
  state: SessionStateLabel | null;
  mg_l_x1000: number | null;
  bpm: number | null;
};

export type SessionComplete = {
  v: number;
  session_id: string;
  total: number;
};

export type PhoneCommand =
  | { cmd: 'start'; kind: MeasurementKind }
  | { cmd: 'cancel'; session_id: string }
  | { cmd: 'start_pulse_phase'; session_id: string }
  | { cmd: 'start_pulse_stream'; stream_raw: boolean }
  | { cmd: 'stop_pulse_stream' }
  | { cmd: 'start_session'; resting_bpm: number | null }
  | { cmd: 'start_alcohol_track' }
  | { cmd: 'end_session' };

export type DeviceEvent =
  | ({ event: 'status' } & DeviceStatus)
  | ({ event: 'measurement_started' } & MeasurementStarted)
  | ({ event: 'measurement_result' } & MeasurementResult)
  | ({ event: 'device_error' } & DeviceError)
  | ({ event: 'alcohol_state' } & AlcoholState)
  | ({ event: 'ppg_sample' } & PpgSampleBatch)
  | ({ event: 'pulse_reading' } & PulseReading)
  | ({ event: 'session_status' } & SessionStatus)
  | ({ event: 'session_record' } & SessionRecord)
  | ({ event: 'session_complete' } & SessionComplete);

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
    case 'alcohol_state':
      return isAlcoholState(value);
    case 'ppg_sample':
      return isPpgSampleBatch(value);
    case 'pulse_reading':
      return isPulseReading(value);
    case 'session_status':
      return isSessionStatus(value);
    case 'session_record':
      return isSessionRecord(value);
    case 'session_complete':
      return isSessionComplete(value);
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
    isPulseResult(value.pulse)
  );
}

function isDeviceError(value: Record<string, unknown>): value is DeviceEvent {
  return hasProtocolVersion(value) && isNullableString(value.session_id) && isErrorCode(value.code);
}

function isAlcoholState(value: Record<string, unknown>): value is DeviceEvent {
  return (
    hasProtocolVersion(value) &&
    isString(value.session_id) &&
    isAlcoholStateLabel(value.state)
  );
}

function isAlcoholStateLabel(value: unknown): value is AlcoholStateLabel {
  return (
    value === 'idle' ||
    value === 'preheating' ||
    value === 'wait_blow' ||
    value === 'blowing' ||
    value === 'blow_interrupted' ||
    value === 'calculating' ||
    value === 'read_result' ||
    value === 'unknown'
  );
}

function isPpgSampleBatch(value: Record<string, unknown>): value is DeviceEvent {
  return (
    hasProtocolVersion(value) &&
    isString(value.session_id) &&
    isU32(value.t0_ms) &&
    isU16(value.dt_ms) &&
    isPpgSamplesArray(value.samples)
  );
}

function isPulseReading(value: Record<string, unknown>): value is DeviceEvent {
  return (
    hasProtocolVersion(value) &&
    isString(value.session_id) &&
    isU32(value.elapsed_ms) &&
    isFiniteNumber(value.bpm) &&
    isFiniteNumber(value.ibi_stddev_ms) &&
    isU16(value.peak_count) &&
    typeof value.stable === 'boolean'
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSessionStateLabel(value: unknown): value is SessionStateLabel {
  return value === 'dormant' || value === 'probe' || value === 'track';
}

function isSessionRecordKind(value: unknown): value is SessionRecordKind {
  return (
    value === 'state' ||
    value === 'alcohol' ||
    value === 'heart' ||
    value === 'drink_confirmed'
  );
}

function isNullableU16(value: unknown): value is number | null {
  return value === null || isU16(value);
}

function isSessionStatus(value: Record<string, unknown>): value is DeviceEvent {
  return (
    hasProtocolVersion(value) &&
    isString(value.session_id) &&
    isSessionStateLabel(value.state) &&
    isU32(value.elapsed_ms) &&
    isU16(value.records) &&
    isNullableU16(value.r0_bpm) &&
    isNullableU16(value.last_bpm)
  );
}

function isSessionRecord(value: Record<string, unknown>): value is DeviceEvent {
  return (
    hasProtocolVersion(value) &&
    isString(value.session_id) &&
    isU16(value.index) &&
    isU16(value.total) &&
    isU32(value.t_ms) &&
    isSessionRecordKind(value.kind) &&
    (value.state === null || isSessionStateLabel(value.state)) &&
    isNullableU16(value.mg_l_x1000) &&
    isNullableU16(value.bpm)
  );
}

function isSessionComplete(value: Record<string, unknown>): value is DeviceEvent {
  return hasProtocolVersion(value) && isString(value.session_id) && isU16(value.total);
}

function isU32(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4294967295;
}

function isPpgSamplesArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every(isU16);
}

function hasProtocolVersion(value: Record<string, unknown>) {
  return value.v === protocolVersion;
}

function isPulseResult(value: unknown): value is PulseResult {
  if (!isRecord(value)) {
    return false;
  }

  switch (value.status) {
    case 'measured':
      return isU16(value.bpm) && typeof value.stable === 'boolean';
    case 'unavailable':
      return isPulseUnavailableReason(value.reason);
    default:
      return false;
  }
}

function isPulseUnavailableReason(value: unknown): value is PulseUnavailableReason {
  return value === 'no_signal' || value === 'unstable';
}

function isPhoneCommand(value: unknown): value is PhoneCommand {
  if (!isRecord(value)) {
    return false;
  }

  switch (value.cmd) {
    case 'start':
      return isMeasurementKind(value.kind);
    case 'cancel':
    case 'start_pulse_phase':
      return isString(value.session_id);
    case 'start_pulse_stream':
      return typeof value.stream_raw === 'boolean';
    case 'start_session':
      return value.resting_bpm === null || isU16(value.resting_bpm);
    case 'stop_pulse_stream':
    case 'start_alcohol_track':
    case 'end_session':
      return true;
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
    value === 'awaiting_pulse' ||
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
