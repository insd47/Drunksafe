import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { ActionLink } from '@/components/action-link';
import { Screen } from '@/components/screen';
import { Section } from '@/components/section';
import { StatusRow } from '@/components/status-row';
import { formatBac, formatMeasuredAt, formatRisk, riskTone } from '@/lib/format/measurement';
import { readHistory, type MeasurementRecord } from '@/lib/storage/history';

export function HistoryScreen() {
  const [records, setRecords] = useState<MeasurementRecord[]>([]);
  const [failed, setFailed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;

      readHistory()
        .then((history) => {
          if (!mounted) {
            return;
          }

          setRecords(history.filter((record) => record.kind === 'measurement'));
          setFailed(false);
        })
        .catch(() => {
          if (mounted) {
            setFailed(true);
          }
        });

      return () => {
        mounted = false;
      };
    }, [])
  );

  return (
    <Screen>
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
          <StatusRow
            key={record.id}
            label={formatMeasuredAt(record.measured_at_unix_ms)}
            value={formatBac(record.bac_upper_milli_percent ?? record.bac_milli_percent)}
            description={formatRisk(record.risk)}
            tone={riskTone(record.risk)}
          />
        ))}
      </Section>

      <ActionLink href="/" label="장치 연결로 돌아가기" variant="secondary" />
    </Screen>
  );
}
