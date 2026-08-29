import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { Screen } from '@/components/screen';
import { Section } from '@/components/section';
import { StatusRow } from '@/components/status-row';
import { useAlcoholState, useBleSession, useSession } from '@/lib/ble/session';
import {
  readFittingProfile,
  type AlcoholFittingProfile,
} from '@/lib/personalization/fitting-profile';
import { clearStoredFittingData } from '@/lib/storage/sessions';

export default function FittingRoute() {
  const router = useRouter();
  const ble = useBleSession();
  const session = useSession();
  const [profile, setProfile] = useState<AlcoholFittingProfile | null>(null);
  const alcoholState = useAlcoholState();
  const connected = ble.connection.phase === 'connected';
  const active = session.phase === 'active' || session.phase === 'downloading';
  const trailingFailures = [...session.alcoholResults]
    .reverse()
    .findIndex((result) => result.alcohol_mg_l_x1000 !== null);
  const consecutiveFailures =
    trailingFailures === -1 ? session.alcoholResults.length : trailingFailures;
  const lastFailure = [...session.alcoholResults]
    .reverse()
    .find((result) => result.alcohol_mg_l_x1000 === null);
  const lockedUntil = lastFailure ? Math.ceil((lastFailure.elapsed_ms + 1) / 600_000) * 600_000 : 0;
  const slotLocked = consecutiveFailures >= 3 && (session.status?.elapsed_ms ?? 0) < lockedUntil;
  useEffect(() => {
    if (session.phase === 'active' || session.phase === 'downloading') return;
    void readFittingProfile().then(setProfile);
  }, [session.phase]);
  const run = (action: () => Promise<void>) =>
    void action().catch((e) =>
      Alert.alert('작업 실패', e instanceof Error ? e.message : '연결을 확인해 주세요.')
    );
  return (
    <Screen>
      <Section eyebrow="Fitting" title="개인 분해곡선 측정">
        <StatusRow
          label="진행"
          value={
            session.phase === 'idle'
              ? '대기'
              : session.phase === 'active'
                ? '측정 중'
                : session.phase === 'downloading'
                  ? '데이터 수신 중'
                  : '완료'
          }
        />
        <StatusRow
          label="저장된 k"
          value={
            profile
              ? `${profile.kPerMinute.toFixed(6)}/분 (${profile.kLowPerMinute.toFixed(6)}~${profile.kHighPerMinute.toFixed(6)})`
              : '없음'
          }
        />
        <StatusRow label="측정 수" value={session.status ? String(session.status.records) : '-'} />
        <StatusRow label="현재 구간 실패" value={`${Math.min(3, consecutiveFailures)} / 3`} />
        <StatusRow
          label="센서"
          value={alcoholState === 'wait_blow' ? '지금 부세요' : (alcoholState ?? '-')}
        />
        <Text className="text-sm leading-6 text-gray-600">
          심박은 측정하지 않습니다. 기기가 10분마다 한 번 울리면 GPIO 0 또는 아래 버튼으로 측정을
          시작하세요. Wait Blow 진입 때 두 번 울립니다. 값이 10에 도달하기 전 종료해도 peak 이후
          유효 측정점이 4개 이상이면 k를 계산합니다. 새 세션의 fitting이 성공하면 저장된 k를
          교체하고, 점이 부족하면 기존 k를 유지합니다.
        </Text>
      </Section>
      {alcoholState === 'wait_blow' ? (
        <View className="border border-blue-400 bg-blue-50 p-5">
          <Text className="text-xl font-bold text-blue-950">지금 부세요</Text>
          <Text className="text-sm text-blue-900">4초간 일정하게 불어주세요.</Text>
        </View>
      ) : null}
      <ActionButton
        disabled={!connected || active}
        label="fitting 측정 세션 시작"
        onPress={() => run(ble.startAlcoholTrack)}
      />
      {slotLocked ? (
        <View className="border border-amber-400 bg-amber-50 p-4">
          <Text className="text-sm text-amber-900">
            이번 10분 구간은 3회 실패로 누락되었습니다. 다음 구간 알림을 기다려주세요.
          </Text>
        </View>
      ) : null}
      <ActionButton
        disabled={
          !connected ||
          session.phase !== 'active' ||
          session.alcoholMeasurementPending ||
          slotLocked
        }
        label={
          session.alcoholMeasurementPending
            ? '측정 진행 중…'
            : slotLocked
              ? '다음 10분 구간 대기'
              : '알코올 측정'
        }
        onPress={() => run(ble.measureSessionAlcohol)}
      />
      <ActionButton
        disabled={!connected || !active}
        label="종료 및 데이터 받기"
        onPress={() => run(ble.endSession)}
        variant="secondary"
      />
      <ActionButton
        disabled={active}
        label="기존 fitting 데이터 삭제"
        onPress={() => {
          Alert.alert(
            '기존 fitting 데이터를 삭제할까요?',
            '저장된 k와 fitting 측정 원본을 삭제합니다. 일반 음주 세션 기록은 유지됩니다.',
            [
              { text: '취소', style: 'cancel' },
              {
                text: '삭제',
                style: 'destructive',
                onPress: () =>
                  run(async () => {
                    const removed = await clearStoredFittingData();
                    setProfile(null);
                    Alert.alert(
                      '삭제 완료',
                      `기존 profile과 fitting 원시 세션 ${removed}개를 삭제했습니다.`
                    );
                  }),
              },
            ]
          );
        }}
        variant="secondary"
      />
      <ActionButton label="닫기" onPress={() => router.back()} variant="secondary" />
    </Screen>
  );
}
