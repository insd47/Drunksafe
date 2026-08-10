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
  minimumChunkedBlePayloadBytes,
  serializePhoneCommandFrames,
} from '@/lib/ble/transport';
import { drunksafeBle } from '@/lib/ble/uuids';

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoDir = dirname(appDir);
const contract = JSON.parse(
  readFileSync(join(repoDir, '.docs', 'ble-contract-fixtures.json'), 'utf8')
);

test('app BLE protocol version and GATT UUIDs match the contract fixture', () => {
  assert.equal(protocolVersion, contract.protocolVersion);
  assert.deepEqual(drunksafeBle, contract.gatt);
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
    code: 'cancelled',
    ...overrides,
  };
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
