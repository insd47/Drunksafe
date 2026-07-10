import { Fragment } from 'react';

import Section from '@/components/section';
import StatusRow from '@/components/status-row';
import { formatBac } from '@/lib/format/measurement';
import { buildWeeklyHistoryInsight } from '@/lib/personalization/history-insights';
import type { MeasurementRecord } from '@/lib/storage/history';

export default function InsightSections({ records }: Props) {
  const insight = buildWeeklyHistoryInsight(records);

  return (
    <Fragment>
      <Section eyebrow="Trend" title="최근 7일 추이">
        <StatusRow
          label="측정 횟수"
          value={`${insight.totalCount}회`}
          description="일반 측정 기록만 집계합니다."
          tone={insight.totalCount >= 4 ? 'caution' : 'neutral'}
        />
        <StatusRow
          label="위험/주의"
          value={`${insight.dangerCount}/${insight.cautionCount}회`}
          description="반복 위험 신호가 있으면 상담 안내를 우선 표시합니다."
          tone={insight.dangerCount > 0 ? 'danger' : insight.cautionCount > 0 ? 'caution' : 'safe'}
        />
        <StatusRow
          label="평균 BAC 상한"
          value={formatBac(insight.averageBacUpperMilliPercent)}
          description={`최고 ${formatBac(insight.peakBacUpperMilliPercent)}`}
          tone={insight.guidanceLevel === 'support' ? 'danger' : 'neutral'}
        />
      </Section>

      <Section eyebrow="Guide" title="개선 안내">
        <StatusRow
          label={insight.guidanceTitle}
          value={guidanceLabels[insight.guidanceLevel]}
          description={insight.guidanceBody}
          tone={guidanceTones[insight.guidanceLevel]}
        />
        {insight.guidanceActions.map((action) => (
          <StatusRow
            key={action.label}
            label={action.label}
            value={action.value}
            description={action.description}
            tone={action.tone}
          />
        ))}
      </Section>
    </Fragment>
  );
}

const guidanceLabels = {
  none: '기록 유지',
  rest: '재측정',
  support: '상담 검토',
} as const;

const guidanceTones = {
  none: 'safe',
  rest: 'caution',
  support: 'danger',
} as const;

interface Props {
  records: MeasurementRecord[];
}
