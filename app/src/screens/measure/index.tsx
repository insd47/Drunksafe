import { useEffect } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { ActionButton } from '@/components/action-button';
import { ActionLink } from '@/components/action-link';
import { Screen } from '@/components/screen';
import { Section } from '@/components/section';
import { StatusRow } from '@/components/status-row';
import type { MeasurementStep } from '@/lib/ble/model';
import { hasActiveMeasurement } from '@/lib/ble/measurement-phase';
import { resolveMeasureRoute, shouldShowResultPreview } from '@/lib/ble/measure-route';
import { useBleSession } from '@/lib/ble/session';

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
  const canStartMeasurement =
    ble.connectedDevice && (ble.measurementPhase === 'idle' || ble.measurementPhase === 'error');
  const nextMeasurementKind =
    ble.measurementPhase === 'error'
      ? ble.activeMeasurementKind
      : isBaseline
        ? 'baseline'
        : 'measurement';
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
          description={
            routeMatchesActive ? (ble.message ?? 'BLE notify를 기다리는 중입니다.') : '대기 중'
          }
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

      {canStartMeasurement ? (
        <ActionButton
          label={ble.measurementPhase === 'error' ? '다시 측정' : '측정 시작'}
          onPress={() => {
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
