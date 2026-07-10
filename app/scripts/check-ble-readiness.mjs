import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  canRequestBleScan,
  connectedDeviceAfterNotifySubscriptionReady,
  notifySubscriptionPendingMessage,
  notifySubscriptionReadyTimeoutMs,
  notifySubscriptionTimeoutMessage,
} from '@/lib/ble/connection-readiness';

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoDir = dirname(appDir);
const sessionStoreSource = readFileSync(
  join(appDir, 'src', 'lib', 'ble', 'session', 'store.ts'),
  'utf8'
);
const connectionSource = readFileSync(
  join(appDir, 'src', 'lib', 'ble', 'session', 'connection.ts'),
  'utf8'
);
const eventHandlerSource = readFileSync(
  join(appDir, 'src', 'lib', 'ble', 'session', 'event-handler.ts'),
  'utf8'
);
const connectScreenSource = readFileSync(join(appDir, 'src', 'app', 'index.tsx'), 'utf8');
const firmwareGattSource = readFileSync(
  join(repoDir, 'firmware', 'src', 'services', 'ble', 'gatt', 'server.rs'),
  'utf8'
);

test('app keeps a BLE device pending until the first status notify arrives', () => {
  const currentDevice = device('current');
  const pendingDevice = device('pending');

  assert.equal(
    connectedDeviceAfterNotifySubscriptionReady({
      currentConnectedDevice: currentDevice,
      pendingConnectedDevice: pendingDevice,
    }),
    pendingDevice
  );
  assert.equal(
    connectedDeviceAfterNotifySubscriptionReady({
      currentConnectedDevice: currentDevice,
      pendingConnectedDevice: null,
    }),
    currentDevice
  );
  assert.match(notifySubscriptionPendingMessage, /notify 구독 확인/);
  assert.match(notifySubscriptionTimeoutMessage, /구독 확인 시간이 초과/);
  assert.ok(notifySubscriptionReadyTimeoutMs >= 1000);
});

test('unauthorized Bluetooth state can still request scan permissions', () => {
  assert.equal(canRequestBleScan('PoweredOn'), true);
  assert.equal(canRequestBleScan('Unauthorized'), true);
  assert.equal(canRequestBleScan('PoweredOff'), false);
  assert.equal(canRequestBleScan('Unsupported'), false);
  assert.match(sessionStoreSource, /canRequestBleScan\(this\.snapshot\.bluetoothState\)/);
  assert.match(connectScreenSource, /!canRequestBleScan\(ble\.bluetoothState\)/);
});

test('app waits for notify readiness before enabling connected controls', () => {
  const connectIndex = indexOfRequired(
    connectionSource,
    'async connect(deviceId: string, onPending:'
  );
  const pendingIndex = indexOfRequired(connectionSource, 'this.pendingDevice = device;');
  const pendingStateIndex = indexOfRequired(connectionSource, 'onPending(device);');
  const monitorIndex = indexOfRequired(connectionSource, 'this.client.monitorEvents(');
  const timeoutIndex = indexOfRequired(
    connectionSource,
    'this.scheduleNotifyReadyTimeout(device.id);'
  );
  const statusIndex = indexOfRequired(eventHandlerSource, "case 'status':");
  const promoteIndex = indexOfRequired(
    eventHandlerSource,
    'connectedDeviceAfterNotifySubscriptionReady({'
  );
  const connectBody = connectionSource.slice(
    connectIndex,
    indexOfRequired(connectionSource, 'async disconnect()')
  );

  assert.ok(connectIndex < pendingIndex);
  assert.ok(pendingIndex < pendingStateIndex);
  assert.ok(pendingStateIndex < monitorIndex);
  assert.ok(monitorIndex < timeoutIndex);
  assert.ok(statusIndex < promoteIndex);
  assert.equal(connectBody.includes('connectedDevice: device'), false);
  assert.match(sessionStoreSource, /connectedDevice: null/);
  assert.match(sessionStoreSource, /notifySubscriptionPendingMessage/);
});

test('firmware replays status when a client enables event notify', () => {
  const notifyCacheIndex = indexOfRequired(
    firmwareGattSource,
    '*self.status.lock().unwrap() = Some(event.clone());'
  );
  const writeArmIndex = indexOfRequired(firmwareGattSource, 'GattsEvent::Write {');
  const handleIndex = indexOfRequiredAfter(
    firmwareGattSource,
    'let (handled, replay) = self.accept',
    writeArmIndex
  );
  const responseIndex = indexOfRequiredAfter(
    firmwareGattSource,
    'self.attributes.respond(interface, event)?;',
    handleIndex
  );
  const replayNotifyIndex = indexOfRequiredAfter(
    firmwareGattSource,
    'if let Some(event) = replay',
    responseIndex
  );
  const notifyIndex = indexOfRequiredAfter(
    firmwareGattSource,
    'self.send(&event)?;',
    replayNotifyIndex
  );
  const cccdIndex = indexOfRequired(
    firmwareGattSource,
    'if self.attributes.configuration() == Some(handle)'
  );
  const replayIndex = indexOfRequiredAfter(firmwareGattSource, 'self.status', cccdIndex);
  const fallbackIndex = indexOfRequired(
    firmwareGattSource,
    'event::status(StatusKind::Connected, None)'
  );
  const acceptIndex = indexOfRequired(firmwareGattSource, 'fn accept(');
  const subscribeIndex = indexOfRequiredAfter(firmwareGattSource, 'fn subscribe(', acceptIndex);
  const acceptBody = firmwareGattSource.slice(acceptIndex, subscribeIndex);

  assert.ok(writeArmIndex < handleIndex);
  assert.ok(handleIndex < responseIndex);
  assert.ok(responseIndex < replayNotifyIndex);
  assert.ok(replayNotifyIndex < notifyIndex);
  assert.ok(notifyCacheIndex < cccdIndex);
  assert.ok(cccdIndex < replayIndex);
  assert.ok(replayIndex < fallbackIndex);
  assert.ok(acceptBody.includes('(true, self.subscribe(connection, offset, value))'));
  assert.ok(acceptBody.includes('return (false, None)'));
  assert.equal(acceptBody.includes('self.send(&event)?;'), false);
});

function device(id) {
  return {
    id,
    name: `Drunksafe ${id}`,
    rssi: null,
    serviceUUIDs: [],
  };
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
