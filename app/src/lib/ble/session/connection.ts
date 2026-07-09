import { DrunksafeBleClient, type DrunksafeBleDevice } from '@/lib/ble/client';
import {
  notifySubscriptionReadyTimeoutMs,
  notifySubscriptionTimeoutMessage,
} from '@/lib/ble/connection-readiness';
import type { DeviceEvent, PhoneCommand } from '@/lib/ble/model';

export default class BleConnection {
  private client: DrunksafeBleClient | null = null;
  private stateSubscription: Removable | null = null;
  private eventSubscription: Removable | null = null;
  private pendingDevice: DrunksafeBleDevice | null = null;
  private notifyReadyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly callbacks: ConnectionCallbacks) {}

  get available() {
    return this.client !== null;
  }

  initialize() {
    if (this.client) return;

    this.client = new DrunksafeBleClient();
    this.client
      .state()
      .then((state) => this.callbacks.onState(String(state)))
      .catch(this.callbacks.onError);
    this.stateSubscription = this.client.onStateChange((state) => {
      this.callbacks.onState(String(state));
    });
  }

  async startScan() {
    if (!this.client) return;

    await this.client.startScan({
      onDevice: this.callbacks.onDevice,
      onError: this.callbacks.onError,
    });
  }

  async stopScan() {
    await this.client?.stopScan();
  }

  async connect(deviceId: string, onPending: (device: DrunksafeBleDevice) => void) {
    if (!this.client) throw new Error('Drunksafe BLE is not initialized');

    this.clearNotifyReadyWait();
    const device = await this.client.connect(deviceId);

    this.clearEventMonitor();
    this.pendingDevice = device;
    onPending(device);
    this.eventSubscription = this.client.monitorEvents(
      (event) => void this.callbacks.onEvent(event),
      this.callbacks.onError
    );
    this.scheduleNotifyReadyTimeout(device.id);

    return device;
  }

  async disconnect() {
    this.clearNotifyReadyWait();
    this.clearEventMonitor();
    await this.client?.disconnect();
  }

  async send(command: PhoneCommand) {
    if (!this.client) throw new Error('Drunksafe BLE device is not connected');
    await this.client.send(command);
  }

  consumePendingDevice() {
    const device = this.pendingDevice;
    this.pendingDevice = null;
    this.clearNotifyReadyTimer();
    return device;
  }

  clearNotifyReadyWait() {
    this.pendingDevice = null;
    this.clearNotifyReadyTimer();
  }

  clearEventMonitor() {
    this.eventSubscription?.remove();
    this.eventSubscription = null;
  }

  async destroy() {
    this.clearNotifyReadyWait();
    this.clearEventMonitor();
    this.stateSubscription?.remove();
    this.stateSubscription = null;

    if (this.client) await this.client.destroy().catch(() => {});
    this.client = null;
  }

  private scheduleNotifyReadyTimeout(deviceId: string) {
    this.clearNotifyReadyTimer();
    this.notifyReadyTimer = setTimeout(() => {
      if (this.pendingDevice?.id === deviceId) {
        this.callbacks.onError(new Error(notifySubscriptionTimeoutMessage));
      }
    }, notifySubscriptionReadyTimeoutMs);
  }

  private clearNotifyReadyTimer() {
    if (!this.notifyReadyTimer) return;
    clearTimeout(this.notifyReadyTimer);
    this.notifyReadyTimer = null;
  }
}

interface ConnectionCallbacks {
  onState: (state: string) => void;
  onDevice: (device: DrunksafeBleDevice) => void;
  onEvent: (event: DeviceEvent) => void | Promise<void>;
  onError: (error: unknown) => void;
}

interface Removable {
  remove: () => void;
}
