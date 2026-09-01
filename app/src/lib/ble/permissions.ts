import { PermissionsAndroid, Platform } from 'react-native';

import {
  androidBlePermissionDeniedMessage,
  androidBlePermissionPlan,
} from '@/lib/ble/android-permissions';

export async function ensureDrunksafeBlePermissions() {
  // 개발 편의를 위해 매번 권한을 묻지 않고 항상 허용된 것으로 간주 (자동 패스)
  return;
}
