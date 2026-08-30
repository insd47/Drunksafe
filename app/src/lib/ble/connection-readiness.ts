import type { DrunksafeBleDevice } from '@/lib/ble/client';

export const notifySubscriptionReadyTimeoutMs = 15000;
export const notifySubscriptionPendingMessage = 'BLE notify 구독 확인을 기다리는 중입니다.';
export const notifySubscriptionTimeoutMessage = 'BLE notify 구독 확인 시간이 초과됐습니다.';

export function canRequestBleScan(bluetoothState: string) {
  return bluetoothState === 'PoweredOn' || bluetoothState === 'Unauthorized';
}

export function connectedDeviceAfterNotifySubscriptionReady({
  currentConnectedDevice,
  pendingConnectedDevice,
}: {
  currentConnectedDevice: DrunksafeBleDevice | null;
  pendingConnectedDevice: DrunksafeBleDevice | null;
}) {
  return pendingConnectedDevice ?? currentConnectedDevice;
}

export function scheduleNotifySubscriptionTimeout({
  deviceId,
  pendingDeviceId,
  onTimeout,
  schedule = setTimeout,
}: NotifySubscriptionTimeoutOptions) {
  return schedule(() => {
    if (pendingDeviceId() === deviceId) {
      onTimeout();
    }
  }, notifySubscriptionReadyTimeoutMs);
}

interface NotifySubscriptionTimeoutOptions {
  deviceId: string;
  pendingDeviceId: () => string | null;
  onTimeout: () => void;
  schedule?: typeof setTimeout;
}
