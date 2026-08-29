import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { decodeUtf8Base64, encodeUtf8Base64, utf8ByteLength } from '@/lib/ble/codec';
import { parseDeviceEvent, protocolVersion, toPhoneCommandPayload } from '@/lib/ble/model';
import {
  DeviceEventFrameAssembler,
  maxBleJsonPayloadBytes,
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

test('developer live pulse and decimated raw batches each fit one negotiated-MTU payload', () => {
  const pulse = {
    event: 'pulse_reading',
    v: protocolVersion,
    session_id: 'fw-pulse-65535',
    elapsed_ms: 3_600_000,
    bpm: 123.4,
    ibi_stddev_ms: 299.9,
    peak_count: 65535,
    stable: false,
  };
  const raw = {
    event: 'ppg_sample',
    v: protocolVersion,
    session_id: 'fw-pulse-65535',
    t0_ms: 3_600_000,
    dt_ms: 40,
    samples: Array.from({ length: 10 }, () => 4095),
  };
  assert.doesNotThrow(() => parseDeviceEvent(JSON.stringify(pulse)));
  assert.doesNotThrow(() => parseDeviceEvent(JSON.stringify(raw)));
  assert.ok(utf8ByteLength(JSON.stringify(pulse)) <= maxBleJsonPayloadBytes);
  assert.ok(utf8ByteLength(JSON.stringify(raw)) <= maxBleJsonPayloadBytes);
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

test('chunk transport keeps oversized valid commands in bounded BLE frames', () => {
  const command = oversizedCancelCommand();
  const maxPayloadBytes = 120;
  const frames = serializePhoneCommandFrames(command, maxPayloadBytes);

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

  assert.deepEqual(JSON.parse(chunks.join('')), command);
});

test('oversized commands require a chunk-capable BLE payload size', () => {
  const command = oversizedCancelCommand();
  assert.throws(
    () => serializePhoneCommandFrames(command, 20),
    /BLE transport chunk count exceeds configured limit/
  );
  assert.throws(
    () => serializePhoneCommandFrames(command, 97),
    /BLE transport chunk count exceeds configured limit/
  );

  const frames = serializePhoneCommandFrames(command, minimumChunkedBlePayloadBytes);

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
  const oldPayload = JSON.stringify(deviceStatus({ active_session_id: 'old' }));
  const newPayload = JSON.stringify(deviceStatus({ active_session_id: 'new' }));
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

test('BLE base64 codec rejects malformed padding and non-canonical pad bits', () => {
  for (const malformed of ['A===', 'AA=A', '=AAA', 'YR==', 'YWJ=']) {
    assert.throws(() => decodeUtf8Base64(malformed), /Invalid BLE base64 payload/);
  }
});

test('BLE base64 codec defines empty and lone-surrogate behavior', () => {
  assert.equal(encodeUtf8Base64(''), '');
  assert.equal(decodeUtf8Base64(''), '');
  assert.throws(() => encodeUtf8Base64('\ud800'), URIError);
  assert.throws(() => decodeUtf8Base64('/w=='), URIError);
});

test('v12 rejects removed progress events and payer-free commands', () => {
  assert.throws(
    () =>
      parseDeviceEvent(
        JSON.stringify({
          event: 'measurement_progress',
          v: contract.protocolVersion,
          session_id: 'removed',
          step: 'preparing',
          percent: 5,
        })
      ),
    /Invalid Drunksafe BLE event payload/
  );
  assert.throws(
    () => toPhoneCommandPayload({ cmd: 'time', unix_time_ms: 1798848000000 }),
    /Invalid Drunksafe BLE command payload/
  );
});

function deviceStatus(overrides = {}) {
  return {
    event: 'status',
    v: contract.protocolVersion,
    status: 'connected',
    active_session_id: null,
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
    ...overrides,
  };
}

function measurementResult(overrides = {}) {
  return {
    event: 'measurement_result',
    v: contract.protocolVersion,
    session_id: 'enum-fixture',
    kind: 'measurement',
    alcohol_mg_l_x1000: 0,
    pulse: { status: 'measured', bpm: 72, stable: true },
    ...overrides,
  };
}

function oversizedCancelCommand() {
  return { cmd: 'cancel', session_id: 'session'.repeat(100) };
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
