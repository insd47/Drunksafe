import type { MeasurementRecord } from '@/lib/storage/history';

export function formatAlcohol(value: number) {
  return `${(value / 1000).toFixed(3)} mg/L`;
}

export function formatBac(value: number | null) {
  if (value === null) {
    return '-';
  }

  return `${(value / 1000).toFixed(3)}%`;
}

export function formatMinutes(value: number | null) {
  if (value === null) {
    return '-';
  }

  const hours = Math.floor(value / 60);
  const minutes = value % 60;

  if (hours === 0) {
    return `${minutes}분`;
  }

  return `${hours}시간 ${minutes}분`;
}

export function formatBpm(value: number | null) {
  if (value === null) {
    return '-';
  }

  return `${Math.round(value)} BPM`;
}

export function formatRisk(value: MeasurementRecord['risk']) {
  switch (value) {
    case 'safe':
      return '안전';
    case 'caution':
      return '주의';
    case 'danger':
      return '위험';
  }
}

export function formatDrivingStatus(value: MeasurementRecord['risk']) {
  switch (value) {
    case 'safe':
      return '운전 가능';
    case 'caution':
      return '운전 주의';
    case 'danger':
      return '운전 금지';
  }
}

export function formatDrivingDescription(value: MeasurementRecord['risk']) {
  switch (value) {
    case 'safe':
      return '측정값 기준 위험 신호가 낮습니다.';
    case 'caution':
      return '추가 휴식 후 재측정을 권장합니다.';
    case 'danger':
      return '현재 결과 기준 운전하지 마세요.';
  }
}

export function riskTone(value: MeasurementRecord['risk']) {
  switch (value) {
    case 'safe':
      return 'safe';
    case 'caution':
      return 'caution';
    case 'danger':
      return 'danger';
  }
}

export function formatMeasuredAt(value: number) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}
