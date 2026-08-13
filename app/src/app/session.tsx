import { useKeepAwake } from 'expo-keep-awake';
import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionButton } from '@/components/action-button';
import { Screen } from '@/components/screen';
import { Section } from '@/components/section';
import { StatusRow } from '@/components/status-row';
import { useBleSession, useSession, type SessionUiSnapshot } from '@/lib/ble/session';
import type { SessionStateLabel } from '@/lib/ble/model';

/**
 * 음주 세션은 ESP32가 자율 실행한다. 폰은 시작만 지시하고 잠가도 되며,
 * 종료할 때 다시 연결해 데이터를 받는다.
 */
export default function SessionRoute() {
  const router = useRouter();
  const ble = useBleSession();
  const session = useSession();
  const connected = ble.connection.phase === 'connected';

  if (session.phase === 'complete') {
    return <SessionComplete session={session} onClose={() => router.back()} />;
  }

  if (session.phase === 'downloading') {
    return <SessionDownloading session={session} />;
  }

  if (session.phase === 'active') {
    return <SessionActive session={session} connected={connected} onEnd={() => void ble.endSession()} />;
  }

  return (
    <Screen>
      <Section eyebrow="Session" title="음주 세션 측정">
        <StatusRow
          description="기기가 심박을 계속 관찰하다가 음주가 감지되면 부저로 알코올 측정을 안내합니다. 측정 중에는 휴대폰을 꺼두어도 됩니다."
          label="자동 측정"
          value="ESP32"
        />
        <StatusRow
          description="세션을 마칠 때 이 화면에서 데이터를 받아옵니다."
          label="종료 시"
          value="데이터 다운로드"
        />
      </Section>
      <ActionButton
        disabled={!connected}
        label={connected ? '세션 시작' : '먼저 기기를 연결하세요'}
        onPress={() => void ble.startSession()}
        size="lg"
      />
      <ActionButton label="닫기" onPress={() => router.back()} variant="secondary" />
    </Screen>
  );
}

function SessionActive({
  session,
  connected,
  onEnd,
}: {
  session: SessionUiSnapshot;
  connected: boolean;
  onEnd: () => void;
}) {
  // 세션이 도는 동안 화면을 켜둘 필요는 없지만, 이 화면을 보고 있는 동안은 유지한다.
  useKeepAwake();
  const status = session.status;

  return (
    <Screen>
      <Section eyebrow="진행 중" title="음주 세션">
        <StatusRow label="단계" value={sessionStateText(status?.state ?? null)} />
        <StatusRow label="경과" value={formatElapsed(status?.elapsed_ms ?? 0)} />
        <StatusRow label="기록 수" value={status ? String(status.records) : '-'} />
        <StatusRow label="안정 심박(R0)" value={status?.r0_bpm != null ? `${status.r0_bpm} BPM` : '-'} />
        <StatusRow label="최근 심박" value={status?.last_bpm != null ? `${status.last_bpm} BPM` : '-'} />
      </Section>
      <View className="border border-gray-200 p-4">
        <Text className="text-xs leading-5 text-gray-500">
          측정은 기기에서 계속됩니다. 휴대폰을 꺼두었다가, 세션을 마칠 때 다시 열어 종료를
          누르면 데이터를 받아옵니다.
        </Text>
      </View>
      <ActionButton
        disabled={!connected}
        label={connected ? '세션 종료 & 데이터 받기' : '데이터 수신엔 연결이 필요합니다'}
        onPress={onEnd}
        size="lg"
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
          value={session.total > 0 ? `${session.received} / ${session.total}` : `${session.received}`}
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
}: {
  session: SessionUiSnapshot;
  onClose: () => void;
}) {
  const result = session.result;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#ffffff' }}>
      <Screen>
        <Section eyebrow="완료" title="세션 저장됨">
          <StatusRow label="받은 기록" value={String(session.received)} />
          <StatusRow label="이번 분해속도" value={formatElimination(result?.eliminationMgLPerHourX1000 ?? null)} />
          <StatusRow
            label="누적 세션"
            value={result ? `${result.sessionsCounted}개 (유효 ${result.validCount})` : '-'}
          />
          <StatusRow
            label="개인 분해속도 반영"
            tone={result?.appliedEliminationMgLPerHourX1000 != null ? 'safe' : 'neutral'}
            value={
              result?.appliedEliminationMgLPerHourX1000 != null
                ? formatElimination(result.appliedEliminationMgLPerHourX1000)
                : '세션 3개 이상 필요'
            }
          />
        </Section>
        <View className="border border-gray-200 p-4">
          <Text className="text-xs leading-5 text-gray-500">
            {result
              ? '이번 세션이 저장됐습니다. 세션이 3개 이상 모이면 분해속도 평균이 결과 계산에 반영됩니다.'
              : '세션 데이터를 저장하지 못했습니다.'}
          </Text>
        </View>
        <ActionButton label="닫기" onPress={onClose} size="lg" />
      </Screen>
    </SafeAreaView>
  );
}

function sessionStateText(state: SessionStateLabel | null) {
  switch (state) {
    case 'dormant':
      return '대기 · 음성 관찰';
    case 'probe':
      return '상승 감지 · 확인 필요';
    case 'track':
      return '하강 추적';
    case null:
      return '준비 중';
  }
}

/** mg/L per hour ×1000 → 사람이 읽는 mg/L/h. */
function formatElimination(mgLPerHourX1000: number | null) {
  if (mgLPerHourX1000 === null) {
    return '추정 불가';
  }

  return `${(mgLPerHourX1000 / 1000).toFixed(3)} mg/L·h`;
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
