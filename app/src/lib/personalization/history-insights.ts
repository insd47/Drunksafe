import type { MeasurementRecord } from '@/lib/storage/history';

const weekMs = 7 * 24 * 60 * 60 * 1000;

export type WeeklyHistoryInsight = {
  totalCount: number;
  dangerCount: number;
  cautionCount: number;
  averageBacUpperMilliPercent: number | null;
  peakBacUpperMilliPercent: number | null;
  latestRisk: MeasurementRecord['risk'] | null;
  guidanceLevel: 'none' | 'rest' | 'support';
  guidanceTitle: string;
  guidanceBody: string;
  guidanceActions: GuidanceAction[];
};

export type GuidanceAction = {
  label: string;
  value: string;
  description: string;
  tone: 'neutral' | 'safe' | 'caution' | 'danger';
};

export function buildWeeklyHistoryInsight(
  records: MeasurementRecord[],
  nowUnixMs = Date.now()
): WeeklyHistoryInsight {
  const weekStart = nowUnixMs - weekMs;
  const weekly = records
    .filter((record) => record.kind === 'measurement')
    .filter(
      (record) => record.measured_at_unix_ms >= weekStart && record.measured_at_unix_ms <= nowUnixMs
    );
  const values = weekly
    .map((record) => record.bac_upper_milli_percent ?? record.bac_milli_percent)
    .filter((value): value is number => value !== null);
  const dangerCount = weekly.filter((record) => record.risk === 'danger').length;
  const cautionCount = weekly.filter((record) => record.risk === 'caution').length;
  const latestRisk = weekly[0]?.risk ?? null;
  const averageBacUpperMilliPercent =
    values.length === 0
      ? null
      : Math.round(values.reduce((total, value) => total + value, 0) / values.length);
  const peakBacUpperMilliPercent = values.length === 0 ? null : Math.max(...values);
  const guidanceLevel = guidanceLevelFor({ totalCount: weekly.length, dangerCount, cautionCount });
  const guidance = guidanceCopy[guidanceLevel];

  return {
    totalCount: weekly.length,
    dangerCount,
    cautionCount,
    averageBacUpperMilliPercent,
    peakBacUpperMilliPercent,
    latestRisk,
    guidanceLevel,
    guidanceTitle: guidance.title,
    guidanceBody: guidance.body,
    guidanceActions: guidance.actions,
  };
}

function guidanceLevelFor({
  totalCount,
  dangerCount,
  cautionCount,
}: {
  totalCount: number;
  dangerCount: number;
  cautionCount: number;
}): WeeklyHistoryInsight['guidanceLevel'] {
  if (dangerCount >= 2 || (totalCount >= 4 && dangerCount + cautionCount >= 2)) {
    return 'support';
  }

  if (dangerCount >= 1 || cautionCount >= 2) {
    return 'rest';
  }

  return 'none';
}

const guidanceCopy: Record<
  WeeklyHistoryInsight['guidanceLevel'],
  { title: string; body: string; actions: GuidanceAction[] }
> = {
  none: {
    title: '유지',
    body: '최근 7일 기록에서 반복 위험 패턴은 아직 보이지 않습니다. 다음 측정도 같은 기준으로 기록하세요.',
    actions: [
      {
        label: '측정 루틴',
        value: '유지',
        description: '음주 후 운전이나 장비 운용 전에는 같은 기준으로 재측정하세요.',
        tone: 'safe',
      },
    ],
  },
  rest: {
    title: '휴식 권장',
    body: '최근 기록에 주의 또는 위험 신호가 있습니다. 운전과 장비 운용은 피하고 충분히 쉬었다가 재측정하세요.',
    actions: [
      {
        label: '오늘 행동',
        value: '운전 중지',
        description: '위험 신호가 사라질 때까지 운전과 장비 운용을 미루세요.',
        tone: 'danger',
      },
      {
        label: '재측정',
        value: '휴식 후',
        description: '수면, 식사, 수분 보충 후 같은 baseline 기준으로 다시 측정하세요.',
        tone: 'caution',
      },
    ],
  },
  support: {
    title: '상담 권장',
    body: '최근 7일에 위험 또는 주의 신호가 반복됐습니다. 지역 중독관리통합지원센터나 정신건강복지센터 상담을 검토하세요.',
    actions: [
      {
        label: '보건복지상담센터',
        value: '129',
        description: '알코올중독 등 보건복지 상담 창구를 통해 지원 경로를 확인하세요.',
        tone: 'danger',
      },
      {
        label: '정신건강 위기상담',
        value: '109',
        description: '위기 상황이면 즉시 상담하고 지역 정신건강복지센터 연계를 요청하세요.',
        tone: 'danger',
      },
      {
        label: '지역 센터',
        value: '상담 예약',
        description: '중독관리통합지원센터 또는 정신건강복지센터 방문 상담을 확인하세요.',
        tone: 'caution',
      },
    ],
  },
};
