import { useCallback, useState } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';

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
import { readHistory, deleteMeasurementById, type MeasurementRecord } from '@/lib/storage/history';
import { readSessionIndex, deleteSessionById, type SessionSummary } from '@/lib/storage/sessions';

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
      {/* --- 주간 기록 분석 --- */}
      <Section title="주간 기록 분석">
        {(() => {
          if (records.length === 0 && sessions.length === 0) {
            return <StatusRow label="분석을 위한 기록이 부족합니다" value="-" />;
          }
          const weekStart = Date.now() - 7 * 24 * 60 * 60 * 1000;
          const weeklySessions = sessions.filter(s => s.downloaded_at_unix_ms >= weekStart);
          const weeklySessionsCount = weeklySessions.length;
          
          let peakBacMilli = records.reduce((max, r) => Math.max(max, r.bac_upper_milli_percent ?? r.bac_milli_percent ?? 0), 0);
          weeklySessions.forEach(s => {
            if (s.peak_alcohol_mg_l_x1000 != null) {
              const sessionBac = Math.floor((s.peak_alcohol_mg_l_x1000 * 21 + 50) / 100);
              if (sessionBac > peakBacMilli) peakBacMilli = sessionBac;
            }
          });
          
          const validSessions = sessions.filter(s => s.elimination_mg_l_per_hour_x1000 !== null);
          const avgEliminationX1000 = validSessions.length > 0 
            ? validSessions.reduce((sum, s) => sum + s.elimination_mg_l_per_hour_x1000!, 0) / validSessions.length 
            : 0;
            
          let scoreA = avgEliminationX1000 < 30 ? 3 : avgEliminationX1000 < 70 ? 2 : 1;
          let scoreB = weeklySessionsCount <= 1 ? 1 : weeklySessionsCount <= 3 ? 2 : 3;
          let scoreC = peakBacMilli < 30 ? 1 : peakBacMilli < 80 ? 2 : 3;
          
          const totalScore = scoreA + scoreB + scoreC;
          let riskLevel = "";
          if (totalScore <= 3) riskLevel = "Level 1 [매우 안전]";
          else if (totalScore <= 5) riskLevel = "Level 2 [주의 요망]";
          else if (totalScore === 6) riskLevel = "Level 3 [경고]";
          else if (totalScore <= 8) riskLevel = "Level 4 [위험]";
          else riskLevel = "Level 5 [초고위험]";

          return (
            <View className="py-2">
              <View className="mb-3 border-b border-gray-100 pb-3">
                <Text className="text-lg font-bold text-gray-950 text-center">{riskLevel}</Text>
                <Text className="text-sm font-semibold text-gray-500 text-center mt-1">총합 {totalScore}점</Text>
              </View>
              <StatusRow label="음주 횟수 (주간)" value={`${weeklySessionsCount}회 (${scoreB}점)`} />
              <StatusRow label="최대 음주량 (BAC)" value={`${(peakBacMilli / 1000).toFixed(3)}% (${scoreC}점)`} />
              <StatusRow label="평균 알코올 분해속도" value={avgEliminationX1000 > 0 ? `${(avgEliminationX1000/1000).toFixed(3)} mg/L·h (${scoreA}점)` : `측정 부족 (${scoreA}점)`} />
            </View>
          );
        })()}
      </Section>

      <View className="gap-2 border border-gray-200 p-4 mb-4">
        <Text className="text-sm font-semibold text-gray-950">{insight.guidanceTitle}</Text>
        <Text className="text-xs leading-5 text-gray-500">{insight.guidanceBody}</Text>
        {insight.guidanceActions.map((action) => (
          <Text className="text-xs leading-5 text-gray-600" key={action.label}>
            • {action.label} — {action.description}
          </Text>
        ))}
      </View>

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
            onDelete={async () => {
              const success = await deleteMeasurementById(record.id);
              if (success) {
                setRecords(prev => prev.filter(r => r.id !== record.id));
              }
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
            onDelete={session.id.includes('mock') ? async () => {
              const success = await deleteSessionById(session.id);
              if (success) {
                setSessions(prev => prev.filter(s => s.id !== session.id));
              }
            } : undefined}
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
  onDelete,
}: {
  session: SessionSummary;
  measurementNumber: number;
  onPress: () => void;
  onDelete?: (() => void) | (() => Promise<void>) | undefined;
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
      <View className="flex-row items-center gap-3">
        <Text className="shrink-0 text-sm font-semibold text-gray-950">보기 ➔</Text>
        {onDelete && (
          <Pressable onPress={onDelete} className="px-2 py-1 bg-red-100 rounded-md border border-red-200">
            <Text className="text-red-700 text-xs font-bold">삭제</Text>
          </Pressable>
        )}
      </View>
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

function HistoryRecordRow({ record, onPress, onDelete }: { record: MeasurementRecord; onPress: () => void; onDelete?: () => void }) {
  const bac = formatBac(record.bac_upper_milli_percent ?? record.bac_milli_percent);
  const measuredAt = formatMeasuredAt(record.measured_at_unix_ms);
  const drivingStatus = formatDrivingStatus(record.risk);
  const isDemo = record.session_id.includes('mock');

  return (
    <Pressable
      accessibilityLabel={`${measuredAt} ${drivingStatus}, BAC 상한 ${bac}`}
      accessibilityRole="link"
      className="flex-row items-center justify-between gap-4 py-3"
      onPress={onPress}>
      <View className="min-w-0 flex-1 gap-1">
        <Text className="text-sm font-medium text-gray-950">{measuredAt}</Text>
        <Text className="text-xs leading-5 text-gray-500">
          {formatRisk(record.risk)} · {bac} {isDemo ? '(데모)' : ''}
        </Text>
      </View>
      <View className="flex-row items-center gap-3">
        <Text className={`shrink-0 text-sm font-semibold ${toneTextClass[riskTone(record.risk)]}`}>
          {drivingStatus}
        </Text>
        {isDemo && onDelete && (
          <Pressable onPress={onDelete} className="px-2 py-1 bg-red-100 rounded-md border border-red-200">
            <Text className="text-red-700 text-xs font-bold">삭제</Text>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}
