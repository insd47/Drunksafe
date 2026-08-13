import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Linking, Platform, Pressable, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { Banner } from '@/components/banner';
import { Screen } from '@/components/screen';
import { toneDotClass, toneTextClass, type Tone } from '@/components/tone';
import { ensureDrunksafeBlePermissions } from '@/lib/ble/permissions';
import { useBleSession, type ConnectionState, type MeasurementState } from '@/lib/ble/session';
import {
  formatBac,
  formatDrivingStatus,
  formatMeasuredAt,
  riskTone,
} from '@/lib/format/measurement';
import { latestMeasurement, type MeasurementRecord } from '@/lib/storage/history';

/** 홈은 상태를 나열하지 않고 다음 한 번의 탭만 제시한다. */
export default function HomeRoute() {
  const router = useRouter();
  const ble = useBleSession();
  const initialize = ble.initialize;
  const connection = ble.connection;
  const [latest, setLatest] = useState<MeasurementRecord | null>(null);
  const cta = homeCta({
    bluetoothState: ble.bluetoothState,
    connection,
    measurement: ble.measurement,
  });
  const banner = ctaBanner[cta.kind];

  useEffect(() => {
    initialize();
  }, [initialize]);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;

      latestMeasurement()
        .then((record) => {
          if (mounted) {
            setLatest(record);
          }
        })
        .catch(() => {
          if (mounted) {
            setLatest(null);
          }
        });

      return () => {
        mounted = false;
      };
    }, [])
  );

  function runCta() {
    switch (cta.kind) {
      case 'bluetooth_settings':
        void Linking.openSettings();
        return;
      case 'permission':
        void allowBluetooth();
        return;
      case 'developer':
        router.push('/dev');
        return;
      case 'result':
        router.push({ pathname: '/results/[id]', params: { id: cta.sessionId } });
        return;
      case 'resume':
      case 'start':
        router.push('/measure');
        return;
      case 'connect':
        router.push('/connect');
        return;
      case 'connecting':
        return;
    }
  }

  return (
    <Screen>
      <DeviceCard
        name={connection.phase === 'connected' ? connection.device.name : 'Drunksafe 기기'}
        status={deviceStatusText(connection)}
        tone={deviceTone(connection)}
      />

      {banner ? (
        <Banner description={banner.description} title={banner.title} tone={banner.tone} />
      ) : null}

      <ActionButton
        busy={cta.kind === 'connecting'}
        label={ctaLabel[cta.kind]}
        onPress={runCta}
        size="lg"
      />

      {connection.phase === 'connected' ? (
        <ActionButton
          label="음주 세션 측정"
          onPress={() => router.push('/session')}
          variant="secondary"
        />
      ) : null}

      <LastResultCard
        record={latest}
        onPress={() => {
          if (!latest) {
            return;
          }

          router.push({ pathname: '/results/[id]', params: { id: latest.id } });
        }}
      />
    </Screen>
  );
}

function DeviceCard({ name, status, tone }: { name: string; status: string; tone: Tone }) {
  return (
    <View className="flex-row items-center gap-3 border border-gray-200 p-4">
      <View className={`h-2.5 w-2.5 rounded-full ${toneDotClass[tone]}`} />
      <View className="min-w-0 flex-1 gap-1">
        <Text className="text-sm font-semibold text-gray-950">{name}</Text>
        <Text className="text-xs text-gray-500">{status}</Text>
      </View>
    </View>
  );
}

function LastResultCard({
  record,
  onPress,
}: {
  record: MeasurementRecord | null;
  onPress: () => void;
}) {
  if (!record) {
    return (
      <View className="gap-1 border border-gray-200 p-4">
        <Text className="text-xs font-medium text-gray-500">마지막 측정</Text>
        <Text className="text-sm text-gray-500">아직 측정 기록이 없습니다.</Text>
      </View>
    );
  }

  const bac = formatBac(record.bac_upper_milli_percent ?? record.bac_milli_percent);

  return (
    <Pressable
      accessibilityLabel={`마지막 측정 ${formatDrivingStatus(record.risk)}`}
      accessibilityRole="link"
      className="gap-1 border border-gray-200 p-4"
      onPress={onPress}>
      <Text className="text-xs font-medium text-gray-500">마지막 측정</Text>
      <Text className={`text-xl font-semibold ${toneTextClass[riskTone(record.risk)]}`}>
        {formatDrivingStatus(record.risk)}
      </Text>
      <Text className="text-xs text-gray-500">
        {formatMeasuredAt(record.measured_at_unix_ms)} · BAC 상한 {bac}
      </Text>
    </Pressable>
  );
}

async function allowBluetooth() {
  if (Platform.OS === 'android') {
    try {
      await ensureDrunksafeBlePermissions();
      return;
    } catch {
      // 권한을 거부하면 아래 설정 화면으로 안내한다.
    }
  }

  await Linking.openSettings();
}

/** 측정 상태가 연결 상태보다 우선한다 — 손에 든 결과와 진행 중인 측정이 먼저다. */
function homeCta({
  bluetoothState,
  connection,
  measurement,
}: {
  bluetoothState: string;
  connection: ConnectionState;
  measurement: MeasurementState;
}): HomeCta {
  if (measurement.phase === 'result') {
    return { kind: 'result', sessionId: measurement.record.session_id };
  }

  if (
    measurement.phase === 'starting' ||
    measurement.phase === 'active' ||
    measurement.phase === 'awaiting_pulse'
  ) {
    return { kind: 'resume' };
  }

  if (connection.phase === 'connected') {
    return { kind: 'start' };
  }

  if (connection.phase === 'connecting') {
    return { kind: 'connecting' };
  }

  if (bluetoothState === 'Unauthorized') {
    return { kind: 'permission' };
  }

  if (bluetoothState === 'Unsupported' || connection.phase === 'unsupported') {
    return __DEV__ ? { kind: 'developer' } : { kind: 'connect' };
  }

  if (bluetoothState === 'PoweredOff') {
    return { kind: 'bluetooth_settings' };
  }

  return { kind: 'connect' };
}

function deviceStatusText(connection: ConnectionState) {
  switch (connection.phase) {
    case 'connected':
      return '연결됨';
    case 'connecting':
      return '연결하는 중입니다';
    case 'scanning':
      return '주변 기기를 찾는 중입니다';
    case 'idle':
    case 'bluetooth_off':
    case 'unsupported':
    case 'error':
      return '연결되지 않았습니다';
  }
}

function deviceTone(connection: ConnectionState): Tone {
  switch (connection.phase) {
    case 'connected':
      return 'safe';
    case 'connecting':
    case 'scanning':
      return 'caution';
    case 'idle':
    case 'bluetooth_off':
    case 'unsupported':
    case 'error':
      return 'neutral';
  }
}

type HomeCta =
  | { kind: 'bluetooth_settings' }
  | { kind: 'permission' }
  | { kind: 'developer' }
  | { kind: 'result'; sessionId: string }
  | { kind: 'resume' }
  | { kind: 'start' }
  | { kind: 'connecting' }
  | { kind: 'connect' };

type CtaBanner = {
  tone: 'info' | 'caution' | 'danger';
  title: string;
  description: string;
};

const ctaLabel: Record<HomeCta['kind'], string> = {
  bluetooth_settings: 'Bluetooth 설정 열기',
  permission: '권한 허용하기',
  developer: '개발자 도구',
  result: '결과 보기',
  resume: '측정 화면 열기',
  start: '측정 시작',
  connecting: '연결 중…',
  connect: '기기 연결하기',
};

const ctaBanner: Record<HomeCta['kind'], CtaBanner | null> = {
  bluetooth_settings: {
    tone: 'danger',
    title: 'Bluetooth가 꺼져 있습니다',
    description: 'Bluetooth를 켜야 기기와 연결할 수 있습니다.',
  },
  permission: {
    tone: 'caution',
    title: '블루투스 권한이 필요합니다',
    description: '권한을 허용하면 주변 기기를 찾을 수 있습니다.',
  },
  developer: {
    tone: 'info',
    title: '블루투스를 지원하지 않는 환경입니다',
    description: '개발자 도구에서 데모 기기로 화면 흐름을 확인하세요.',
  },
  resume: {
    tone: 'info',
    title: '기기에서 측정이 시작됐습니다',
    description: '측정 화면에서 진행 상황을 확인하세요.',
  },
  result: null,
  start: null,
  connecting: null,
  connect: null,
};
