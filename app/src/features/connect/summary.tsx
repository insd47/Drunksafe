import Section from '@/components/section';
import StatusRow from '@/components/status-row';
import {
  formatBac,
  formatDrivingStatus,
  formatMinutes,
  formatRisk,
  riskTone,
} from '@/lib/format/measurement';
import type { ConnectionSummary } from '@/features/connect/use-summary';

export function PersonalizationSection({ summary }: Props) {
  return (
    <Section eyebrow="Context" title="개인화 준비">
      <StatusRow
        label="Sober baseline"
        value={summary.baselineReady ? '준비됨' : '미측정'}
        description="완전 sober 상태에서 별도 세션으로 잡습니다."
        tone={summary.baselineReady ? 'safe' : 'caution'}
      />
      <StatusRow
        label="최근 히스토리"
        value={`${summary.recentCount}건`}
        description="알코올 해소 추정에는 최근 기록이 필요합니다."
      />
      <StatusRow
        label="프로필"
        value={summary.profileReady ? '입력됨' : '미입력'}
        description="원본은 앱에 보관하고 보수적 해소율만 context에 반영합니다."
        tone={summary.profileReady ? 'safe' : 'neutral'}
      />
    </Section>
  );
}

export function LatestResultSection({ summary }: Props) {
  const latest = summary.latest;

  return (
    <Section eyebrow="최근 결과" title="마지막 측정">
      <StatusRow
        label="운전 상태"
        value={latest ? formatDrivingStatus(latest.risk) : '기록 없음'}
        description={
          latest
            ? `${formatRisk(latest.risk)} · ${formatBac(
                latest.bac_upper_milli_percent ?? latest.bac_milli_percent
              )}`
            : '첫 일반 측정 후 결과가 저장됩니다.'
        }
        tone={latest ? riskTone(latest.risk) : 'neutral'}
      />
      <StatusRow
        label="해소 예상"
        value={latest ? formatMinutes(latest.sober_time_minutes) : '-'}
        description={
          latest ? '최근 히스토리 기준 추정값입니다.' : '최근 히스토리가 쌓이면 계산합니다.'
        }
      />
    </Section>
  );
}

interface Props {
  summary: ConnectionSummary;
}
