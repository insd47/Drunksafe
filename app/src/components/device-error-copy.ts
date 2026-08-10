import type { MeasurementErrorCode } from '@/lib/ble/session';

/** 취소는 오류가 아니라 사용자의 선택이므로 제품 화면에 문구가 없다. */
export type DisplayedErrorCode = Exclude<MeasurementErrorCode, 'cancelled'>;

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
  bluetooth_off: {
    icon: '📴',
    title: 'Bluetooth가 꺼졌습니다',
    action: 'Bluetooth를 켠 뒤 다시 측정하세요.',
  },
  connection_lost: {
    icon: '📡',
    title: '측정 중 연결이 끊겼습니다',
    action: '기기를 가까이 두고 다시 측정하세요.',
  },
  ble_failure: {
    icon: '⚠️',
    title: '측정을 이어가지 못했습니다',
    action: '기기 전원과 거리를 확인한 뒤 다시 시도하세요.',
  },
};
