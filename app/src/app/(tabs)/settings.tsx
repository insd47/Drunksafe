import { useCallback, useState } from 'react';
import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import { Pressable } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { ActionLink } from '@/components/action-link';
import { LegalNotice } from '@/components/legal-notice';
import { Screen } from '@/components/screen';
import { Section } from '@/components/section';
import { StatusRow } from '@/components/status-row';
import { useBleSession } from '@/lib/ble/session';
import { emptyBaseline, readBaseline, type UserBaseline } from '@/lib/storage/profile';

const developerTapCount = 7;

export default function SettingsRoute() {
  const router = useRouter();
  const ble = useBleSession();
  const connectedDevice = ble.connection.phase === 'connected' ? ble.connection.device : null;
  const [baseline, setBaseline] = useState<UserBaseline>(emptyBaseline);
  const [versionTaps, setVersionTaps] = useState(0);
  const appVersion = Constants.expoConfig?.version ?? '-';
  const baselineReady = baseline.sample_count > 0;

  useFocusEffect(
    useCallback(() => {
      let mounted = true;

      readBaseline()
        .then((saved) => {
          if (mounted) {
            setBaseline(saved);
          }
        })
        .catch(() => {
          if (mounted) {
            setBaseline(emptyBaseline);
          }
        });

      return () => {
        mounted = false;
      };
    }, [])
  );

  function countVersionTap() {
    const taps = versionTaps + 1;

    if (__DEV__ && taps >= developerTapCount) {
      setVersionTaps(0);
      router.push('/dev');
      return;
    }

    setVersionTaps(taps);
  }

  return (
    <Screen>
      <Section title="기기">
        <StatusRow
          description={connectedDevice ? connectedDevice.name : '홈에서 기기를 연결할 수 있습니다.'}
          label="연결 상태"
          tone={connectedDevice ? 'safe' : 'neutral'}
          value={connectedDevice ? '연결됨' : '연결 안 됨'}
        />
      </Section>
      <ActionButton
        disabled={!connectedDevice}
        label="연결 해제"
        onPress={() => {
          void ble.disconnect();
        }}
        variant="secondary"
      />

      <Section title="측정 정확도">
        <StatusRow
          description="술을 마시지 않은 상태에서 측정하면 결과가 정확해집니다."
          label="기준값"
          tone={baselineReady ? 'safe' : 'caution'}
          value={baselineReady ? `${baseline.sample_count}회 기록됨` : '아직 없음'}
        />
      </Section>
      <ActionLink
        href={{ pathname: '/measure', params: { kind: 'baseline' } }}
        label="기준값 측정하기"
        variant="secondary"
      />

      <Section title="정보">
        <Pressable accessibilityRole="button" onPress={countVersionTap}>
          <StatusRow label="앱 버전" value={appVersion} />
        </Pressable>
      </Section>

      {__DEV__ ? (
        <ActionButton
          label="개발자 도구 · PPG 파형"
          onPress={() => {
            router.push('/dev');
          }}
          variant="secondary"
        />
      ) : null}

      <LegalNotice />
    </Screen>
  );
}
