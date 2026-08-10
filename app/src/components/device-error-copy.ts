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
};
