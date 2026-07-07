import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  androidBlePermissionDeniedMessage,
  androidBlePermissionPlan,
  normalizeAndroidApiLevel,
} from '@/lib/ble/android-permissions';

const permissions = {
  ACCESS_FINE_LOCATION: 'android.permission.ACCESS_FINE_LOCATION',
  BLUETOOTH_CONNECT: 'android.permission.BLUETOOTH_CONNECT',
  BLUETOOTH_SCAN: 'android.permission.BLUETOOTH_SCAN',
};
const appConfig = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));

test('Android 12+ BLE scan uses Nearby Devices runtime permissions', () => {
  const plan = androidBlePermissionPlan(31, permissions);

  assert.equal(plan.kind, 'nearby_devices');
  assert.deepEqual(plan.permissions, [
    'android.permission.BLUETOOTH_SCAN',
    'android.permission.BLUETOOTH_CONNECT',
  ]);
  assert.match(androidBlePermissionDeniedMessage(plan.kind), /근처 기기/);
});

test('Android 6 through 11 BLE scan uses fine location runtime permission', () => {
  const plan = androidBlePermissionPlan(30, permissions);

  assert.equal(plan.kind, 'location');
  assert.deepEqual(plan.permissions, ['android.permission.ACCESS_FINE_LOCATION']);
  assert.match(androidBlePermissionDeniedMessage(plan.kind), /위치 권한/);
});

test('pre-Marshmallow Android does not need a runtime BLE permission dialog', () => {
  const plan = androidBlePermissionPlan(22, permissions);

  assert.equal(plan.kind, 'none');
  assert.deepEqual(plan.permissions, []);
});

test('Android API level parser handles React Native Platform.Version values', () => {
  assert.equal(normalizeAndroidApiLevel('35'), 35);
  assert.equal(normalizeAndroidApiLevel('31-release'), 31);
  assert.equal(normalizeAndroidApiLevel(Number.NaN), 0);
});

test('Expo BLE plugin asserts scans are not used for location', () => {
  const blePlugin = appConfig.expo.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'react-native-ble-plx'
  );

  assert.ok(blePlugin);
  assert.equal(blePlugin[1].neverForLocation, true);
});
