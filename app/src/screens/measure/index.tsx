import { useEffect } from 'react';
import { useLocalSearchParams } from 'expo-router';

import ActionButton from '@/components/action-button';
import ActionLink from '@/components/action-link';
import Screen from '@/components/screen';
import { hasActiveMeasurement } from '@/lib/ble/measurement-phase';
import {
  resolveMeasureKind,
  resolveMeasureRoute,
  shouldShowResultPreview,
} from '@/lib/ble/measure-route';
import { useBleSession } from '@/lib/ble/session';
import { measurementStartBlocker } from '@/lib/ble/start-readiness';
import { recordFromResult } from '@/lib/storage/history';
import ProgressSection from '@/screens/measure/_views/progress';
import SessionSection from '@/screens/measure/_views/session';
import useContextReadiness from '@/screens/measure/use-context-readiness';

export default function MeasureScreen() {
  const { sessionId = 'live' } = useLocalSearchParams<{ sessionId: string }>();
  const ble = useBleSession();
  const initializeBle = ble.initialize;
  const context = useContextReadiness();
  const route = resolveMeasureRoute({
    routeSessionId: sessionId,
    activeMeasurementKind: ble.activeMeasurementKind,
    activeSessionId: ble.activeSessionId,
    progress: ble.progress,
    result: ble.result,
  });
  const active = hasActiveMeasurement(ble);
  const nextKind = resolveMeasureKind({
    routeSessionId: sessionId,
    activeSessionId: ble.activeSessionId,
    activeMeasurementKind: ble.activeMeasurementKind,
  });
  const baseline = nextKind === 'baseline';
  const blocker = measurementStartBlocker({
    connected: Boolean(ble.connectedDevice && ble.connectionPhase === 'connected'),
    activeMeasurement: active,
    contextReady: nextKind === 'baseline' || context.ready,
    mockMode: ble.mockMode,
  });
  const showStart =
    Boolean(ble.connectedDevice) &&
    (ble.measurementPhase === 'idle' || ble.measurementPhase === 'error');
  const canCancel = Boolean(ble.connectedDevice && ble.activeSessionId && active);
  const resultHref = route.result
    ? `/results/${recordFromResult(route.result).id}`
    : baseline
      ? '/results/baseline-demo'
      : '/results/demo-result';

  useEffect(() => {
    initializeBle();
  }, [initializeBle]);

  return (
    <Screen>
      <SessionSection
        ble={ble}
        baseline={baseline}
        sessionId={route.activeSessionId}
        progress={route.result ? 100 : (route.progress?.percent ?? 0)}
        hasResult={Boolean(route.result)}
        routeMatchesActive={route.routeMatchesActive}
        active={active}
        blocker={blocker}
        contextLoadFailed={context.failed}
      />
      <ProgressSection activeStep={route.result ? 'done' : route.progress?.step} />

      {showStart ? (
        <ActionButton
          label={ble.measurementPhase === 'error' ? '다시 측정' : '측정 시작'}
          disabled={blocker !== null}
          onPress={() => {
            if (!blocker) void ble.startMeasurement(nextKind);
          }}
        />
      ) : null}
      {canCancel ? (
        <ActionButton
          label="측정 취소"
          variant="secondary"
          onPress={() => void ble.cancelMeasurement()}
        />
      ) : null}
      {route.result ? (
        <ActionLink href={resultHref} label="결과 보기" />
      ) : shouldShowResultPreview({ hasResult: false, hasActiveMeasurement: active }) ? (
        <ActionLink href={resultHref} label="데모 결과 미리보기" variant="secondary" />
      ) : null}
      {!ble.connectedDevice ? (
        <ActionLink href="/" label="장치 연결로 돌아가기" variant="secondary" />
      ) : null}
    </Screen>
  );
}
