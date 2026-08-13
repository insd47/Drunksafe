import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { Banner } from '@/components/banner';
import { Screen } from '@/components/screen';
import { canRequestBleScan } from '@/lib/ble/connection-readiness';
import { useBleSession } from '@/lib/ble/session';

const searchTimeoutMs = 8000;

/** 진입하면 바로 검색하고, 목록의 기기를 누르면 연결한 뒤 스스로 닫힌다. */
export default function ConnectRoute() {
  const router = useRouter();
  const ble = useBleSession();
  const initialize = ble.initialize;
  const startScan = ble.startScan;
  const stopScan = ble.stopScan;
  const connection = ble.connection;
  const connectedDevice = connection.phase === 'connected' ? connection.device : null;
  const scannable = canRequestBleScan(ble.bluetoothState);
  const scanning = connection.phase === 'scanning';
  const connecting = connection.phase === 'connecting';
  const failed = connection.phase === 'error';
  /** 발견된 기기 목록은 검색 중에만 존재한다. */
  const devices = connection.phase === 'scanning' ? connection.devices : [];
  const [searchExpired, setSearchExpired] = useState(false);
  const notFound = scanning && searchExpired && devices.length === 0;

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (!scannable) {
      return;
    }

    void startScan();

    return () => {
      void stopScan();
    };
  }, [scannable, startScan, stopScan]);

  useEffect(() => {
    if (!scanning) {
      return;
    }

    const timer = setTimeout(() => setSearchExpired(true), searchTimeoutMs);

    return () => {
      clearTimeout(timer);
    };
  }, [scanning]);

  useEffect(() => {
    if (!connectedDevice) {
      return;
    }

    router.back();
  }, [connectedDevice, router]);

  function research() {
    setSearchExpired(false);
    void startScan();
  }

  return (
    <Screen>
      <Text className="text-sm leading-6 text-gray-600">
        기기 전원을 켜고 휴대폰 가까이 두세요.
      </Text>

      {!scannable ? (
        <Banner
          description="Bluetooth를 켠 뒤 다시 시도하세요."
          title="Bluetooth를 사용할 수 없습니다"
          tone="danger"
        />
      ) : null}

      {failed ? (
        <Banner
          description="기기 전원과 거리를 확인하세요."
          title="연결하지 못했습니다"
          tone="danger"
        />
      ) : null}

      {scanning && !notFound ? (
        <View className="flex-row items-center gap-3 border border-gray-200 p-4">
          <ActivityIndicator color="#030712" size="small" />
          <Text className="text-sm text-gray-600">주변 기기를 찾는 중입니다…</Text>
        </View>
      ) : null}

      {connecting ? (
        <View className="flex-row items-center gap-3 border border-gray-200 p-4">
          <ActivityIndicator color="#030712" size="small" />
          <Text className="text-sm text-gray-600">기기에 연결하는 중입니다…</Text>
        </View>
      ) : null}

      {notFound ? (
        <View className="gap-1 border border-gray-200 p-4">
          <Text className="text-sm font-semibold text-gray-950">기기를 찾지 못했습니다</Text>
          <Text className="text-xs leading-5 text-gray-500">
            기기 전원이 켜져 있는지 확인하고 다시 검색하세요.
          </Text>
        </View>
      ) : null}

      {devices.length > 0 ? (
        <View className="gap-3">
          {devices.map((device) => (
            <ActionButton
              key={device.id}
              label={`${device.name} 연결`}
              onPress={() => {
                void ble.connect(device.id);
              }}
              size="lg"
            />
          ))}
        </View>
      ) : null}

      {notFound || failed ? <ActionButton label="다시 검색" onPress={research} /> : null}

      <ActionButton
        label="닫기"
        onPress={() => {
          router.back();
        }}
        variant="secondary"
      />
    </Screen>
  );
}
