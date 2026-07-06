import type { DeviceEvent, PhoneCommand } from '@/lib/ble/model';

export type DrunksafeBleDevice = {
  id: string;
  name: string;
  rssi: number | null;
  serviceUUIDs: string[];
};

export type ScanCallbacks = {
  onDevice: (device: DrunksafeBleDevice) => void;
  onError?: (error: Error) => void;
};

export type ScanOptions = {
  useServiceFilter?: boolean;
};

export class DrunksafeBleClient {
  state() {
    return Promise.resolve('Unsupported');
  }

  onStateChange() {
    return { remove() {} };
  }

  startScan(_callbacks: ScanCallbacks, _options: ScanOptions = {}) {
    return Promise.reject(unavailable());
  }

  stopScan() {
    return Promise.resolve();
  }

  connect(_deviceId: string) {
    return Promise.reject(unavailable());
  }

  disconnect() {
    return Promise.resolve();
  }

  monitorEvents(_onEvent: (event: DeviceEvent) => void, _onError?: (error: Error) => void) {
    return { remove() {} };
  }

  send(_command: PhoneCommand) {
    return Promise.reject(unavailable());
  }

  destroy() {
    return Promise.resolve();
  }
}

function unavailable() {
  return new Error('Drunksafe BLE is available only in native builds');
}
