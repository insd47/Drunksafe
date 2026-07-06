import { useEffect } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { ActionButton } from '@/components/action-button';
import { ActionLink } from '@/components/action-link';
import { Screen } from '@/components/screen';
import { Section } from '@/components/section';
import { StatusRow } from '@/components/status-row';
import type { MeasurementStep } from '@/lib/ble/model';
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
  const routeMatchesActive = routeSessionId === 'live' || routeSessionId === ble.activeSessionId;
  const routeProgress = routeMatchesActive ? ble.progress : null;
  const routeResult =
    routeSessionId === 'live'
      ? ble.result
      : routeSessionId !== 'live' && ble.result?.session_id === routeSessionId
        ? ble.result
        : null;
  const activeSessionId =
    routeSessionId === 'live'
      ? (routeResult?.session_id ?? routeProgress?.session_id ?? 'live')
      : routeSessionId;
  const activeStep = routeResult ? 'done' : routeProgress?.step;
  const resultHref = routeResult
    ? `/results/${routeResult.session_id}`
    : isBaseline
      ? '/results/baseline-demo'
      : '/results/demo-result';

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

      {ble.connectedDevice && ble.measurementPhase === 'idle' ? (
        <ActionButton
          label="측정 시작"
          onPress={() => {
            void ble.startMeasurement(isBaseline ? 'baseline' : 'measurement');
          }}
        />
      ) : null}
      {routeResult ? (
        <ActionLink href={resultHref} label="결과 보기" />
      ) : (
        <ActionLink href={resultHref} label="결과 화면 미리보기" variant="secondary" />
      )}
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
