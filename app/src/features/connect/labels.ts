import type { BleConnectionPhase, BleMeasurementPhase } from '@/lib/ble/session';

export function bluetoothLabel(state: string) {
  if (state === 'PoweredOn') return '켜짐';
  if (state === 'Unsupported') return '미지원';
  if (state === 'Unauthorized') return '권한 필요';
  return '꺼짐';
}

export function bluetoothTone(state: string): StatusTone {
  if (state === 'PoweredOn') return 'safe';
  if (state === 'Unsupported') return 'danger';
  return 'caution';
}

export function connectionLabel(phase: BleConnectionPhase) {
  return connectionLabels[phase];
}

export function connectionTone(phase: BleConnectionPhase): StatusTone {
  if (phase === 'connected') return 'safe';
  if (phase === 'error' || phase === 'unsupported') return 'danger';
  if (phase === 'scanning' || phase === 'connecting' || phase === 'bluetooth_off') {
    return 'caution';
  }

  return 'neutral';
}

export function measurementLabel(phase: BleMeasurementPhase) {
  return measurementLabels[phase];
}

export function measurementTone(phase: BleMeasurementPhase): StatusTone {
  if (phase === 'error') return 'danger';
  if (phase === 'result') return 'safe';
  if (phase === 'idle') return 'neutral';
  return 'caution';
}

export type StatusTone = 'neutral' | 'safe' | 'caution' | 'danger';

const connectionLabels: Record<BleConnectionPhase, string> = {
  idle: '대기',
  bluetooth_off: '대기',
  scanning: '검색 중',
  connecting: '연결 중',
  connected: '연결됨',
  unsupported: '미지원',
  error: '오류',
};

const measurementLabels: Record<BleMeasurementPhase, string> = {
  idle: '대기',
  starting: '시작 중',
  waiting_context: 'Context 전송',
  measuring: '측정 중',
  result: '결과 수신',
  error: '오류',
};
