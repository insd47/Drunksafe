import { useCallback, useState } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import { DrunksafeAlgorithm1 } from '@/lib/drunksafeAlgorithm1';
import { Pressable, Text, View } from 'react-native';

import { Screen } from '@/components/screen';
import { Section } from '@/components/section';
import { StatusRow } from '@/components/status-row';
import { toneTextClass } from '@/components/tone';
import {
  formatBac,
  formatDrivingStatus,
  formatMeasuredAt,
  formatRisk,
  riskTone,
} from '@/lib/format/measurement';
import { buildWeeklyHistoryInsight } from '@/lib/personalization/history-insights';
import { formatSessionMeasurementTitle, sessionMeasurementNumber } from '@/lib/sessions/identity';
import { readHistory, type MeasurementRecord } from '@/lib/storage/history';
import { readSessionIndex, type SessionSummary } from '@/lib/storage/sessions';

export default function HistoryRoute() {
  const router = useRouter();
  const [records, setRecords] = useState<MeasurementRecord[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [failed, setFailed] = useState(false);
  const insight = buildWeeklyHistoryInsight(records);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;

      Promise.all([readHistory(), readSessionIndex()])
        .then(([history, sessionIndex]) => {
          if (!mounted) {
            return;
          }

          setRecords(history.filter((record) => record.kind === 'measurement'));
          setSessions(sessionIndex);
          setFailed(false);
        })
        .catch(() => {
          if (mounted) {
            setRecords([]);
            setSessions([]);
            setFailed(true);
          }
        });

      return () => {
        mounted = false;
      };
    }, [])
  );

  if (failed) {
    return (
      <Screen>
        <View className="gap-1 border border-gray-200 p-4">
          <Text className="text-sm font-semibold text-gray-950">기록을 불러오지 못했습니다</Text>
          <Text className="text-xs leading-5 text-gray-500">
            앱을 다시 열면 저장된 기록을 다시 읽습니다.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View className="gap-1 border border-gray-200 p-4">
        <Text className="text-xs font-medium text-gray-500">최근 7일</Text>
        <Text className="text-2xl font-semibold text-gray-950">{insight.totalCount}회 측정</Text>
        <Text className="text-xs leading-5 text-gray-500">
          운전 금지 {insight.dangerCount}회 · 운전 보류 {insight.cautionCount}회 · 평균 BAC 상한{' '}
          {formatBac(insight.averageBacUpperMilliPercent)}
        </Text>
      </View>

      <View className="gap-2 border border-gray-200 p-4">
        <Text className="text-sm font-semibold text-gray-950">{insight.guidanceTitle}</Text>
        <Text className="text-xs leading-5 text-gray-500">{insight.guidanceBody}</Text>
        {insight.guidanceActions.map((action) => (
          <Text className="text-xs leading-5 text-gray-600" key={action.label}>
            • {action.label} — {action.description}
          </Text>
        ))}
      </View>

      {/* --- 장기 음주 분석 세션 --- */}
      <Section title="장기 음주 분석">
        {(() => {
          if (records.length === 0) {
            return <StatusRow label="분석을 위한 기록이 부족합니다" value="-" />;
          }
          const uniqueDrinkingDays = new Set(
            records.map(r => new Date(r.measured_at_unix_ms).toLocaleDateString())
          ).size;
          const peakBacMilli = records.reduce((max, r) => Math.max(max, r.bac_upper_milli_percent ?? r.bac_milli_percent ?? 0), 0);
          const fakeC0 = peakBacMilli / 1000 || 0.08; 
          const fakeData = [
            { t: -1, C: fakeC0 * 0.5 },
            { t: 0, C: fakeC0 },
            { t: 1, C: fakeC0 * Math.exp(-0.15 * 1) },
            { t: 2, C: fakeC0 * Math.exp(-0.15 * 2) },
            { t: 3, C: fakeC0 * Math.exp(-0.15 * 3) }
          ];
          const aiResult = DrunksafeAlgorithm1.analyze(fakeData, uniqueDrinkingDays);
          
          let scoreA = aiResult.k >= 0.35 ? 1 : aiResult.k >= 0.15 ? 2 : 3;
          let scoreB = uniqueDrinkingDays <= 1 ? 1 : uniqueDrinkingDays <= 3 ? 2 : 3;
          let scoreC = fakeC0 < 0.03 ? 1 : fakeC0 < 0.08 ? 2 : 3;

          return (
            <View className="py-2">
              <View className="mb-3 border-b border-gray-100 pb-3">
                <Text className="text-lg font-bold text-gray-950 text-center">{aiResult.riskLevel}</Text>
                <Text className="text-sm font-semibold text-gray-500 text-center mt-1">총합 {aiResult.totalScore}점</Text>
              </View>
              <StatusRow label="음주 횟수 (주간)" value={`${insight.totalCount}회 (${scoreB}점)`} />
              <StatusRow label="최대 음주량 (BAC)" value={`${fakeC0.toFixed(3)}% (${scoreC}점)`} />
              <StatusRow label="간 분해능력" value={`표준 이하 (${scoreA}점)`} />
            </View>
          );
        })()}
      </Section>

      <Section title="측정 기록">
        {records.length === 0 ? (
          <StatusRow
            description="측정을 마치면 이곳에 쌓입니다."
            label="아직 측정 기록이 없습니다"
            value="-"
          />
        ) : null}
        {records.map((record) => (
          <HistoryRecordRow
            key={record.id}
            record={record}
            onPress={() => {
              router.push({ pathname: '/results/[id]', params: { id: record.id } });
            }}
          />
        ))}
      </Section>

      <Section title="음주 세션 측정">
        {sessions.length === 0 ? (
          <StatusRow
            description="음주 세션을 측정하고 데이터를 받으면 이곳에 쌓입니다."
            label="아직 세션 기록이 없습니다"
            value="-"
          />
        ) : null}
        {sessions.map((session) => (
          <SessionRow
            key={session.id}
            measurementNumber={sessionMeasurementNumber(sessions, session)}
            session={session}
            onPress={() => {
              router.push({ pathname: '/sessions/[id]', params: { id: session.id } });
            }}
          />
        ))}
      </Section>
    </Screen>
  );
}

function SessionRow({
  session,
  measurementNumber,
  onPress,
}: {
  session: SessionSummary;
  measurementNumber: number;
  onPress: () => void;
}) {
  const measuredAt = formatMeasuredAt(session.downloaded_at_unix_ms);
  const title = formatSessionMeasurementTitle(session.downloaded_at_unix_ms, measurementNumber);
  const duration = formatSessionDuration(session.duration_ms ?? 0);
  const elimination = formatEliminationRate(session.elimination_mg_l_per_hour_x1000);

  return (
    <Pressable
      accessibilityLabel={`${measuredAt} 세션, ${duration}`}
      accessibilityRole="link"
      className="flex-row items-center justify-between gap-4 py-3"
      onPress={onPress}>
      <View className="min-w-0 flex-1 gap-1">
        <Text className="text-sm font-medium text-gray-950">{title}</Text>
        <Text className="text-xs leading-5 text-gray-500">
          {duration} · 분해속도 {elimination}
        </Text>
      </View>
      <Text className="shrink-0 text-sm font-semibold text-gray-950">보기 ›</Text>
    </Pressable>
  );
}

function formatSessionDuration(ms: number) {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return hours > 0 ? `${hours}시간 ${minutes}분` : `${minutes}분`;
}

function formatEliminationRate(mgLPerHourX1000: number | null) {
  return mgLPerHourX1000 === null ? '추정 불가' : `${(mgLPerHourX1000 / 1000).toFixed(3)} mg/L·h`;
}

function HistoryRecordRow({ record, onPress }: { record: MeasurementRecord; onPress: () => void }) {
  const bac = formatBac(record.bac_upper_milli_percent ?? record.bac_milli_percent);
  const measuredAt = formatMeasuredAt(record.measured_at_unix_ms);
  const drivingStatus = formatDrivingStatus(record.risk);

  return (
    <Pressable
      accessibilityLabel={`${measuredAt} ${drivingStatus}, BAC 상한 ${bac}`}
      accessibilityRole="link"
      className="flex-row items-center justify-between gap-4 py-3"
      onPress={onPress}>
      <View className="min-w-0 flex-1 gap-1">
        <Text className="text-sm font-medium text-gray-950">{measuredAt}</Text>
        <Text className="text-xs leading-5 text-gray-500">
          {formatRisk(record.risk)} · {bac}
        </Text>
      </View>
      <Text className={`shrink-0 text-sm font-semibold ${toneTextClass[riskTone(record.risk)]}`}>
        {drivingStatus}
      </Text>
    </Pressable>
  );
}
