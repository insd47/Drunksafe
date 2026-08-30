import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canRequestBleScan,
  connectedDeviceAfterNotifySubscriptionReady,
  notifySubscriptionPendingMessage,
  notifySubscriptionReadyTimeoutMs,
  notifySubscriptionTimeoutMessage,
  scheduleNotifySubscriptionTimeout,
} from '@/lib/ble/connection-readiness';

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
  assert.equal(notifySubscriptionReadyTimeoutMs, 15000);
});

test('unauthorized Bluetooth state can still request scan permissions', () => {
  assert.equal(canRequestBleScan('PoweredOn'), true);
  assert.equal(canRequestBleScan('Unauthorized'), true);
  assert.equal(canRequestBleScan('PoweredOff'), false);
  assert.equal(canRequestBleScan('Unsupported'), false);
});

test('notify readiness timeout disconnects a pending client and enters error state', () => {
  let pendingDeviceId = 'pending';
  let scheduledDelayMs = null;
  let scheduledCallback = null;
  let connectionPhase = 'connecting';
  const client = {
    disconnectCalls: 0,
    disconnect() {
      this.disconnectCalls += 1;
    },
  };

  scheduleNotifySubscriptionTimeout({
    deviceId: 'pending',
    pendingDeviceId: () => pendingDeviceId,
    onTimeout: () => {
      client.disconnect();
      pendingDeviceId = null;
      connectionPhase = 'error';
    },
    schedule: (callback, delayMs) => {
      scheduledCallback = callback;
      scheduledDelayMs = delayMs;
      return 1;
    },
  });

  assert.equal(scheduledDelayMs, notifySubscriptionReadyTimeoutMs);
  assert.equal(client.disconnectCalls, 0);
  assert.ok(scheduledCallback);

  scheduledCallback();

  assert.equal(client.disconnectCalls, 1);
  assert.equal(pendingDeviceId, null);
  assert.equal(connectionPhase, 'error');
});

function device(id) {
  return {
    id,
    name: `Drunksafe ${id}`,
    rssi: null,
    serviceUUIDs: [],
  };
}
