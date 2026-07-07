import { useCallback, useState } from 'react';
import { Link, useFocusEffect } from 'expo-router';
import { Pressable } from 'react-native';

import { ActionLink } from '@/components/action-link';
import { Screen } from '@/components/screen';
import { Section } from '@/components/section';
import { StatusRow } from '@/components/status-row';
import {
  formatBac,
  formatDrivingStatus,
  formatMeasuredAt,
  formatRisk,
  riskTone,
} from '@/lib/format/measurement';
import { buildWeeklyHistoryInsight } from '@/lib/personalization/history-insights';
import { readHistory, type MeasurementRecord } from '@/lib/storage/history';

export function HistoryScreen() {
  const [records, setRecords] = useState<MeasurementRecord[]>([]);
  const [failed, setFailed] = useState(false);
  const insight = buildWeeklyHistoryInsight(records);

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
            setRecords([]);
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
      {!failed ? (
        <>
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
              tone={
                insight.dangerCount > 0 ? 'danger' : insight.cautionCount > 0 ? 'caution' : 'safe'
              }
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
              value={guidanceLabel[insight.guidanceLevel]}
              description={insight.guidanceBody}
              tone={guidanceTone[insight.guidanceLevel]}
            />
          </Section>
        </>
      ) : null}

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
          <Link
            key={record.id}
            href={{ pathname: '/results/[id]', params: { id: record.id } }}
            asChild>
            <Pressable>
              <StatusRow
                label={formatMeasuredAt(record.measured_at_unix_ms)}
                value={formatDrivingStatus(record.risk)}
                description={`${formatRisk(record.risk)} · ${formatBac(
                  record.bac_upper_milli_percent ?? record.bac_milli_percent
                )}`}
                tone={riskTone(record.risk)}
              />
            </Pressable>
          </Link>
        ))}
      </Section>

      <ActionLink href="/" label="장치 연결로 돌아가기" variant="secondary" />
    </Screen>
  );
}

const guidanceLabel = {
  none: '기록 유지',
  rest: '재측정',
  support: '상담 검토',
} as const;

const guidanceTone = {
  none: 'safe',
  rest: 'caution',
  support: 'danger',
} as const;
