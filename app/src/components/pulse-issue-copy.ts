import type { PulseUnavailableReason } from '@/lib/ble/model';

export type PulseIssueCopy = {
  title: string;
  action: string;
};

export function pulseIssueCopy(reason: PulseUnavailableReason) {
  return copy[reason];
}

const copy: Record<PulseUnavailableReason, PulseIssueCopy> = {
  no_signal: {
    title: '센서 신호가 감지되지 않았습니다',
    action: '손가락을 PPG 센서에 자연스럽게 밀착하고 다시 측정하세요.',
  },
  unstable: {
    title: '심박 신호가 불안정했습니다',
    action: '측정 중 손을 움직이지 마세요.',
  },
};
