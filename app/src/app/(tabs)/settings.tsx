import { useCallback, useState } from 'react';
import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import { Alert, Pressable } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { ActionLink } from '@/components/action-link';
import { LegalNotice } from '@/components/legal-notice';
import { Screen } from '@/components/screen';
import { Section } from '@/components/section';
import { StatusRow } from '@/components/status-row';
import { useBleSession } from '@/lib/ble/session';
import { baselineIssueCopy, baselineIssues } from '@/lib/personalization/baseline-acceptance';
import {
  clearSoberBaseline,
  emptyBaseline,
  readBaseline,
  type UserBaseline,
} from '@/lib/storage/profile';

const developerTapCount = 7;

export default function SettingsRoute() {
  const router = useRouter();
  const ble = useBleSession();
  const connectedDevice = ble.connection.phase === 'connected' ? ble.connection.device : null;
  const [baseline, setBaseline] = useState<UserBaseline>(emptyBaseline);
  const [versionTaps, setVersionTaps] = useState(0);
  const [clearingBaseline, setClearingBaseline] = useState(false);
  const appVersion = Constants.expoConfig?.version ?? '-';
  const issues = baselineIssues(baseline);
  const baselineReady = issues.length === 0;

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
      <Section title="개인 기준값">
        <StatusRow
          description="저장된 유효 기준 측정 횟수입니다."
          label="기준 데이터 수"
          tone={baselineReady ? 'safe' : 'caution'}
          value={
            baseline.sample_count < 1
              ? '아직 없음'
              : baselineReady
                ? `${baseline.sample_count}회 기록됨`
                : '저장됨 · 사용 불가'
          }
        />
        {baseline.sample_count > 0 ? (
          <>
            <StatusRow
              label="휴식 심박 baseline"
              tone={issues.includes('heart_rate') ? 'caution' : 'safe'}
              value={baseline.resting_bpm === null ? '없음' : `${baseline.resting_bpm} BPM`}
            />
            <StatusRow
              label="BrAC baseline"
              tone={issues.includes('alcohol') ? 'caution' : 'safe'}
              value={
                baseline.sober_alcohol_mg_l_x1000 === null
                  ? '없음'
                  : `${(baseline.sober_alcohol_mg_l_x1000 / 1000).toFixed(3)} mg/L`
              }
            />
            {issues
              .filter((issue) => issue !== 'missing')
              .map((issue) => {
                const copy = baselineIssueCopy(issue);
                return (
                  <StatusRow
                    description={copy.description}
                    key={issue}
                    label={copy.title}
                    tone="caution"
                    value="사용 불가"
                  />
                );
              })}
          </>
        ) : null}
      </Section>
      <ActionLink
        href={{ pathname: '/measure', params: { kind: 'baseline' } }}
        label="기준값 측정하기"
        variant="secondary"
      />
      {baseline.sample_count > 0 ? (
        <ActionButton
          busy={clearingBaseline}
          label="저장된 기준값 삭제"
          onPress={() => {
            Alert.alert(
              '기준값을 삭제할까요?',
              '저장된 휴식 심박과 BrAC 기준값을 삭제합니다. 별도로 학습된 알코올 분해속도는 유지됩니다.',
              [
                { text: '취소', style: 'cancel' },
                {
                  text: '삭제',
                  style: 'destructive',
                  onPress: () => {
                    setClearingBaseline(true);
                    void clearSoberBaseline()
                      .then(setBaseline)
                      .catch(() =>
                        Alert.alert('삭제하지 못했습니다', '잠시 후 다시 시도해 주세요.')
                      )
                      .finally(() => setClearingBaseline(false));
                  },
                },
              ]
            );
          }}
          variant="secondary"
        />
      ) : null}

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
