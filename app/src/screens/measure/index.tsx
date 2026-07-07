import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';

import { ActionButton } from '@/components/action-button';
import { ActionLink } from '@/components/action-link';
import { Screen } from '@/components/screen';
import { Section } from '@/components/section';
import { StatusRow } from '@/components/status-row';
import type { MeasurementStep } from '@/lib/ble/model';
import { hasActiveMeasurement } from '@/lib/ble/measurement-phase';
import { resolveMeasureRoute, shouldShowResultPreview } from '@/lib/ble/measure-route';
import { useBleSession } from '@/lib/ble/session';
import {
  measurementReadinessDescription,
  measurementStartBlocker,
} from '@/lib/ble/start-readiness';
import { isProfileComplete } from '@/lib/personalization/profile-context';
import { readBaseline, readProfile } from '@/lib/storage/profile';

const steps: MeasurementStep[] = [
  'preparing',
  'warming_sensor',
  'waiting_breath',
  'sampling_breath',
  'sampling_pulse',
  'analyzing',
  'done',
];

export function MeasureScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const ble = useBleSession();
  const initializeBle = ble.initialize;
  const [contextReady, setContextReady] = useState(false);
  const [contextLoadFailed, setContextLoadFailed] = useState(false);
  const routeSessionId = sessionId ?? 'live';
  const isBaseline = routeSessionId === 'baseline';
  const {
    progress: routeProgress,
    result: routeResult,
    activeSessionId,
    routeMatchesActive,
  } = resolveMeasureRoute({
    routeSessionId,
    activeMeasurementKind: ble.activeMeasurementKind,
    activeSessionId: ble.activeSessionId,
    progress: ble.progress,
    result: ble.result,
  });
  const activeStep = routeResult ? 'done' : routeProgress?.step;
  const measurementActive = hasActiveMeasurement(ble);
  const canCancel = ble.connectedDevice && ble.activeSessionId !== null && measurementActive;
  const nextMeasurementKind =
    ble.measurementPhase === 'error'
      ? ble.activeMeasurementKind
      : isBaseline
        ? 'baseline'
        : 'measurement';
  const startBlocker = measurementStartBlocker({
    connected: Boolean(ble.connectedDevice),
    activeMeasurement: measurementActive,
    contextReady: nextMeasurementKind === 'baseline' || contextReady,
    mockMode: ble.mockMode,
  });
  const showStartButton =
    Boolean(ble.connectedDevice) &&
    (ble.measurementPhase === 'idle' || ble.measurementPhase === 'error');
  const canStartMeasurement = showStartButton && startBlocker === null;
  const resultHref = routeResult
    ? `/results/${routeResult.session_id}`
    : isBaseline
      ? '/results/baseline-demo'
      : '/results/demo-result';
  const showPreviewLink = shouldShowResultPreview({
    hasResult: Boolean(routeResult),
    hasActiveMeasurement: measurementActive,
  });

  useEffect(() => {
    initializeBle();
  }, [initializeBle]);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;

      Promise.all([readProfile(), readBaseline()])
        .then(([profile, baseline]) => {
          if (!mounted) {
            return;
          }

          setContextReady(baseline.sample_count > 0 || isProfileComplete(profile));
          setContextLoadFailed(false);
        })
        .catch(() => {
          if (mounted) {
            setContextReady(false);
            setContextLoadFailed(true);
          }
        });

      return () => {
        mounted = false;
      };
    }, [])
  );

  return (
    <Screen>
      <Section eyebrow="Session" title={isBaseline ? 'Baseline 측정' : activeSessionId}>
        <StatusRow label="세션 종류" value={isBaseline ? 'Baseline' : '일반 측정'} />
        <StatusRow
          label="연결 상태"
          value={ble.connectedDevice ? '연결됨' : '미연결'}
          description={ble.connectedDevice?.name ?? 'Drunksafe 장치 연결이 필요합니다.'}
          tone={ble.connectedDevice ? 'safe' : 'caution'}
        />
        <StatusRow
          label="진행률"
          value={`${routeResult ? 100 : (routeProgress?.percent ?? 0)}%`}
          description={measurementReadinessDescription({
            routeMatchesActive,
            activeMeasurement: measurementActive,
            hasResult: Boolean(routeResult),
            message: ble.message,
            blocker: startBlocker,
            contextLoadFailed,
          })}
          tone={routeResult ? 'safe' : ble.measurementPhase === 'error' ? 'danger' : 'caution'}
        />
        {ble.deviceErrorCode ? (
          <StatusRow label="오류" value={ble.deviceErrorCode} tone="danger" />
        ) : null}
      </Section>

      <Section eyebrow="Progress" title="측정 단계">
        {steps.map((step) => {
          const value = stepValue(step, activeStep);

          return (
            <StatusRow
              key={step}
              label={stepLabel[step]}
              value={value}
              tone={value === '완료' ? 'safe' : value === '진행 중' ? 'caution' : 'neutral'}
            />
          );
        })}
      </Section>

      {showStartButton ? (
        <ActionButton
          label={ble.measurementPhase === 'error' ? '다시 측정' : '측정 시작'}
          disabled={!canStartMeasurement}
          onPress={() => {
            if (!canStartMeasurement) {
              return;
            }

            void ble.startMeasurement(nextMeasurementKind);
          }}
        />
      ) : null}
      {canCancel ? (
        <ActionButton
          label="측정 취소"
          variant="secondary"
          onPress={() => {
            void ble.cancelMeasurement();
          }}
        />
      ) : null}
      {routeResult ? (
        <ActionLink href={resultHref} label="결과 보기" />
      ) : showPreviewLink ? (
        <ActionLink href={resultHref} label="데모 결과 미리보기" variant="secondary" />
      ) : null}
      {!ble.connectedDevice ? (
        <ActionLink href="/" label="장치 연결로 돌아가기" variant="secondary" />
      ) : null}
    </Screen>
  );
}

const stepLabel: Record<MeasurementStep, string> = {
  preparing: '준비',
  warming_sensor: '센서 예열',
  waiting_breath: '호기 대기',
  sampling_breath: '호기 측정',
  sampling_pulse: 'Pulse 측정',
  analyzing: '분석',
  done: '완료',
};

function stepValue(
  step: MeasurementStep,
  activeStep: MeasurementStep | undefined
): '완료' | '진행 중' | '대기' {
  if (!activeStep) {
    return '대기';
  }

  const stepIndex = steps.findIndex((item) => item === step);
  const activeIndex = steps.findIndex((item) => item === activeStep);

  if (stepIndex < activeIndex || activeStep === 'done') {
    return '완료';
  }

  if (stepIndex === activeIndex) {
    return '진행 중';
  }

  return '대기';
}
