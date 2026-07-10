import { formatAlcohol } from '@/lib/format/measurement';

export function formatElimination(value: number | null, fallback: number | null) {
  if (value === null) return fallback === null ? '기본값' : `${formatAlcohol(fallback)}/h`;
  return `${formatAlcohol(value)}/h`;
}

export function formatUpdatedAt(value: number | null) {
  if (value === null) return '일반 음주 측정과 분리해서 저장합니다.';

  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}
