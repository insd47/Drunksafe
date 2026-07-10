import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { decodeUtf8Base64, encodeUtf8Base64, utf8ByteLength } from '@/lib/ble/codec';
import { parseDeviceEvent, protocolVersion, toPhoneCommandPayload } from '@/lib/ble/model';
import {
  DeviceEventFrameAssembler,
  maxBleTransportChunks,
  maxPendingDeviceEventFrames,
  minimumChunkedBlePayloadBytes,
  serializePhoneCommandFrames,
} from '@/lib/ble/transport';
import { drunksafeBle } from '@/lib/ble/uuids';

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoDir = dirname(appDir);
const contract = JSON.parse(
  readFileSync(join(repoDir, '.docs', 'ble-contract-fixtures.json'), 'utf8')
);
const firmwareModelSource = readFileSync(
  join(repoDir, 'firmware', 'src', 'services', 'ble', 'model.rs'),
  'utf8'
);
const firmwareTransportSource = readFileSync(
  join(repoDir, 'firmware', 'src', 'services', 'ble', 'transport.rs'),
  'utf8'
);
const firmwareGattSource = readFileSync(
  join(repoDir, 'firmware', 'src', 'services', 'ble', 'gatt.rs'),
  'utf8'
);
const firmwareBleModSource = readFileSync(
  join(repoDir, 'firmware', 'src', 'services', 'ble', 'mod.rs'),
  'utf8'
);
const firmwareBleSessionSource = readFileSync(
  join(repoDir, 'firmware', 'src', 'services', 'ble', 'session.rs'),
  'utf8'
);
const firmwareMainSource = readFileSync(join(repoDir, 'firmware', 'src', 'main.rs'), 'utf8');
const firmwareMeasureModSource = readFileSync(
  join(repoDir, 'firmware', 'src', 'services', 'measure', 'mod.rs'),
  'utf8'
);
const firmwareMeasureMeasurementSource = readFileSync(
  join(repoDir, 'firmware', 'src', 'services', 'measure', 'measurement.rs'),
  'utf8'
);
const firmwareMeasureRunSource = readFileSync(
  join(repoDir, 'firmware', 'src', 'services', 'measure', 'run.rs'),
  'utf8'
);
const firmwareBleAnalysisSource = readFileSync(
  join(repoDir, 'firmware', 'src', 'services', 'ble', 'analysis.rs'),
  'utf8'
);
const firmwareScreenRenderSource = readFileSync(
  join(repoDir, 'firmware', 'src', 'services', 'screen', 'render.rs'),
  'utf8'
);
const firmwareAlcoholSource = readFileSync(
  join(repoDir, 'firmware', 'src', 'devices', 'alcohol', 'mod.rs'),
  'utf8'
);
const firmwareAlcoholChannelSource = readFileSync(
  join(repoDir, 'firmware', 'src', 'devices', 'alcohol', 'channel.rs'),
  'utf8'
);
const appBleClientSource = readFileSync(join(appDir, 'src', 'lib', 'ble', 'client.ts'), 'utf8');

test('app BLE protocol version and GATT UUIDs match the contract fixture', () => {
  assert.equal(protocolVersion, contract.protocolVersion);
  assert.deepEqual(drunksafeBle, contract.gatt);
});

test('firmware BLE protocol version and GATT constants match the contract fixture', () => {
  assert.equal(
    readRustConstNumber(firmwareModelSource, 'PROTOCOL_VERSION'),
    contract.protocolVersion
  );
  assert.equal(
    uuidFromU128(readRustConstBigInt(firmwareTransportSource, 'SERVICE_UUID')),
    contract.gatt.serviceUuid
  );
  assert.equal(
    uuidFromU128(readRustConstBigInt(firmwareTransportSource, 'DEVICE_EVENT_CHARACTERISTIC_UUID')),
    contract.gatt.deviceEventCharacteristicUuid
  );
  assert.equal(
    uuidFromU128(readRustConstBigInt(firmwareTransportSource, 'PHONE_COMMAND_CHARACTERISTIC_UUID')),
    contract.gatt.phoneCommandCharacteristicUuid
  );
  assert.equal(
    readRustConstString(firmwareTransportSource, 'DEVICE_NAME'),
    contract.gatt.deviceNamePrefix
  );
});

test('firmware serde enum names match the contract fixture', () => {
  assert.deepEqual(readRustEnumSnakeValues(firmwareModelSource, 'Source'), contract.enums.source);
  assert.deepEqual(
    readRustEnumSnakeValues(firmwareModelSource, 'MeasurementKind'),
    contract.enums.measurementKind
  );
  assert.deepEqual(
    readRustEnumSnakeValues(firmwareModelSource, 'StatusKind'),
    contract.enums.statusKind
  );
  assert.deepEqual(
    readRustEnumSnakeValues(firmwareModelSource, 'MeasurementStep'),
    contract.enums.measurementStep
  );
  assert.deepEqual(readRustEnumSnakeValues(firmwareModelSource, 'Risk'), contract.enums.risk);
  assert.deepEqual(
    readRustEnumSnakeValues(firmwareModelSource, 'ErrorCode'),
    contract.enums.errorCode
  );
  assert.deepEqual(
    readRustEnumSnakeValues(firmwareModelSource, 'PhoneCommand'),
    contract.payloadKinds.phoneCommand
  );
  assert.deepEqual(
    readRustEnumSnakeValues(firmwareModelSource, 'DeviceEvent'),
    contract.payloadKinds.deviceEvent
  );
  assert.deepEqual(
    readRustEnumSnakeValues(firmwareTransportSource, 'FrameKind'),
    contract.payloadKinds.transportFrame
  );
  assert.deepEqual(
    readRustStructFields(firmwareTransportSource, 'ChunkFrame'),
    contract.payloadKinds.transportFrameFields
  );
});

test('firmware measurement progress plan covers every app-visible step in order', () => {
  const plan = readRustProgressPlan(firmwareBleModSource, 'MEASUREMENT_PROGRESS_PLAN');

  assert.deepEqual(
    plan.map((item) => item.step),
    contract.enums.measurementStep
  );
  assert.equal(plan[0].percent, 5);
  assert.equal(plan.at(-1).percent, 100);

  for (let index = 1; index < plan.length; index += 1) {
    assert.ok(plan[index].percent > plan[index - 1].percent);
  }
});

test('firmware runtime keeps context wait and final result messages ordered', () => {
  const order = [
    'ble::measurement_started(session_id.clone(), source, kind)',
    'let context = match ble.wait_for_context(&session_id)',
    'notify_progress(&ble, &session_id, MeasurementStep::Preparing)',
    'notify_progress(&ble, &session_id, MeasurementStep::WarmingSensor)',
    'notify_progress(&ble, &session_id, MeasurementStep::WaitingBreath)',
    'notify_progress(&ble, &session_id, MeasurementStep::SamplingBreath)',
    'notify_progress(&ble, &session_id, MeasurementStep::SamplingPulse)',
    'notify_progress(&ble, &session_id, MeasurementStep::Analyzing)',
    'notify_progress(&ble, &session_id, MeasurementStep::Done)',
    'ble::measurement_result(',
    'ble::device_status(StatusKind::ResultReady, Some(session_id))',
  ].map((pattern) => indexOfRequired(firmwareMainSource, pattern));

  for (let index = 1; index < order.length; index += 1) {
    assert.ok(order[index] > order[index - 1]);
  }
});

test('firmware drains phone starts before giving the board button priority', () => {
  const phoneStartIndex = indexOfRequired(firmwareMainSource, 'let phone_start = ble.poll_start()');
  const boardStartIndex = indexOfRequiredAfter(
    firmwareMainSource,
    'if trigger.pressed()',
    phoneStartIndex
  );

  assert.ok(phoneStartIndex < boardStartIndex);
  assert.ok(firmwareMainSource.includes('phone_start.map(|kind| (Source::Phone, kind))'));
});

test('firmware treats context cancellation as a normal return to home', () => {
  const cancelledIndex = indexOfRequired(firmwareMainSource, 'SessionContext::Cancelled =>');
  const cancelledHomeIndex = indexOfRequiredAfter(
    firmwareMainSource,
    'screen.show(View::Home)',
    cancelledIndex
  );
  const timeoutIndex = indexOfRequiredAfter(
    firmwareMainSource,
    'SessionContext::TimedOut =>',
    cancelledHomeIndex
  );
  const timeoutFailureIndex = indexOfRequiredAfter(
    firmwareMainSource,
    'screen.show(View::Failed)',
    timeoutIndex
  );

  assert.ok(cancelledIndex < cancelledHomeIndex);
  assert.ok(cancelledHomeIndex < timeoutIndex);
  assert.ok(timeoutIndex < timeoutFailureIndex);
});

test('firmware sober-time input never falls below the raw alcohol reading', () => {
  assert.match(
    firmwareBleAnalysisSource,
    /let sober_time_alcohol = upper_alcohol\.max\(alcohol_mg_l_x1000\);/
  );
  assert.match(firmwareBleAnalysisSource, /estimate_sober_time_minutes\(\s*sober_time_alcohol,/);
});

test('firmware measurement loop polls cancel while sensors are active', () => {
  const runUntilCancelledIndex = indexOfRequired(
    firmwareMainSource,
    'measure.run_until_cancelled(ble.wait_for_cancel(&session_id))'
  );
  const cancelledBranchIndex = indexOfRequiredAfter(
    firmwareMainSource,
    'Ok(MeasureRun::Cancelled)',
    runUntilCancelledIndex
  );
  const cancelledErrorIndex = indexOfRequiredAfter(
    firmwareMainSource,
    'ble::device_error(Some(session_id.clone()), ErrorCode::Cancelled)',
    cancelledBranchIndex
  );
  const idleStatusIndex = indexOfRequiredAfter(
    firmwareMainSource,
    'ble::device_status(StatusKind::Idle, None)',
    cancelledErrorIndex
  );
  const mainOrder = [
    runUntilCancelledIndex,
    cancelledBranchIndex,
    cancelledErrorIndex,
    idleStatusIndex,
  ];

  for (let index = 1; index < mainOrder.length; index += 1) {
    assert.ok(mainOrder[index] > mainOrder[index - 1]);
  }

  const cancelFutureIndex = indexOfRequired(
    firmwareBleSessionSource,
    'pub(crate) async fn wait_for_cancel'
  );
  const cancelDrainIndex = indexOfRequiredAfter(
    firmwareBleSessionSource,
    'self.cancel_requested(session_id)',
    cancelFutureIndex
  );
  const cancelSleepIndex = indexOfRequiredAfter(
    firmwareBleSessionSource,
    'Timer::after(CANCEL_POLL).await',
    cancelDrainIndex
  );
  assert.ok(cancelFutureIndex < cancelDrainIndex);
  assert.ok(cancelDrainIndex < cancelSleepIndex);

  assert.ok(firmwareMeasureModSource.includes('pub enum MeasureRun'));
  assert.ok(firmwareMeasureModSource.includes('pub async fn run_until_cancelled'));
  assert.ok(firmwareMeasureModSource.includes('join(run::pulse(pulse), run::alcohol(alcohol))'));
  assert.ok(firmwareMeasureModSource.includes('select(self.run(), cancel).await'));
  const cancelSelectIndex = indexOfRequired(firmwareMeasureModSource, 'Either::Second(()) => {');
  const alcoholStopIndex = indexOfRequiredAfter(
    firmwareMeasureModSource,
    'self.alcohol.stop().await?',
    cancelSelectIndex
  );
  const cancelledReturnIndex = indexOfRequiredAfter(
    firmwareMeasureModSource,
    'Ok(MeasureRun::Cancelled)',
    alcoholStopIndex
  );
  assert.ok(cancelSelectIndex < alcoholStopIndex);
  assert.ok(alcoholStopIndex < cancelledReturnIndex);
  assert.equal(firmwareMainSource.includes('cancelled_after_measurement'), false);
  assert.ok(firmwareMeasureRunSource.includes('pub async fn pulse'));
  const alcoholRunIndex = indexOfRequired(firmwareMeasureRunSource, 'pub async fn alcohol');
  const alcoholWakeIndex = indexOfRequiredAfter(
    firmwareMeasureRunSource,
    'device.start().await?',
    alcoholRunIndex
  );
  const alcoholResultIndex = indexOfRequiredAfter(
    firmwareMeasureRunSource,
    'let result = alcohol_result(device).await',
    alcoholWakeIndex
  );
  const alcoholStopAfterRunIndex = indexOfRequiredAfter(
    firmwareMeasureRunSource,
    'device.stop().await',
    alcoholResultIndex
  );
  const alcoholReturnIndex = indexOfRequiredAfter(
    firmwareMeasureRunSource,
    '\n    result\n',
    alcoholStopAfterRunIndex
  );
  const alcoholResultFnIndex = indexOfRequiredAfter(
    firmwareMeasureRunSource,
    'async fn alcohol_result',
    alcoholReturnIndex
  );
  assert.ok(alcoholRunIndex < alcoholWakeIndex);
  assert.ok(alcoholWakeIndex < alcoholResultIndex);
  assert.ok(alcoholResultIndex < alcoholStopAfterRunIndex);
  assert.ok(alcoholStopAfterRunIndex < alcoholReturnIndex);
  assert.ok(alcoholReturnIndex < alcoholResultFnIndex);
  assert.ok(
    firmwareMeasureRunSource.includes('failed to stop alcohol sensor work mode after measurement')
  );
  assert.ok(firmwareAlcoholSource.includes('pub async fn start'));
  assert.ok(firmwareAlcoholSource.includes('pub async fn stop'));
  const preClearIndex = indexOfRequired(firmwareAlcoholSource, 'self.channel.clear().await?');
  const firstStopIndex = indexOfRequiredAfter(
    firmwareAlcoholSource,
    'let Err(first) = self.work(false).await else',
    preClearIndex
  );
  const retryClearIndex = indexOfRequiredAfter(
    firmwareAlcoholSource,
    'self.channel.clear().await?',
    firstStopIndex
  );
  const retryStopIndex = indexOfRequiredAfter(
    firmwareAlcoholSource,
    'self.work(false).await.map_err(|_| first)',
    retryClearIndex
  );
  assert.ok(preClearIndex < firstStopIndex);
  assert.ok(firstStopIndex < retryClearIndex);
  assert.ok(retryClearIndex < retryStopIndex);
  assert.ok(firmwareAlcoholChannelSource.includes('const CLEAR_TIMEOUT'));
  assert.ok(firmwareAlcoholChannelSource.includes('const MAX_CLEAR_BYTES: usize = FRAME_LEN * 4'));
  assert.ok(firmwareAlcoholChannelSource.includes('while cleared < MAX_CLEAR_BYTES'));
  assert.ok(firmwareAlcoholChannelSource.includes('pub async fn clear'));
});

test('firmware alcohol result can complete when pulse is unavailable', () => {
  assert.ok(firmwareMeasureMeasurementSource.includes('pulse_bpm: Option<u16>'));
  assert.ok(
    firmwareMeasureMeasurementSource.includes('pub const fn pulse_bpm(&self) -> Option<u16>')
  );
  assert.ok(firmwareMeasureModSource.includes('let alcohol = alcohol?;'));
  assert.ok(firmwareMeasureModSource.includes('Err(error) => {'));
  assert.ok(firmwareMeasureModSource.includes('continuing with alcohol result'));
  assert.ok(firmwareMeasureModSource.includes('Ok(Measurement::new(alcohol, pulse))'));
  assert.equal(firmwareMeasureModSource.includes('Measurement::new(alcohol?, pulse?)'), false);
  assert.ok(firmwareBleAnalysisSource.includes('pulse: pulse_bpm.map'));
  assert.ok(firmwareScreenRenderSource.includes('format_args!("BPM --")'));
});

test('device event fixtures parse through the app validator', () => {
  for (const event of contract.deviceEvents) {
    assert.deepEqual(parseDeviceEvent(JSON.stringify(event)), event);
  }
});

test('app validator accepts every BLE enum value from the contract fixture', () => {
  for (const status of contract.enums.statusKind) {
    assert.equal(parseDeviceEvent(JSON.stringify(deviceStatus({ status }))).status, status);
  }

  for (const source of contract.enums.source) {
    assert.equal(parseDeviceEvent(JSON.stringify(measurementStarted({ source }))).source, source);
  }

  for (const kind of contract.enums.measurementKind) {
    assert.equal(parseDeviceEvent(JSON.stringify(measurementStarted({ kind }))).kind, kind);
    assert.equal(parseDeviceEvent(JSON.stringify(measurementResult({ kind }))).kind, kind);
  }

  for (const step of contract.enums.measurementStep) {
    assert.equal(parseDeviceEvent(JSON.stringify(measurementProgress({ step }))).step, step);
  }

  for (const risk of contract.enums.risk) {
    assert.equal(parseDeviceEvent(JSON.stringify(measurementResult({ risk }))).risk, risk);
  }

  for (const code of contract.enums.errorCode) {
    assert.equal(parseDeviceEvent(JSON.stringify(deviceError({ code }))).code, code);
  }
});

test('phone command fixtures serialize through the app validator', () => {
  for (const command of contract.phoneCommands) {
    assert.deepEqual(JSON.parse(toPhoneCommandPayload(command)), command);
  }

  for (const kind of contract.enums.measurementKind) {
    const command = { cmd: 'start', kind };
    assert.deepEqual(JSON.parse(toPhoneCommandPayload(command)), command);
  }
});

test('phone context is chunked into bounded BLE command frames', () => {
  const contextCommand = contract.phoneCommands.find((command) => command.cmd === 'context');
  assert.ok(contextCommand);

  const maxPayloadBytes = 120;
  const frames = serializePhoneCommandFrames(contextCommand, maxPayloadBytes);

  assert.ok(frames.length > 1);

  const chunks = frames.map((frame, index) => {
    assert.ok(utf8ByteLength(frame) <= maxPayloadBytes);

    const parsed = JSON.parse(frame);
    assert.equal(parsed.frame, contract.payloadKinds.transportFrame[0]);
    assert.equal(parsed.index, index);
    assert.equal(parsed.count, frames.length);
    assert.equal(typeof parsed.id, 'string');
    assert.equal(typeof parsed.data, 'string');

    return parsed.data;
  });

  assert.deepEqual(JSON.parse(chunks.join('')), contextCommand);
});

test('phone context requires a chunk-capable BLE payload size', () => {
  const contextCommand = contract.phoneCommands.find((command) => command.cmd === 'context');
  assert.ok(contextCommand);

  assert.throws(
    () => serializePhoneCommandFrames(contextCommand, 20),
    /BLE transport chunk count exceeds configured limit/
  );
  assert.throws(
    () => serializePhoneCommandFrames(contextCommand, 97),
    /BLE transport chunk count exceeds configured limit/
  );

  const frames = serializePhoneCommandFrames(contextCommand, minimumChunkedBlePayloadBytes);

  assert.ok(frames.length <= maxBleTransportChunks);

  for (const frame of frames) {
    assert.ok(utf8ByteLength(frame) <= minimumChunkedBlePayloadBytes);
  }
});

test('device event chunk frames reassemble before parsing', () => {
  const resultEvent = contract.deviceEvents.find((event) => event.event === 'measurement_result');
  assert.ok(resultEvent);

  const payload = JSON.stringify(resultEvent);
  const frames = deviceEventChunkFrames(payload, 'fixture-result', 48);
  const assembler = new DeviceEventFrameAssembler();

  assert.equal(assembler.accept(frames[1]), null);
  assert.equal(assembler.accept(frames[0]), null);

  for (const frame of frames.slice(2, -1)) {
    assert.equal(assembler.accept(frame), null);
  }

  const reassembled = assembler.accept(frames.at(-1));
  assert.equal(reassembled, payload);
  assert.deepEqual(parseDeviceEvent(reassembled), resultEvent);
});

test('device event assembler reset drops stale chunks from reused firmware frame ids', () => {
  const oldPayload = JSON.stringify(deviceStatus({ firmware_version: 'old' }));
  const newPayload = JSON.stringify(deviceStatus({ firmware_version: 'new' }));
  const oldFrames = twoDeviceEventChunkFrames(oldPayload, 'fw-1');
  const newFrames = twoDeviceEventChunkFrames(newPayload, 'fw-1');
  const assembler = new DeviceEventFrameAssembler();

  assert.equal(assembler.accept(oldFrames[0]), null);
  assembler.reset();
  assert.equal(assembler.accept(newFrames[1]), null);
  assert.equal(assembler.accept(newFrames[0]), newPayload);
});

test('firmware drops partial phone commands across disconnected clients', () => {
  assert.match(
    firmwareTransportSource,
    /pub fn reset\(&mut self\) \{\s*self\.entries\.clear\(\);\s*\}/
  );
  assert.match(
    firmwareGattSource,
    /if state\.connections\.is_empty\(\) \{\s*state\.phone_transport\.reset\(\);\s*\}/
  );
  assert.match(
    firmwareBleAnalysisSource,
    /context\.and_then\(elimination_rate_mg_l_per_hour_x1000\)/
  );
  assert.match(
    firmwareBleAnalysisSource,
    /if elimination_rate_mg_l_per_hour_x1000\(context\)\.is_some\(\)/
  );
});

test('firmware caps notify payloads to the shared BLE JSON limit', () => {
  assert.match(
    firmwareGattSource,
    /\.unwrap_or\(super::MAX_BLE_JSON_PAYLOAD_BYTES\)\s*\.min\(super::MAX_BLE_JSON_PAYLOAD_BYTES\)/
  );
});

test('device event assembler rejects conflicting duplicate chunks', () => {
  const assembler = new DeviceEventFrameAssembler();
  const first = JSON.stringify({
    frame: 'device_event_chunk',
    id: 'conflict',
    index: 0,
    count: 2,
    data: '{',
  });
  const conflicting = JSON.stringify({
    frame: 'device_event_chunk',
    id: 'conflict',
    index: 0,
    count: 2,
    data: '[',
  });

  assert.equal(assembler.accept(first), null);
  assert.throws(() => assembler.accept(conflicting), /chunk data changed/);
  assert.ok(firmwareTransportSource.includes('TransportError::ChunkDataChanged'));
});

test('device event assembler bounds incomplete frame sessions', () => {
  const assembler = new DeviceEventFrameAssembler();

  for (let index = 0; index <= maxPendingDeviceEventFrames; index += 1) {
    assert.equal(
      assembler.accept(
        JSON.stringify({
          frame: 'device_event_chunk',
          id: `pending-${index}`,
          index: 0,
          count: 2,
          data: `${index}`,
        })
      ),
      null
    );
  }

  const evictedTail = JSON.stringify({
    frame: 'device_event_chunk',
    id: 'pending-0',
    index: 1,
    count: 2,
    data: 'tail',
  });

  assert.equal(assembler.accept(evictedTail), null);
});

test('app BLE client clears assembler state and ignores stale monitor callbacks', () => {
  const monitorIndex = indexOfRequired(appBleClientSource, 'monitorEvents(');
  const generationFieldIndex = indexOfRequired(
    appBleClientSource,
    'private eventMonitorGeneration = 0;'
  );
  const monitorResetIndex = indexOfRequiredAfter(
    appBleClientSource,
    'this.eventAssembler.reset();',
    monitorIndex
  );
  const monitorGenerationIndex = indexOfRequiredAfter(
    appBleClientSource,
    'const eventMonitorGeneration = this.advanceEventMonitorGeneration();',
    monitorResetIndex
  );
  const monitorSubscribeIndex = indexOfRequiredAfter(
    appBleClientSource,
    'this.manager.monitorCharacteristicForDevice(',
    monitorIndex
  );
  const staleGuardIndex = indexOfRequiredAfter(
    appBleClientSource,
    'if (eventMonitorGeneration !== this.eventMonitorGeneration) {',
    monitorSubscribeIndex
  );
  const assemblerAcceptIndex = indexOfRequiredAfter(
    appBleClientSource,
    'this.eventAssembler.accept(',
    staleGuardIndex
  );
  const clearIndex = indexOfRequired(appBleClientSource, 'private clearEventMonitor()');
  const clearGenerationIndex = indexOfRequiredAfter(
    appBleClientSource,
    'this.advanceEventMonitorGeneration();',
    clearIndex
  );
  const clearResetIndex = indexOfRequiredAfter(
    appBleClientSource,
    'this.eventAssembler.reset();',
    clearIndex
  );

  assert.ok(generationFieldIndex < monitorIndex);
  assert.ok(monitorIndex < monitorResetIndex);
  assert.ok(monitorResetIndex < monitorGenerationIndex);
  assert.ok(monitorGenerationIndex < monitorSubscribeIndex);
  assert.ok(monitorSubscribeIndex < staleGuardIndex);
  assert.ok(staleGuardIndex < assemblerAcceptIndex);
  assert.ok(clearIndex < clearGenerationIndex);
  assert.ok(clearGenerationIndex < clearResetIndex);
});

test('BLE base64 codec keeps JSON payload bytes stable at the API boundary', () => {
  const payload = JSON.stringify({
    event: 'measurement_started',
    note: '한글 UTF-8 payload',
  });
  assert.equal(decodeUtf8Base64(encodeUtf8Base64(payload)), payload);
});

function deviceStatus(overrides = {}) {
  return {
    event: 'status',
    v: contract.protocolVersion,
    status: 'connected',
    active_session_id: null,
    battery_percent: null,
    firmware_version: '0.1.0',
    ...overrides,
  };
}

function measurementStarted(overrides = {}) {
  return {
    event: 'measurement_started',
    v: contract.protocolVersion,
    session_id: 'enum-fixture',
    source: 'phone',
    kind: 'measurement',
    history_limit: 8,
    needs_context: true,
    sync_time: true,
    ...overrides,
  };
}

function measurementProgress(overrides = {}) {
  return {
    event: 'measurement_progress',
    v: contract.protocolVersion,
    session_id: 'enum-fixture',
    step: 'preparing',
    percent: 1,
    ...overrides,
  };
}

function measurementResult(overrides = {}) {
  return {
    event: 'measurement_result',
    v: contract.protocolVersion,
    session_id: 'enum-fixture',
    kind: 'measurement',
    measured_at_unix_ms: null,
    alcohol: {
      mg_l_x1000: 0,
    },
    pulse: null,
    bac_milli_percent: null,
    bac_upper_milli_percent: null,
    sober_time_minutes: null,
    risk: 'safe',
    confidence_percent: 80,
    ...overrides,
  };
}

function deviceError(overrides = {}) {
  return {
    event: 'device_error',
    v: contract.protocolVersion,
    session_id: 'enum-fixture',
    code: 'protocol',
    ...overrides,
  };
}

function readRustConstNumber(source, name) {
  const value = readRustConstValue(source, name);
  return Number.parseInt(value, 10);
}

function readRustConstBigInt(source, name) {
  return BigInt(readRustConstValue(source, name));
}

function readRustConstString(source, name) {
  const value = readRustConstValue(source, name);
  const match = /^"([^"]*)"$/.exec(value);

  if (!match) {
    throw new Error(`Rust const ${name} is not a string literal`);
  }

  return match[1];
}

function readRustConstValue(source, name) {
  const match = new RegExp(`pub const ${name}: [^=]+ = ([^;]+);`).exec(source);

  if (!match) {
    throw new Error(`Rust const ${name} was not found`);
  }

  return match[1].trim();
}

function indexOfRequired(source, pattern) {
  const index = source.indexOf(pattern);

  if (index < 0) {
    throw new Error(`Pattern was not found: ${pattern}`);
  }

  return index;
}

function indexOfRequiredAfter(source, pattern, afterIndex) {
  const index = source.indexOf(pattern, afterIndex);

  if (index < 0) {
    throw new Error(`Pattern was not found after ${afterIndex}: ${pattern}`);
  }

  return index;
}

function readRustEnumSnakeValues(source, enumName) {
  const enumBody = readRustEnumBody(source, enumName);
  const variants = [];
  const variantPattern = /^ {4}([A-Z][A-Za-z0-9_]*)\b/gm;
  let match;

  while ((match = variantPattern.exec(enumBody))) {
    variants.push(toSnakeCase(match[1]));
  }

  if (variants.length === 0) {
    throw new Error(`Rust enum ${enumName} has no readable variants`);
  }

  return variants;
}

function readRustProgressPlan(source, name) {
  const planStart = source.indexOf(`pub const ${name}:`);

  if (planStart < 0) {
    throw new Error(`Rust progress plan ${name} was not found`);
  }

  const planEnd = source.indexOf('];', planStart);

  if (planEnd < 0) {
    throw new Error(`Rust progress plan ${name} is not closed`);
  }

  const body = source.slice(planStart, planEnd);
  const items = [];
  const itemPattern = /\(MeasurementStep::([A-Z][A-Za-z0-9_]*),\s*(\d+)\)/g;
  let match;

  while ((match = itemPattern.exec(body))) {
    items.push({
      step: toSnakeCase(match[1]),
      percent: Number.parseInt(match[2], 10),
    });
  }

  if (items.length === 0) {
    throw new Error(`Rust progress plan ${name} has no readable items`);
  }

  return items;
}

function readRustEnumBody(source, enumName) {
  const enumStart = source.indexOf(`enum ${enumName}`);

  if (enumStart < 0) {
    throw new Error(`Rust enum ${enumName} was not found`);
  }

  const openBrace = source.indexOf('{', enumStart);

  if (openBrace < 0) {
    throw new Error(`Rust enum ${enumName} has no body`);
  }

  let depth = 0;

  for (let index = openBrace; index < source.length; index += 1) {
    if (source[index] === '{') {
      depth += 1;
    } else if (source[index] === '}') {
      depth -= 1;
    }

    if (depth === 0) {
      return source.slice(openBrace + 1, index);
    }
  }

  throw new Error(`Rust enum ${enumName} body was not closed`);
}

function readRustStructFields(source, structName) {
  const structBody = readRustStructBody(source, structName);
  const fields = [];
  const fieldPattern = /^ {4}([a-z][A-Za-z0-9_]*):/gm;
  let match;

  while ((match = fieldPattern.exec(structBody))) {
    fields.push(match[1]);
  }

  if (fields.length === 0) {
    throw new Error(`Rust struct ${structName} has no readable fields`);
  }

  return fields;
}

function readRustStructBody(source, structName) {
  const structStart = source.indexOf(`struct ${structName}`);

  if (structStart < 0) {
    throw new Error(`Rust struct ${structName} was not found`);
  }

  const openBrace = source.indexOf('{', structStart);

  if (openBrace < 0) {
    throw new Error(`Rust struct ${structName} has no body`);
  }

  const closeBrace = source.indexOf('}', openBrace);

  if (closeBrace < 0) {
    throw new Error(`Rust struct ${structName} body was not closed`);
  }

  return source.slice(openBrace + 1, closeBrace);
}

function toSnakeCase(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function uuidFromU128(value) {
  const hex = value.toString(16).padStart(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function chunkByCharacters(payload, maxCharacters) {
  const chunks = [];
  let chunk = '';

  for (const char of payload) {
    if (chunk.length >= maxCharacters) {
      chunks.push(chunk);
      chunk = '';
    }

    chunk += char;
  }

  if (chunk) {
    chunks.push(chunk);
  }

  return chunks;
}

function deviceEventChunkFrames(payload, id, maxCharacters) {
  const chunks = chunkByCharacters(payload, maxCharacters);

  return chunks.map((data, index) =>
    JSON.stringify({
      frame: 'device_event_chunk',
      id,
      index,
      count: chunks.length,
      data,
    })
  );
}

function twoDeviceEventChunkFrames(payload, id) {
  const midpoint = Math.ceil(payload.length / 2);
  const chunks = [payload.slice(0, midpoint), payload.slice(midpoint)];

  return chunks.map((data, index) =>
    JSON.stringify({
      frame: 'device_event_chunk',
      id,
      index,
      count: chunks.length,
      data,
    })
  );
}
