import {
  BleManager,
  ScanMode,
  type BleError,
  type Characteristic,
  type Device,
  type State,
  type Subscription,
} from 'react-native-ble-plx';

import { decodeUtf8Base64, encodeUtf8Base64 } from '@/lib/ble/codec';
import { parseDeviceEvent, type DeviceEvent, type PhoneCommand } from '@/lib/ble/model';
import { ensureDrunksafeBlePermissions } from '@/lib/ble/permissions';
import {
  DeviceEventFrameAssembler,
  maxBleJsonPayloadBytes,
  minimumChunkedBlePayloadBytes,
  serializePhoneCommandFrames,
} from '@/lib/ble/transport';
import { drunksafeBle } from '@/lib/ble/uuids';

const eventTransactionId = 'drunksafe-device-events';
const commandTransactionId = 'drunksafe-phone-command';
const preferredMtu = 185;

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
  private readonly manager: BleManager;
  private readonly eventAssembler = new DeviceEventFrameAssembler();
  private maxWritePayloadBytes = maxBleJsonPayloadBytes;
  private device: Device | null = null;
  private deviceId: string | null = null;
  private eventSubscription: Subscription | null = null;
  private eventMonitorGeneration = 0;

  constructor(manager = new BleManager()) {
    this.manager = manager;
  }

  state() {
    return this.manager.state();
  }

  onStateChange(listener: (state: State) => void, emitCurrentState = true) {
    return this.manager.onStateChange(listener, emitCurrentState);
  }

  async startScan({ onDevice, onError }: ScanCallbacks, options: ScanOptions = {}) {
    await ensureDrunksafeBlePermissions();
    await this.stopScan();

    const serviceFilter = options.useServiceFilter === true ? [drunksafeBle.serviceUuid] : null;

    await this.manager.startDeviceScan(
      serviceFilter,
      {
        allowDuplicates: false,
        scanMode: ScanMode.LowLatency,
      },
      (error, device) => {
        if (error) {
          onError?.(toError(error));
          return;
        }

        if (device && isDrunksafeDevice(device)) {
          onDevice(toDrunksafeDevice(device));
        }
      }
    );
  }

  stopScan() {
    return this.manager.stopDeviceScan();
  }

  async connect(deviceId: string) {
    await ensureDrunksafeBlePermissions();
    await this.stopScan();

    let device = await this.manager.connectToDevice(deviceId, { timeout: 10000 });

    try {
      device = await this.requestPreferredMtu(device);
      const discovered = await device.discoverAllServicesAndCharacteristics();
      await this.assertDrunksafeCharacteristics(discovered.id);

      this.device = discovered;
      this.deviceId = discovered.id;
      return toDrunksafeDevice(discovered);
    } catch (error) {
      this.device = null;
      this.deviceId = null;
      await this.manager.cancelDeviceConnection(device.id).catch(() => {});
      throw error;
    }
  }

  onDisconnected(listener: (error: Error | null) => void) {
    if (!this.device) {
      throw new Error('Drunksafe BLE device is not connected');
    }

    return this.device.onDisconnected((error) => {
      listener(error ? toError(error) : null);
    });
  }

  async disconnect() {
    this.clearEventMonitor();
    await this.cancelTransactions();

    if (!this.deviceId) {
      this.device = null;
      return;
    }

    const deviceId = this.deviceId;
    this.device = null;
    this.deviceId = null;

    if (await this.manager.isDeviceConnected(deviceId)) {
      await this.manager.cancelDeviceConnection(deviceId);
    }
  }

  monitorEvents(onEvent: (event: DeviceEvent) => void, onError?: (error: Error) => void) {
    const deviceId = this.requireDeviceId();

    this.eventSubscription?.remove();
    this.eventAssembler.reset();
    const eventMonitorGeneration = this.advanceEventMonitorGeneration();
    this.eventSubscription = this.manager.monitorCharacteristicForDevice(
      deviceId,
      drunksafeBle.serviceUuid,
      drunksafeBle.deviceEventCharacteristicUuid,
      (error, characteristic) => {
        if (eventMonitorGeneration !== this.eventMonitorGeneration) {
          return;
        }

        if (error) {
          onError?.(toError(error));
          return;
        }

        if (!characteristic?.value) {
          return;
        }

        try {
          const eventPayload = this.eventAssembler.accept(decodeUtf8Base64(characteristic.value));

          if (eventPayload) {
            onEvent(parseDeviceEvent(eventPayload));
          }
        } catch (parseError) {
          onError?.(toError(parseError));
        }
      },
      eventTransactionId
    );

    return this.eventSubscription;
  }

  async send(command: PhoneCommand) {
    const deviceId = this.requireDeviceId();

    for (const frame of serializePhoneCommandFrames(command, this.maxWritePayloadBytes)) {
      await this.manager.writeCharacteristicWithResponseForDevice(
        deviceId,
        drunksafeBle.serviceUuid,
        drunksafeBle.phoneCommandCharacteristicUuid,
        encodeUtf8Base64(frame),
        commandTransactionId
      );
    }
  }

  async destroy() {
    await this.stopScan().catch(() => {});
    this.clearEventMonitor();
    await this.cancelTransactions();
    this.device = null;
    this.deviceId = null;

    return this.manager.destroy();
  }

  private requireDeviceId() {
    if (!this.deviceId) {
      throw new Error('Drunksafe BLE device is not connected');
    }

    return this.deviceId;
  }

  private clearEventMonitor() {
    this.advanceEventMonitorGeneration();
    this.eventSubscription?.remove();
    this.eventSubscription = null;
    this.eventAssembler.reset();
  }

  private advanceEventMonitorGeneration() {
    this.eventMonitorGeneration += 1;
    return this.eventMonitorGeneration;
  }

  private async cancelTransactions() {
    await Promise.allSettled([
      this.manager.cancelTransaction(eventTransactionId),
      this.manager.cancelTransaction(commandTransactionId),
    ]);
  }

  private async assertDrunksafeCharacteristics(deviceId: string) {
    const characteristics = await this.manager.characteristicsForDevice(
      deviceId,
      drunksafeBle.serviceUuid
    );

    const eventCharacteristic = findCharacteristic(
      characteristics,
      drunksafeBle.deviceEventCharacteristicUuid
    );
    const commandCharacteristic = findCharacteristic(
      characteristics,
      drunksafeBle.phoneCommandCharacteristicUuid
    );

    if (!eventCharacteristic?.isNotifiable || !commandCharacteristic?.isWritableWithResponse) {
      throw new Error('Connected device does not expose Drunksafe BLE characteristics');
    }
  }

  private async requestPreferredMtu(device: Device) {
    this.maxWritePayloadBytes = maxBleJsonPayloadBytes;

    let mtuDevice: Device;

    try {
      mtuDevice = await this.manager.requestMTUForDevice(device.id, preferredMtu);
    } catch {
      if (process.env.EXPO_OS === 'android') {
        this.maxWritePayloadBytes = maxBleJsonPayloadBytes;
      }

      return device;
    }

    const writePayloadBytes = mtuDevice.mtu - 3;

    if (writePayloadBytes < minimumChunkedBlePayloadBytes) {
      throw new Error(
        `BLE MTU가 너무 작아 chunk payload를 전송할 수 없습니다. 최소 ${minimumChunkedBlePayloadBytes} byte payload가 필요합니다.`
      );
    }

    this.maxWritePayloadBytes = Math.min(maxBleJsonPayloadBytes, writePayloadBytes);
    return mtuDevice;
  }
}

function findCharacteristic(characteristics: Characteristic[], uuid: string) {
  return characteristics.find((characteristic) => characteristic.uuid.toLowerCase() === uuid);
}

function isDrunksafeDevice(device: Device) {
  return (
    hasDrunksafeService(device.serviceUUIDs) ||
    device.name?.startsWith(drunksafeBle.deviceNamePrefix) ||
    device.localName?.startsWith(drunksafeBle.deviceNamePrefix)
  );
}

function hasDrunksafeService(serviceUUIDs: string[] | null) {
  return serviceUUIDs?.some((uuid) => uuid.toLowerCase() === drunksafeBle.serviceUuid) ?? false;
}

function toDrunksafeDevice(device: Device): DrunksafeBleDevice {
  return {
    id: device.id,
    name: device.name ?? device.localName ?? 'Drunksafe',
    rssi: device.rssi,
    serviceUUIDs: device.serviceUUIDs ?? [],
  };
}

function toError(error: unknown) {
  if (error instanceof Error) {
    return error;
  }

  const bleError = error as Partial<BleError>;
  return new Error(bleError.message ?? 'Drunksafe BLE error');
}
