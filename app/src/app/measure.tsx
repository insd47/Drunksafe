import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { useKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionButton } from '@/components/action-button';
import { PulseContactGuide } from '@/components/pulse-contact-guide';
import { deviceErrorCopy } from '@/components/device-error-copy';
import type { AlcoholStateLabel } from '@/lib/ble/model';
import { useAlcoholState, useBleSession } from '@/lib/ble/session';

const slowBreathSeconds = 20;

/** 측정 시작 소유권은 이 라우트 하나에 있다 — 진입하면 시작하고, 결과가 오면 결과 화면으로 바꾼다. */
export default function MeasureRoute() {
  useKeepAwake();

  const router = useRouter();
  const params = useLocalSearchParams<{ kind?: string }>();
  const ble = useBleSession();
  const initialize = ble.initialize;
  const startMeasurement = ble.startMeasurement;
  const startPulsePhase = ble.startPulsePhase;
  const cancelMeasurement = ble.cancelMeasurement;
  const kind = params.kind === 'baseline' ? 'baseline' : 'measurement';
  const measurement = ble.measurement;
  const alcoholState = useAlcoholState();
  const activeMeasurement =
    measurement.phase === 'starting' ||
    measurement.phase === 'active' ||
    measurement.phase === 'awaiting_pulse';
  const stage = measurement.phase === 'active' ? measurement.stage : null;
  const activeStartedAt = measurement.phase === 'active' ? measurement.startedAtUnixMs : null;
  const timeoutMeasurement = ble.timeoutMeasurement;
  const resultSessionId = measurement.phase === 'result' ? measurement.record.session_id : null;
  const errorCode = measurement.phase === 'error' ? measurement.code : null;
  const elapsedSeconds = useElapsedSeconds(
    measurement.phase === 'active' ? measurement.startedAtUnixMs : null
  );
  const requested = useRef(false);
  const staleResultSessionId = useRef(resultSessionId);
  const close = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/');
  }, [router]);

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (requested.current) {
      return;
    }

    requested.current = true;

    if (activeMeasurement) {
      return;
    }

    void startMeasurement(kind);
  }, [activeMeasurement, kind, startMeasurement]);

  useEffect(() => {
    if (!resultSessionId || resultSessionId === staleResultSessionId.current) {
      return;
    }

    router.replace({ pathname: '/results/[id]', params: { id: resultSessionId } });
  }, [resultSessionId, router]);

  useEffect(() => {
    if (errorCode !== 'cancelled') {
      return;
    }

    close();
  }, [errorCode, close]);

  // 안전장치: 기기 결과 이벤트가 유실돼도 화면이 무한히 '측정 중'에 머물지 않도록,
  // 단계별 펌웨어 타임아웃(+여유) 후에는 앱이 스스로 타임아웃 처리한다.
  useEffect(() => {
    if (activeStartedAt === null) {
      return;
    }

    const limitMs = (stage === 'pulse' ? 85 : 50) * 1000;
    const timer = setTimeout(
      () => {
        void timeoutMeasurement();
      },
      Math.max(0, limitMs - (Date.now() - activeStartedAt))
    );

    return () => {
      clearTimeout(timer);
    };
  }, [activeStartedAt, stage, timeoutMeasurement]);

  function cancel() {
    void cancelMeasurement();
    close();
  }

  if (errorCode !== null && errorCode !== 'cancelled') {
    const copy = deviceErrorCopy(errorCode);

    return (
      <MeasureLayout>
        <MeasureNotice icon={copy.icon} message={copy.action} title={copy.title} />
        <MeasureFooter>
          <ActionButton
            label="다시 측정"
            onPress={() => {
              void startMeasurement(kind);
            }}
            size="lg"
          />
          <ActionButton label="닫기" onPress={close} variant="secondary" />
        </MeasureFooter>
      </MeasureLayout>
    );
  }

  const connected = ble.connection.phase === 'connected';

  if (ble.connection.phase === 'error' || (!connected && !activeMeasurement)) {
    return (
      <MeasureLayout>
        <MeasureNotice
          icon="📡"
          message="기기를 가까이 두고 홈에서 다시 연결하세요."
          title="기기와 연결되어 있지 않습니다"
        />
        <MeasureFooter>
          <ActionButton label="닫기" onPress={close} size="lg" variant="secondary" />
        </MeasureFooter>
      </MeasureLayout>
    );
  }

  if (measurement.phase === 'awaiting_pulse') {
    return (
      <MeasureLayout>
        <MeasureNotice
          icon="💓"
          message="이제 심박을 측정합니다. 센서에 손끝을 가만히 대고 준비되면 시작을 누르세요."
          title="알코올 측정 완료"
        />
        <MeasureFooter>
          <ActionButton
            label="심박 측정 시작"
            onPress={() => {
              void startPulsePhase();
            }}
            size="lg"
          />
          <ActionButton label="취소" onPress={cancel} variant="secondary" />
        </MeasureFooter>
      </MeasureLayout>
    );
  }

  const started = measurement.phase === 'active';
  const isPulseStage = stage === 'pulse';
  const alcohol = started && stage === 'alcohol' ? alcoholCopy(alcoholState) : null;

  const title =
    measurement.phase === 'starting'
      ? '기기를 준비하는 중입니다'
      : isPulseStage
        ? '심박을 측정하는 중입니다'
        : (alcohol?.title ?? '숨을 크게 들이쉬고 4초간 세게 부세요');
  const hint = isPulseStage
    ? '센서에 손끝을 가만히 대고 있으세요.'
    : (alcohol?.hint ?? coachingHint(started, elapsedSeconds));

  return (
    <MeasureLayout>
      <View className="flex-row justify-end px-5 py-3">
        <Pressable accessibilityRole="button" onPress={cancel}>
          <Text className="text-sm font-semibold text-gray-500">취소</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 20,
          paddingHorizontal: 24,
          paddingVertical: 16,
        }}>
        <View className="gap-3">
          <Text className="text-center text-2xl font-bold leading-9 text-gray-950">{title}</Text>
          <Text className="text-center text-sm leading-6 text-gray-500">{hint}</Text>
        </View>

        <ElapsedRing seconds={elapsedSeconds} />
        {isPulseStage && measurement.phase === 'active' && (
          <PulseContactGuide sessionId={measurement.sessionId} />
        )}

        <Text className="text-xs text-gray-400">
          {isPulseStage
            ? '심박 측정 · 최대 1분'
            : kind === 'baseline'
              ? '기준값 측정 · 최대 30초'
              : '알코올 측정 · 최대 30초'}
        </Text>
      </ScrollView>

      <MeasureFooter>
        <ActionButton label="측정 취소" onPress={cancel} variant="secondary" />
      </MeasureFooter>
    </MeasureLayout>
  );
}

function MeasureLayout({ children }: PropsWithChildren) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#ffffff' }}>
      <View className="flex-1">{children}</View>
    </SafeAreaView>
  );
}

function MeasureFooter({ children }: PropsWithChildren) {
  return <View className="gap-3 px-5 pb-5">{children}</View>;
}

function MeasureNotice({ icon, title, message }: { icon: string; title: string; message: string }) {
  return (
    <View className="flex-1 items-center justify-center gap-4 px-8">
      <Text className="text-5xl">{icon}</Text>
      <Text className="text-center text-2xl font-bold text-gray-950">{title}</Text>
      <Text className="text-center text-sm leading-6 text-gray-600">{message}</Text>
    </View>
  );
}

function ElapsedRing({ seconds }: { seconds: number }) {
  const rotation = useSharedValue(0);
  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 1400, easing: Easing.linear }),
      -1,
      false
    );
  }, [rotation]);

  return (
    <View style={{ width: 160, height: 160, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: 160,
            height: 160,
            borderRadius: 80,
            borderWidth: 6,
            borderColor: '#e5e7eb',
            borderTopColor: '#030712',
          },
          ringStyle,
        ]}
      />
      <Text className="text-3xl font-semibold text-gray-950">{formatElapsed(seconds)}</Text>
    </View>
  );
}

/** 측정 시작 시각은 세션이 들고 있으므로 화면은 현재 시각만 흘려보내면 된다. */
function useElapsedSeconds(startedAtUnixMs: number | null) {
  const [nowUnixMs, setNowUnixMs] = useState(() => Date.now());

  useEffect(() => {
    if (startedAtUnixMs === null) {
      return;
    }

    const timer = setInterval(() => {
      setNowUnixMs(Date.now());
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [startedAtUnixMs]);

  if (startedAtUnixMs === null) {
    return 0;
  }

  return Math.max(0, Math.floor((nowUnixMs - startedAtUnixMs) / 1000));
}

/** ZE29A 상태에 맞춰 "지금 부세요" 타이밍을 안내한다 (예열 중엔 불지 않도록). */
function alcoholCopy(state: AlcoholStateLabel | null): { title: string; hint: string } {
  switch (state) {
    case 'preheating':
      return { title: '센서 예열 중', hint: '잠시만 기다리세요. 곧 불라고 안내합니다.' };
    case 'wait_blow':
      return { title: '지금 세게 부세요!', hint: '2초 이상 끊지 말고 세게 부세요.' };
    case 'blowing':
      return { title: '계속 부세요!', hint: '멈추지 마세요.' };
    case 'blow_interrupted':
      return { title: '입김이 끊겼어요', hint: '다시 준비 중입니다. 신호가 오면 세게 부세요.' };
    case 'calculating':
      return { title: '계산 중…', hint: '잠시만 기다려 주세요.' };
    case 'read_result':
      return { title: '측정 완료', hint: '결과를 불러오는 중입니다.' };
    case 'idle':
    case 'unknown':
    case null:
      return { title: '측정을 준비하는 중입니다', hint: '곧 예열이 시작됩니다.' };
  }
}

function coachingHint(started: boolean, elapsedSeconds: number) {
  if (!started) {
    return '잠시만 기다려 주세요.';
  }

  if (elapsedSeconds >= slowBreathSeconds) {
    return '센서가 아직 반응하지 않습니다. 마우스피스에 더 가까이 대고 다시 부세요.';
  }

  return '마우스피스에 입을 붙이고 끊지 말고 부세요.';
}

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}
