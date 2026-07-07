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
const sessionSource = readFileSync(join(appDir, 'src', 'lib', 'ble', 'session.ts'), 'utf8');
const connectScreenSource = readFileSync(
  join(appDir, 'src', 'screens', 'connect', 'index.tsx'),
  'utf8'
);
const firmwareGattSource = readFileSync(
  join(repoDir, 'firmware', 'src', 'services', 'ble', 'gatt.rs'),
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
  assert.match(sessionSource, /canRequestBleScan\(this\.snapshot\.bluetoothState\)/);
  assert.match(connectScreenSource, /!canRequestBleScan\(ble\.bluetoothState\)/);
});

test('app waits for notify readiness before enabling connected controls', () => {
  const connectIndex = indexOfRequired(sessionSource, 'connect = async (deviceId: string) => {');
  const pendingIndex = indexOfRequired(sessionSource, 'this.pendingConnectedDevice = device;');
  const monitorIndex = indexOfRequired(sessionSource, 'this.client.monitorEvents(');
  const timeoutIndex = indexOfRequired(
    sessionSource,
    'this.scheduleNotifyReadyTimeout(device.id);'
  );
  const statusIndex = indexOfRequired(sessionSource, "case 'status':");
  const promoteIndex = indexOfRequired(
    sessionSource,
    'connectedDeviceAfterNotifySubscriptionReady({'
  );
  const connectBody = sessionSource.slice(
    connectIndex,
    indexOfRequired(sessionSource, 'connectMockDevice = async')
  );

  assert.ok(connectIndex < pendingIndex);
  assert.ok(pendingIndex < monitorIndex);
  assert.ok(monitorIndex < timeoutIndex);
  assert.ok(statusIndex < promoteIndex);
  assert.equal(connectBody.includes('connectedDevice: device'), false);
  assert.ok(connectBody.includes('connectedDevice: null'));
  assert.ok(connectBody.includes('notifySubscriptionPendingMessage'));
});

test('firmware replays status when a client enables event notify', () => {
  const notifyCacheIndex = indexOfRequired(
    firmwareGattSource,
    'state.last_status = Some(event.clone());'
  );
  const cccdIndex = indexOfRequired(
    firmwareGattSource,
    'if Some(handle) == state.event_cccd_handle'
  );
  const replayIndex = indexOfRequired(firmwareGattSource, 'subscribe_status = Some(');
  const fallbackIndex = indexOfRequired(
    firmwareGattSource,
    'super::device_status(super::StatusKind::Connected, None)'
  );
  const notifyIndex = indexOfRequired(firmwareGattSource, 'self.notify(&event)?;');

  assert.ok(notifyCacheIndex < cccdIndex);
  assert.ok(cccdIndex < replayIndex);
  assert.ok(replayIndex < fallbackIndex);
  assert.ok(fallbackIndex < notifyIndex);
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
