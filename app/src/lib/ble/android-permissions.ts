export type AndroidBlePermissionKind = 'none' | 'location' | 'nearby_devices';

export type AndroidBlePermissionConstants = {
  ACCESS_FINE_LOCATION?: string;
  BLUETOOTH_CONNECT?: string;
  BLUETOOTH_SCAN?: string;
};

export type AndroidBlePermissionPlan = {
  apiLevel: number;
  kind: AndroidBlePermissionKind;
  permissions: string[];
};

export function androidBlePermissionPlan(
  platformVersion: number | string,
  permissions: AndroidBlePermissionConstants
): AndroidBlePermissionPlan {
  const apiLevel = normalizeAndroidApiLevel(platformVersion);

  if (apiLevel >= 31) {
    return {
      apiLevel,
      kind: 'nearby_devices',
      permissions: present([permissions.BLUETOOTH_SCAN, permissions.BLUETOOTH_CONNECT]),
    };
  }

  if (apiLevel >= 23) {
    return {
      apiLevel,
      kind: 'location',
      permissions: present([permissions.ACCESS_FINE_LOCATION]),
    };
  }

  return {
    apiLevel,
    kind: 'none',
    permissions: [],
  };
}

export function androidBlePermissionDeniedMessage(kind: AndroidBlePermissionKind) {
  if (kind === 'nearby_devices') {
    return 'Android 근처 기기 권한이 필요합니다. Drunksafe는 BLE 스캔 결과를 위치 추적에 사용하지 않습니다.';
  }

  if (kind === 'location') {
    return 'Android 11 이하 BLE 스캔에는 위치 권한이 필요합니다. Drunksafe는 이 권한을 장치 검색에만 사용합니다.';
  }

  return 'Android BLE 권한을 확인할 수 없습니다.';
}

export function normalizeAndroidApiLevel(platformVersion: number | string) {
  if (typeof platformVersion === 'number') {
    return Number.isFinite(platformVersion) ? Math.trunc(platformVersion) : 0;
  }

  const parsed = Number.parseInt(platformVersion, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function present(values: (string | undefined)[]) {
  return values.filter((value): value is string => typeof value === 'string' && value.length > 0);
}
