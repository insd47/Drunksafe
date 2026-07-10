import { Link, useRouter } from 'expo-router';
import { Pressable } from 'react-native';

import Section from '@/components/section';
import StatusRow from '@/components/status-row';
import {
  formatBac,
  formatDrivingStatus,
  formatMeasuredAt,
  formatRisk,
  riskTone,
} from '@/lib/format/measurement';
import type { MeasurementRecord } from '@/lib/storage/history';

export default function RecordSection({ records, failed }: Props) {
  return (
    <Section eyebrow="History" title="최근 측정">
      {failed ? (
        <StatusRow
          label="불러오기"
          value="실패"
          description="저장소를 다시 확인합니다."
          tone="danger"
        />
      ) : null}
      {!failed && records.length === 0 ? (
        <StatusRow label="기록" value="없음" description="저장된 일반 측정 결과가 없습니다." />
      ) : null}
      {records.map((record) => (
        <RecordRow key={record.id} record={record} />
      ))}
    </Section>
  );
}

function RecordRow({ record }: RecordRowProps) {
  const router = useRouter();
  const href = { pathname: '/results/[id]', params: { id: record.id } } as const;
  const bac = formatBac(record.bac_upper_milli_percent ?? record.bac_milli_percent);
  const risk = formatRisk(record.risk);
  const drivingStatus = formatDrivingStatus(record.risk);
  const label = `${formatMeasuredAt(record.measured_at_unix_ms)} ${drivingStatus}, ${risk}, BAC 상한 ${bac}`;
  const content = (
    <StatusRow
      label={formatMeasuredAt(record.measured_at_unix_ms)}
      value={drivingStatus}
      description={`${risk} · ${bac}`}
      tone={riskTone(record.risk)}
    />
  );

  return process.env.EXPO_OS === 'web' ? (
    <Link href={href} asChild>
      <Pressable accessibilityLabel={label} accessibilityRole="link">
        {content}
      </Pressable>
    </Link>
  ) : (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="link"
      onPress={() => router.navigate(href)}>
      {content}
    </Pressable>
  );
}

interface Props {
  records: MeasurementRecord[];
  failed: boolean;
}

interface RecordRowProps {
  record: MeasurementRecord;
}
