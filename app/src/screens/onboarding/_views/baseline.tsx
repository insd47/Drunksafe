import Section from '@/components/section';
import StatusRow from '@/components/status-row';
import { formatAlcohol, formatBpm } from '@/lib/format/measurement';
import type { UserBaseline } from '@/lib/storage/profile';
import { formatUpdatedAt } from '@/screens/onboarding/format';

export default function BaselineSection({ baseline }: Props) {
  return (
    <Section eyebrow="Baseline" title="Sober 기준값">
      <StatusRow
        label="Baseline 세션"
        value={baseline.sample_count > 0 ? `${baseline.sample_count}회` : '미측정'}
        description={formatUpdatedAt(baseline.updated_at_unix_ms)}
        tone={baseline.sample_count > 0 ? 'safe' : 'caution'}
      />
      <StatusRow
        label="호기 baseline"
        value={
          baseline.sober_alcohol_mg_l_x1000 === null
            ? '미측정'
            : formatAlcohol(baseline.sober_alcohol_mg_l_x1000)
        }
        description="완전 sober 상태에서 3회 이상 측정합니다."
      />
      <StatusRow
        label="안정시 BPM"
        value={formatBpm(baseline.resting_bpm)}
        description="Pulse가 안정적인 측정만 baseline에 반영합니다."
      />
    </Section>
  );
}

interface Props {
  baseline: UserBaseline;
}
