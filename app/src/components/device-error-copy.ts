import type { ErrorCode } from '@/lib/ble/model';

/** 취소는 오류가 아니라 사용자의 선택이므로 제품 화면에 문구가 없다. */
export type DisplayedErrorCode = Exclude<ErrorCode, 'cancelled'>;

export type DeviceErrorCopy = {
  icon: string;
  title: string;
  action: string;
};

export function deviceErrorCopy(code: DisplayedErrorCode) {
  return copy[code];
}

const copy: Record<DisplayedErrorCode, DeviceErrorCopy> = {
  weak_breath: {
    icon: '💨',
    title: '호기가 약합니다',
    action: '숨을 크게 들이쉬고 4초 이상 끊지 말고 세게 불어주세요.',
  },
  measurement_timeout: {
    icon: '⏱️',
    title: '측정하지 못했습니다',
    action: '마우스피스에 입을 대고 바로 불어주세요. 30초 안에 불어야 합니다.',
  },
  alcohol_sensor: {
    icon: '⚠️',
    title: '센서에 문제가 있습니다',
    action: '기기 전원을 껐다 켠 뒤 다시 시도하세요.',
  },
  pulse_sensor: {
    icon: '❤️',
    title: '심박을 읽지 못했습니다',
    action: '손가락을 센서에 가볍게 올리고 움직이지 마세요. 알코올 결과에는 영향이 없습니다.',
  },
  context_timeout: {
    icon: '📡',
    title: '기기와 통신이 끊겼습니다',
    action: '기기를 가까이 두고 다시 시도하세요.',
  },
  protocol: {
    icon: '📡',
    title: '기기와 통신하지 못했습니다',
    action: '연결을 해제하고 다시 연결해 보세요.',
  },
};
