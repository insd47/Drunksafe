import Section from '@/components/section';
import StatusRow from '@/components/status-row';
import type { MeasurementStep } from '@/lib/ble/model';

export default function ProgressSection({ activeStep }: Props) {
  return (
    <Section eyebrow="Progress" title="측정 단계">
      {steps.map((step) => {
        const value = stepValue(step, activeStep);

        return (
          <StatusRow
            key={step}
            label={stepLabels[step]}
            value={value}
            tone={value === '완료' ? 'safe' : value === '진행 중' ? 'caution' : 'neutral'}
          />
        );
      })}
    </Section>
  );
}

function stepValue(step: MeasurementStep, activeStep?: MeasurementStep): StepState {
  if (!activeStep) return '대기';

  const stepIndex = steps.indexOf(step);
  const activeIndex = steps.indexOf(activeStep);

  if (stepIndex < activeIndex || activeStep === 'done') return '완료';
  return stepIndex === activeIndex ? '진행 중' : '대기';
}

const steps: MeasurementStep[] = [
  'preparing',
  'warming_sensor',
  'waiting_breath',
  'sampling_breath',
  'sampling_pulse',
  'analyzing',
  'done',
];

const stepLabels: Record<MeasurementStep, string> = {
  preparing: '준비',
  warming_sensor: '센서 예열',
  waiting_breath: '호기 대기',
  sampling_breath: '호기 측정',
  sampling_pulse: 'Pulse 측정',
  analyzing: '분석',
  done: '완료',
};

interface Props {
  activeStep: MeasurementStep | undefined;
}

type StepState = '완료' | '진행 중' | '대기';
