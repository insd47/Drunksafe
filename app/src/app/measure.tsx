import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { useKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionButton } from '@/components/action-button';
import { deviceErrorCopy } from '@/components/device-error-copy';
import { hasActiveMeasurement } from '@/lib/ble/measurement-phase';
import { useBleSession } from '@/lib/ble/session';

const slowBreathSeconds = 20;

/** 측정 시작 소유권은 이 라우트 하나에 있다 — 진입하면 시작하고, 결과가 오면 결과 화면으로 바꾼다. */
export default function MeasureRoute() {
  useKeepAwake();

  const router = useRouter();
  const params = useLocalSearchParams<{ kind?: string }>();
  const ble = useBleSession();
  const initialize = ble.initialize;
  const startMeasurement = ble.startMeasurement;
  const cancelMeasurement = ble.cancelMeasurement;
  const kind = params.kind === 'baseline' ? 'baseline' : 'measurement';
  const activeMeasurement = hasActiveMeasurement(ble);
  const resultSessionId = ble.result?.session_id ?? null;
  const elapsedSeconds = useElapsedSeconds(ble.activeSessionId);
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
    if (ble.deviceErrorCode !== 'cancelled') {
      return;
    }

    close();
  }, [ble.deviceErrorCode, close]);

  function cancel() {
    void cancelMeasurement();
    close();
  }

  if (ble.deviceErrorCode && ble.deviceErrorCode !== 'cancelled') {
    const copy = deviceErrorCopy(ble.deviceErrorCode);

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

  if (ble.connectionPhase === 'error' || (!ble.connectedDevice && !activeMeasurement)) {
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

  const started = ble.activeSessionId !== null && activeMeasurement;

  return (
    <MeasureLayout>
      <View className="flex-row justify-end px-5 py-3">
        <Pressable accessibilityRole="button" onPress={cancel}>
          <Text className="text-sm font-semibold text-gray-500">취소</Text>
        </Pressable>
      </View>

      <View className="flex-1 items-center justify-center gap-10 px-8">
        <View className="gap-3">
          <Text className="text-center text-2xl font-bold leading-9 text-gray-950">
            {started ? '숨을 크게 들이쉬고 4초간 세게 부세요' : '기기를 준비하는 중입니다'}
          </Text>
          <Text className="text-center text-sm leading-6 text-gray-500">
            {coachingHint(started, elapsedSeconds)}
          </Text>
        </View>

        <ElapsedRing seconds={elapsedSeconds} />

        <Text className="text-xs text-gray-400">
          {kind === 'baseline' ? '기준값 측정 · 최대 30초' : '최대 30초'}
        </Text>
      </View>

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

/** measurement_started 수신 시각을 기준으로 앱이 직접 경과 시간을 센다. */
function useElapsedSeconds(sessionId: string | null) {
  const [elapsed, setElapsed] = useState<Elapsed>({ sessionId: null, seconds: 0 });

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    const startedAt = Date.now();
    const timer = setInterval(() => {
      setElapsed({ sessionId, seconds: Math.floor((Date.now() - startedAt) / 1000) });
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [sessionId]);

  return elapsed.sessionId === sessionId ? elapsed.seconds : 0;
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

type Elapsed = {
  sessionId: string | null;
  seconds: number;
};
