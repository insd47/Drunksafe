import type { ErrorCode, MeasurementProgress } from '@/lib/ble/model';

export function measurementStepMessage(progress: MeasurementProgress) {
  return stepMessages[progress.step] ?? '측정이 진행 중입니다.';
}

export function measurementErrorMessage(code: ErrorCode) {
  return errorMessages[code];
}

const stepMessages: Partial<Record<MeasurementProgress['step'], string>> = {
  waiting_breath: '호기 입력을 기다리는 중입니다.',
  sampling_breath: '호기 알코올을 측정하고 있습니다.',
  sampling_pulse: '심박 신호를 확인하고 있습니다.',
  analyzing: '결과를 분석하고 있습니다.',
};

const errorMessages: Record<ErrorCode, string> = {
  context_timeout: '측정 context 전송 시간이 초과됐습니다.',
  alcohol_sensor: '알코올 센서 오류가 감지됐습니다.',
  pulse_sensor: '심박 센서 오류가 감지됐습니다.',
  weak_breath: '호기 입력이 약합니다.',
  measurement_timeout: '측정 시간이 초과됐습니다.',
  cancelled: '측정이 취소됐습니다.',
  protocol: 'BLE protocol 오류가 발생했습니다.',
};
