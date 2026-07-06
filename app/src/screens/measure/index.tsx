import { useLocalSearchParams } from 'expo-router';

import { ActionLink } from '@/components/action-link';
import { Screen } from '@/components/screen';
import { Section } from '@/components/section';
import { StatusRow } from '@/components/status-row';
import type { MeasurementStep } from '@/lib/ble/model';

const steps: { step: MeasurementStep; value: '완료' | '진행 중' | '대기' }[] = [
  { step: 'preparing', value: '완료' },
  { step: 'warming_sensor', value: '완료' },
  { step: 'waiting_breath', value: '진행 중' },
  { step: 'sampling_breath', value: '대기' },
  { step: 'sampling_pulse', value: '대기' },
  { step: 'analyzing', value: '대기' },
  { step: 'done', value: '대기' },
];

export function MeasureScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const isBaseline = sessionId === 'baseline';

  return (
    <Screen>
      <Section eyebrow="Session" title={isBaseline ? 'Baseline 측정' : (sessionId ?? '측정')}>
        <StatusRow label="세션 종류" value={isBaseline ? 'Baseline' : '일반 측정'} />
        <StatusRow
          label="연결 상태"
          value="연결됨"
          description="BLE notify를 기다리는 중입니다."
          tone="safe"
        />
        <StatusRow
          label="진행률"
          value="48%"
          description="호기 입력을 기다립니다."
          tone="caution"
        />
      </Section>

      <Section eyebrow="Progress" title="측정 단계">
        {steps.map(({ step, value }) => (
          <StatusRow
            key={step}
            label={stepLabel[step]}
            value={value}
            tone={value === '완료' ? 'safe' : 'neutral'}
          />
        ))}
      </Section>

      <ActionLink href="/results/demo-result" label="결과 화면 미리보기" />
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
