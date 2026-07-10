import type { RecordLoadState } from '@/features/result/use-result';

export const recordLoadLabels: Record<RecordLoadState, string> = {
  idle: '대기',
  loading: '불러오는 중',
  loaded: '없음',
  failed: '실패',
};
