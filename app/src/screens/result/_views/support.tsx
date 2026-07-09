import Section from '@/components/section';
import StatusRow from '@/components/status-row';
import { formatBpm } from '@/lib/format/measurement';
import { recordLoadLabels } from '@/screens/result/labels';
import type { RecordLoadState, ResultOrigin, ResultViewModel } from '@/screens/result/use-result';

export default function ResultSupport({ result }: Props) {
  const { record, origin, loadState, saved } = result;

  return (
    <Section eyebrow="Pulse" title="보조 지표">
      <StatusRow label="심박수" value={record ? formatBpm(record.pulse_bpm) : '-'} />
      {record ? (
        <StatusRow
          label="품질"
          value={pulseQuality(record.pulse_stable)}
          tone={record.pulse_stable === null ? 'neutral' : record.pulse_stable ? 'safe' : 'caution'}
        />
      ) : null}
      <StatusRow
        label="저장 상태"
        value={storageLabel(origin, loadState, saved)}
        description={storageDescription(origin)}
        tone={storageTone(origin, loadState, saved)}
      />
    </Section>
  );
}

function pulseQuality(value: boolean | null) {
  if (value === null) return '미측정';
  return value ? '안정' : '불안정';
}

function storageLabel(origin: ResultOrigin, loadState: RecordLoadState, saved: boolean) {
  if (origin === 'live') return saved ? '저장됨' : '저장 실패';
  if (origin === 'saved') return '저장됨';
  if (origin === 'preview') return '미리보기';
  return recordLoadLabels[loadState];
}

function storageDescription(origin: ResultOrigin) {
  if (origin === 'live') return 'BLE result를 기준으로 표시합니다.';
  if (origin === 'saved') return '히스토리에 저장된 결과입니다.';
  if (origin === 'preview') return '실측 BLE result가 붙으면 저장합니다.';
  return '히스토리에서 결과를 불러옵니다.';
}

function storageTone(origin: ResultOrigin, loadState: RecordLoadState, saved: boolean) {
  if (origin === 'live') return saved ? 'safe' : 'danger';
  if (origin === 'saved') return 'safe';
  if (loadState === 'failed') return 'danger';
  return 'neutral';
}

interface Props {
  result: ResultViewModel;
}
