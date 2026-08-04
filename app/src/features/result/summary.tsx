import Section from '@/components/section';
import StatusRow from '@/components/status-row';
import {
  formatAlcohol,
  formatBac,
  formatDrivingDescription,
  formatDrivingStatus,
  formatMinutes,
  formatRisk,
  riskTone,
} from '@/lib/format/measurement';
import { baselineResultDescription } from '@/lib/personalization/baseline-acceptance';
import { recordLoadLabels } from '@/features/result/labels';
import type { ResultViewModel } from '@/features/result/use-result';

export default function ResultSummary({ result }: Props) {
  const { record, kind, loadState } = result;

  return (
    <Section
      eyebrow="Result"
      title={
        record
          ? kind === 'baseline'
            ? 'Baseline 결과'
            : formatDrivingStatus(record.risk)
          : '결과 없음'
      }>
      {!record ? (
        <StatusRow
          label="저장 결과"
          value={recordLoadLabels[loadState]}
          description="히스토리에 저장된 측정 결과를 찾지 못했습니다."
          tone={loadState === 'failed' ? 'danger' : 'caution'}
        />
      ) : null}
      {kind !== 'baseline' ? (
        <StatusRow
          label="운전 상태"
          value={record ? formatDrivingStatus(record.risk) : '-'}
          description={record ? formatDrivingDescription(record.risk) : '저장 결과가 없습니다.'}
          tone={record ? riskTone(record.risk) : 'neutral'}
        />
      ) : null}
      {record ? (
        <>
          <StatusRow
            label="위험 단계"
            value={formatRisk(record.risk)}
            description={
              kind === 'baseline'
                ? baselineResultDescription(record)
                : '보수적 BAC 상한 기준으로 판단했습니다.'
            }
            tone={riskTone(record.risk)}
          />
          <StatusRow label="호기 알코올" value={formatAlcohol(record.alcohol_mg_l_x1000)} />
          <StatusRow label="BAC 추정" value={formatBac(record.bac_milli_percent)} />
          <StatusRow
            label="BAC 상한"
            value={formatBac(record.bac_upper_milli_percent)}
            tone={record.risk === 'danger' ? 'danger' : 'neutral'}
          />
          <StatusRow
            label="해소 예상"
            value={formatMinutes(record.sober_time_minutes)}
            description="최근 히스토리 기준 추정값입니다."
          />
          <StatusRow label="신뢰도" value={`${record.confidence_percent}%`} />
        </>
      ) : null}
    </Section>
  );
}

interface Props {
  result: ResultViewModel;
}
