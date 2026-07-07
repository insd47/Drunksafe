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
      return '위험 낮음';
    case 'caution':
      return '운전 보류';
    case 'danger':
      return '운전 금지';
  }
}

export function formatDrivingDescription(value: MeasurementRecord['risk']) {
  switch (value) {
    case 'safe':
      return '측정값 기준 알코올 위험 신호가 낮지만 운전 가능을 보증하지 않습니다.';
    case 'caution':
      return '운전과 장비 운용은 보류하고 충분한 휴식 후 재측정하세요.';
    case 'danger':
      return '법정 기준 이상 가능성이 있어 현재 결과 기준 운전하지 마세요.';
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
