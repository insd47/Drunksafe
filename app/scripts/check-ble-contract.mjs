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
const firmwareModelSource = readFileSync(
  join(repoDir, 'firmware', 'src', 'services', 'ble', 'model.rs'),
  'utf8'
);
const firmwareTransportSource = readFileSync(
  join(repoDir, 'firmware', 'src', 'services', 'ble', 'transport.rs'),
  'utf8'
);

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
  const chunks = chunkByCharacters(payload, 48);
  const frames = chunks.map((data, index) =>
    JSON.stringify({
      frame: 'device_event_chunk',
      id: 'fixture-result',
      index,
      count: chunks.length,
      data,
    })
  );
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
