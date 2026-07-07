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

const guidanceCopy: Record<WeeklyHistoryInsight['guidanceLevel'], { title: string; body: string }> =
  {
    none: {
      title: '유지',
      body: '최근 7일 기록에서 반복 위험 패턴은 아직 보이지 않습니다. 다음 측정도 같은 기준으로 기록하세요.',
    },
    rest: {
      title: '휴식 권장',
      body: '최근 기록에 주의 또는 위험 신호가 있습니다. 운전과 장비 운용은 피하고 충분히 쉬었다가 재측정하세요.',
    },
    support: {
      title: '상담 권장',
      body: '최근 7일에 위험 또는 주의 신호가 반복됐습니다. 지역 중독관리통합지원센터나 정신건강복지센터 상담을 검토하세요.',
    },
  };
