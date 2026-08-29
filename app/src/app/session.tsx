import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionButton } from '@/components/action-button';
import { PulseContactGuide } from '@/components/pulse-contact-guide';
import { Screen } from '@/components/screen';
import { Section } from '@/components/section';
import { StatusRow } from '@/components/status-row';
import {
  useAlcoholState,
  useBleSession,
  useSession,
  type SessionUiSnapshot,
} from '@/lib/ble/session';
import type { AlcoholStateLabel, SessionStateLabel } from '@/lib/ble/model';
import { baselineIssueCopy, baselineIssues } from '@/lib/personalization/baseline-acceptance';
import {
  estimateExponentialSoberTime,
  readFittingProfile,
  type AlcoholFittingProfile,
} from '@/lib/personalization/fitting-profile';
import { emptyBaseline, readBaseline, type UserBaseline } from '@/lib/storage/profile';

/**
 * 음주 세션의 센서 스케줄은 ESP32가 실행한다. 현재 하드웨어 검증에서는
 * BLE 이벤트 유실을 피하기 위해 휴대폰 화면과 앱을 켜 둔다.
 */
export default function SessionRoute() {
  const router = useRouter();
  const ble = useBleSession();
  const session = useSession();
  const connected = ble.connection.phase === 'connected';
  const [baseline, setBaseline] = useState<UserBaseline>(emptyBaseline);
  const [fittingProfile, setFittingProfile] = useState<AlcoholFittingProfile | null>(null);
  const [starting, setStarting] = useState(false);
  const issues = baselineIssues(baseline);
  const baselineReady = issues.length === 0;
  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      void readBaseline()
        .then((saved) => {
          if (mounted) setBaseline(saved);
        })
        .catch(() => {
          if (mounted) setBaseline(emptyBaseline);
        });
      void readFittingProfile().then((saved) => {
        if (mounted) setFittingProfile(saved);
      });
      return () => {
        mounted = false;
      };
    }, [])
  );

  async function start() {
    setStarting(true);
    try {
      await ble.startSession();
    } catch (error) {
      Alert.alert(
        '세션을 시작하지 못했습니다',
        error instanceof Error ? error.message : '연결을 확인해 주세요.'
      );
    } finally {
      setStarting(false);
    }
  }

  if (session.phase === 'complete') {
    return (
      <SessionComplete
        connected={connected}
        onClose={() => router.back()}
        onRestart={() => void start()}
        session={session}
        starting={starting}
      />
    );
  }

  if (session.phase === 'downloading') {
    return <SessionDownloading session={session} />;
  }

  if (session.phase === 'active') {
    return (
      <SessionActive
        fittingProfile={fittingProfile}
        connected={connected}
        onEnd={() => void ble.endSession()}
        onMeasureAlcohol={() => {
          void ble.measureSessionAlcohol().catch((error) => {
            Alert.alert(
              '알코올 측정을 시작하지 못했습니다',
              error instanceof Error ? error.message : '연결 상태를 확인해 주세요.'
            );
          });
        }}
        session={session}
      />
    );
  }

  return (
    <Screen>
      <Section eyebrow="Session" title="음주 세션 측정">
        <StatusRow
          description="개인 기준값 대비 안정 심박 상승이 지속되면 알코올 측정을 권장합니다. 음주 여부를 확정하지 않습니다."
          label="이번 단계"
          value="심박 관찰 → 측정 권장"
        />
        <StatusRow
          description="기준값 측정하기에서 저장한 값을 사용하며, 세션 중에는 기준값을 올리지 않습니다."
          label="개인 안정 심박"
          value={baselineReady ? `${baseline.resting_bpm} BPM` : '기준값 측정 필요'}
        />
        {baseline.sample_count > 0
          ? issues
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
              })
          : null}
        <Text className="text-sm leading-6 text-gray-600">
          최근 10분 중 8분 이상이 기준값보다 10%, 15%, 20% 높아질 때 각각 알코올 측정을 권장합니다.
          권장 알림 뒤 GPIO 0 버튼이나 앱의 측정 버튼을 눌러야 실제 측정이 시작됩니다. 세션 중에는
          심박 상승 여부와 관계없이 원하는 시점에 직접 측정할 수도 있습니다.
        </Text>
        <Text className="text-sm leading-6 text-red-700">
          센서에 발열이 있으면 착용하거나 측정하지 마세요. 전원을 분리하고 배선·전압·센서 상태를
          먼저 확인하세요.
        </Text>
      </Section>
      <ActionButton
        disabled={!connected || !baselineReady || starting}
        label={
          starting
            ? '기기 시작 확인 중…'
            : !connected
              ? '먼저 기기를 연결하세요'
              : !baselineReady
                ? '기준값 측정 필요'
                : '심박 관찰 세션 시작'
        }
        onPress={() => void start()}
        size="lg"
      />
      <ActionButton
        disabled={!connected}
        label="먼저 개인 분해곡선 fitting 측정"
        onPress={() => router.push('/fitting')}
        variant="secondary"
      />
      {!baselineReady && (
        <ActionButton
          label="기준값 측정하기"
          onPress={() => router.push({ pathname: '/measure', params: { kind: 'baseline' } })}
          variant="secondary"
        />
      )}
      <ActionButton label="닫기" onPress={() => router.back()} variant="secondary" />
    </Screen>
  );
}

function SessionActive({
  session,
  connected,
  onEnd,
  onMeasureAlcohol,
  fittingProfile,
}: {
  session: SessionUiSnapshot;
  connected: boolean;
  onEnd: () => void;
  onMeasureAlcohol: () => void;
  fittingProfile: AlcoholFittingProfile | null;
}) {
  const status = session.status;
  const alcoholState = useAlcoholState();
  const [showAllAlcoholResults, setShowAllAlcoholResults] = useState(false);
  const recommended = status?.state === 'probe' && status.session_id.startsWith('fw-hrwatch-');
  const indexedAlcoholResults = session.alcoholResults.map((result, index) => ({ result, index }));
  const visibleAlcoholResults = showAllAlcoholResults
    ? indexedAlcoholResults
    : indexedAlcoholResults.slice(-1);

  return (
    <Screen>
      <Section eyebrow="진행 중" title="음주 세션">
        <StatusRow label="단계" value={sessionStateText(status?.state ?? null)} />
        <StatusRow label="경과" value={formatElapsed(status?.elapsed_ms ?? 0)} />
        <StatusRow label="기록 수" value={status ? String(status.records) : '-'} />
        <StatusRow
          label="안정 심박(R0)"
          value={status?.r0_bpm != null ? `${status.r0_bpm} BPM` : '-'}
        />
        <StatusRow
          label="최근 유효 심박"
          value={
            connected && status?.last_bpm != null
              ? `${status.last_bpm} BPM`
              : recommended
                ? '관찰 완료'
                : '유효 신호 대기'
          }
        />
      </Section>
      {status ? <PulseContactGuide sessionId={status.session_id} sessionMode /> : null}
      {status?.valid_minutes != null ? (
        <Section title="최근 10분 상승 판정">
          <StatusRow label="유효 구간" value={`${status.valid_minutes} / 10분`} />
          <StatusRow
            label={
              status.alerted_percent === 20
                ? '10% · 15% · 20% 기준 완료'
                : `다음 기준 +${status.next_threshold_percent ?? 10}%`
            }
            value={`${status.high_minutes ?? 0} / 8분 충족`}
          />
          <StatusRow
            label="최근 측정 권장"
            value={
              status.alerted_percent == null ? '아직 없음' : `baseline +${status.alerted_percent}%`
            }
          />
        </Section>
      ) : null}
      {alcoholState ? (
        <View className="gap-2 rounded-xl border border-blue-300 bg-blue-50 p-4">
          <Text className="font-semibold text-blue-950">{sessionAlcoholTitle(alcoholState)}</Text>
          <Text className="text-sm leading-6 text-blue-900">
            {sessionAlcoholHint(alcoholState)}
          </Text>
        </View>
      ) : null}
      {session.alcoholResults.length > 0 ? (
        <Section
          action={
            session.alcoholResults.length > 1 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showAllAlcoholResults }}
                onPress={() => setShowAllAlcoholResults((open) => !open)}>
                <Text className="text-sm font-semibold text-gray-700">
                  {showAllAlcoholResults ? '접기' : `더보기 (${session.alcoholResults.length})`}
                </Text>
              </Pressable>
            ) : null
          }
          eyebrow="Alcohol"
          title="측정별 분해 예상 시간">
          {visibleAlcoholResults.map(({ result, index }) => {
            const estimate =
              result.alcohol_mg_l_x1000 === null
                ? null
                : estimateExponentialSoberTime(result.alcohol_mg_l_x1000, fittingProfile);
            return (
              <StatusRow
                description={alcoholEstimateDescription(result.alcohol_mg_l_x1000, estimate)}
                key={`${result.elapsed_ms}-${index}`}
                label={
                  result.trigger_percent === null
                    ? `사용자 측정 · ${formatElapsed(result.elapsed_ms)}`
                    : `심박 +${result.trigger_percent}% · ${formatElapsed(result.elapsed_ms)}`
                }
                tone={result.alcohol_mg_l_x1000 === null ? 'caution' : 'neutral'}
                value={alcoholEstimateValue(result.alcohol_mg_l_x1000, estimate)}
              />
            );
          })}
        </Section>
      ) : null}
      {recommended && (
        <View className="gap-2 rounded-xl border border-amber-400 bg-amber-50 p-5">
          <Text className="text-lg font-semibold text-amber-900">알코올 측정을 권장합니다</Text>
          <Text className="text-sm leading-6 text-amber-900">
            개인 기준값보다 높은 심박이 지속되었습니다. 활동이나 긴장 등 다른 원인도 가능하므로 이
            결과만으로 음주 여부를 판단할 수 없습니다.
          </Text>
          <Text className="text-sm leading-6 text-amber-900">
            +10%, +15%, +20% 기준을 처음 충족하면 부저가 두 번 울리지만 측정은 아직 시작되지
            않습니다. GPIO 0 버튼이나 아래 측정 버튼을 누르세요. 센서가 Wait Blow 상태가 되면 부저가
            다시 두 번 울립니다.
          </Text>
        </View>
      )}
      <View className="border border-gray-200 p-4">
        <Text className="text-xs leading-5 text-gray-500">
          {connected
            ? '관찰은 ESP32에서 수행합니다. 휴대폰 화면이 꺼져 있을 때도 부저로 권장 시점을 알립니다. 권장 알림만으로 알코올 측정은 시작되지 않습니다.'
            : '연결이 끊어져 마지막 수신 상태를 표시하고 있습니다. 기기에서는 관찰이 계속되며, 최신 상태 확인과 기록 수신에는 재연결이 필요합니다.'}
        </Text>
      </View>
      <ActionButton
        disabled={!connected || session.alcoholMeasurementPending}
        label={
          session.alcoholMeasurementPending
            ? '알코올 측정 진행 중…'
            : connected
              ? recommended
                ? '권장된 알코올 측정 시작'
                : '지금 알코올 측정'
              : '수동 측정에는 기기 연결이 필요합니다'
        }
        onPress={onMeasureAlcohol}
        size="lg"
      />
      <ActionButton
        disabled={!connected || session.alcoholMeasurementPending}
        label={connected ? '세션 종료 및 전체 기록 저장' : '데이터 수신엔 연결이 필요합니다'}
        onPress={onEnd}
        variant="secondary"
      />
    </Screen>
  );
}

function SessionDownloading({ session }: { session: SessionUiSnapshot }) {
  return (
    <Screen>
      <Section eyebrow="다운로드" title="세션 데이터를 받는 중">
        <StatusRow
          label="수신"
          value={
            session.total > 0 ? `${session.received} / ${session.total}` : `${session.received}`
          }
        />
      </Section>
      <View className="border border-gray-200 p-4">
        <Text className="text-xs leading-5 text-gray-500">
          기기가 저장한 기록을 전송하고 있습니다. 잠시만 기다려 주세요.
        </Text>
      </View>
    </Screen>
  );
}

function SessionComplete({
  session,
  onClose,
  onRestart,
  connected,
  starting,
}: {
  session: SessionUiSnapshot;
  onClose: () => void;
  onRestart: () => void;
  connected: boolean;
  starting: boolean;
}) {
  const result = session.result;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#ffffff' }}>
      <Screen>
        <Section eyebrow="완료" title={result ? '심박 세션 저장됨' : '세션 저장 실패'}>
          <StatusRow label="받은 기록" value={String(session.received)} />
        </Section>
        <View className="border border-gray-200 p-4">
          <Text className="text-xs leading-5 text-gray-500">
            {result
              ? '심박과 세션 중 알코올 측정 기록이 저장됐습니다.'
              : '세션 데이터를 저장하지 못했습니다.'}
          </Text>
        </View>
        <ActionButton
          disabled={!connected || starting}
          label={
            starting
              ? '새 측정 시작 중…'
              : connected
                ? '새 음주 세션 측정 시작'
                : '새 측정에는 기기 연결이 필요합니다'
          }
          onPress={onRestart}
          size="lg"
        />
        <ActionButton label="닫기" onPress={onClose} variant="secondary" />
      </Screen>
    </SafeAreaView>
  );
}

function sessionStateText(state: SessionStateLabel | null) {
  switch (state) {
    case 'dormant':
      return 'baseline 대비 심박 관찰';
    case 'probe':
      return '지속 상승 · 알코올 측정 권장';
    case 'track':
      return '하강 추적';
    case null:
      return '준비 중';
  }
}

function sessionAlcoholTitle(state: AlcoholStateLabel) {
  if (state === 'preheating' || state === 'idle') return '알코올 센서를 준비하는 중입니다';
  if (state === 'wait_blow') return '지금 센서에 입김을 불어주세요';
  if (state === 'blowing') return '입김을 계속 유지해 주세요';
  if (state === 'calculating' || state === 'read_result') return '알코올 값을 계산하는 중입니다';
  return '입김이 충분하지 않습니다';
}

function sessionAlcoholHint(state: AlcoholStateLabel) {
  if (state === 'wait_blow') return '두 번째 부저 알림 후 4초 동안 일정하고 세게 불어주세요.';
  if (state === 'blowing') return '센서가 완료 신호를 보낼 때까지 멈추지 마세요.';
  if (state === 'blow_interrupted')
    return '입김이 중단되었습니다. 다음 측정 알림 때 다시 시도합니다.';
  return '센서를 준비하고 있습니다. Wait Blow 진입을 알리는 두 번째 부저를 기다려주세요.';
}

function formatElapsed(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function alcoholEstimateDescription(
  alcoholMgLX1000: number | null,
  estimate: ReturnType<typeof estimateExponentialSoberTime>
) {
  if (alcoholMgLX1000 === null) {
    return '센서가 제한 시간 안에 유효한 값을 반환하지 못했습니다. 버튼으로 다시 측정할 수 있습니다.';
  }
  if (estimate === null) {
    return `BrAC ${(alcoholMgLX1000 / 1000).toFixed(3)} mg/L · 저장된 개인 분해속도가 없어 해소 예상 시간을 계산하지 않았습니다.`;
  }
  return `BrAC ${(alcoholMgLX1000 / 1000).toFixed(3)} mg/L · 지수 k=${estimate.kPerMinute.toFixed(6)}/분 적용 · 범위 ${estimate.earliestMinutes}~${estimate.latestMinutes}분. 추가 음주·흡수 중에는 더 길어질 수 있습니다.`;
}

function alcoholEstimateValue(
  alcoholMgLX1000: number | null,
  estimate: ReturnType<typeof estimateExponentialSoberTime>
) {
  if (alcoholMgLX1000 === null) return '측정 실패 · 재시도 가능';
  return estimate === null ? '추정 불가' : `약 ${formatEstimateMinutes(estimate.minutes)}`;
}

function formatEstimateMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}시간` : `${hours}시간 ${remainder}분`;
}
