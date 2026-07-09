import { PermissionsAndroid, Platform } from 'react-native';

import {
  androidBlePermissionDeniedMessage,
  androidBlePermissionPlan,
} from '@/lib/ble/android-permissions';

export async function ensureDrunksafeBlePermissions() {
  if (process.env.EXPO_OS !== 'android') {
    return;
  }

  const plan = androidBlePermissionPlan(Platform.Version, PermissionsAndroid.PERMISSIONS);

  if (plan.permissions.length === 0) {
    return;
  }

  const result = await PermissionsAndroid.requestMultiple(
    plan.permissions as Parameters<typeof PermissionsAndroid.requestMultiple>[0]
  );
  const denied = plan.permissions.filter(
    (permission) => result[permission as keyof typeof result] !== PermissionsAndroid.RESULTS.GRANTED
  );

  if (denied.length > 0) {
    throw new Error(androidBlePermissionDeniedMessage(plan.kind));
  }
}
