import { useEffect, useState } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { PpgSparkline } from '@/components/ppg-sparkline';
import { Screen } from '@/components/screen';
import { Section } from '@/components/section';
import { StatusRow } from '@/components/status-row';
import { formatBac, formatMeasuredAt } from '@/lib/format/measurement';
import { analyzeSession, type SessionInsight } from '@/lib/personalization/session-insight';
import { estimateSessionSoberTime } from '@/lib/personalization/session-sober-time';
import { formatSessionMeasurementTitle, sessionMeasurementNumber } from '@/lib/sessions/identity';
import { readBaseline, type UserBaseline } from '@/lib/storage/profile';
import { readSession, readSessionIndex, type StoredSession } from '@/lib/storage/sessions';

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | {
      phase: 'ready';
      insight: SessionInsight;
      downloadedAtUnixMs: number;
      measurementNumber: number;
      baseline: UserBaseline;
    };

export default function SessionDetailRoute() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [showAllAlcoholResults, setShowAllAlcoholResults] = useState(false);

  useEffect(() => {
    let mounted = true;

    Promise.all([readSession(id), readSessionIndex(), readBaseline()])
      .then(([session, index, baseline]) => {
        if (!mounted) {
          return;
        }

        if (!session) {
          setState({ phase: 'error' });
          return;
        }

        const summary = index.find((item) => item.id === id);
        const insight = analyzeSession(
          session,
          summary?.elimination_mg_l_per_hour_x1000 ?? null,
          baseline.resting_bpm
        );
        setState({
          phase: 'ready',
          insight,
          downloadedAtUnixMs: session.downloaded_at_unix_ms,
          measurementNumber: sessionMeasurementNumber(index, {
            id: session.id,
            downloaded_at_unix_ms: session.downloaded_at_unix_ms,
          }),
          baseline: sessionEstimateBaseline(session, baseline),
        });
      })
      .catch(() => {
        if (mounted) {
          setState({ phase: 'error' });
        }
      });

    return () => {
      mounted = false;
    };
  }, [id]);

  if (state.phase === 'loading') {
    return (
      <>
        <Stack.Screen options={{ title: '세션 기록' }} />
        <Screen>
          <Text className="text-sm text-gray-500">세션 기록을 불러오는 중입니다…</Text>
        </Screen>
      </>
    );
  }

  if (state.phase === 'error') {
    return (
      <>
        <Stack.Screen options={{ title: '세션 기록' }} />
        <Screen>
          <View className="gap-1 border border-gray-200 p-4">
            <Text className="text-sm font-semibold text-gray-950">세션 기록을 찾지 못했습니다</Text>
            <Text className="text-xs leading-5 text-gray-500">
              데이터가 삭제됐거나 손상됐습니다.
            </Text>
          </View>
        </Screen>
      </>
    );
  }

  const { insight, baseline } = state;
  const indexedAlcoholMeasurements = insight.alcoholMeasurements.map((measurement, index) => ({
    measurement,
    index,
  }));
  const visibleAlcoholMeasurements = showAllAlcoholResults
    ? indexedAlcoholMeasurements
    : indexedAlcoholMeasurements.slice(-1);

  return (
    <>
      <Stack.Screen
        options={{
          title: formatSessionMeasurementTitle(state.downloadedAtUnixMs, state.measurementNumber),
        }}
      />
      <Screen>
        <Section eyebrow="Session" title="음주 세션 요약">
          <StatusRow label="측정 시간" value={formatDuration(insight.durationMs)} />
          <StatusRow
            label="분해속도(추정)"
            value={formatElimination(insight.eliminationMgLPerHourX1000)}
          />
          <StatusRow label="BAC 상한" value={formatBac(insight.bacUpperMilliPercent)} />
          <StatusRow
            label="최고 알코올"
            value={`${(insight.peakAlcoholMgLX1000 / 1000).toFixed(3)} mg/L`}
          />
          <StatusRow label="음주 확인" value={insight.drinkConfirmed ? '예' : '아니오'} />
        </Section>

        <Section
          action={
            insight.alcoholMeasurements.length > 1 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showAllAlcoholResults }}
                onPress={() => setShowAllAlcoholResults((open) => !open)}>
                <Text className="text-sm font-semibold text-gray-700">
                  {showAllAlcoholResults
                    ? '접기'
                    : `더보기 (${insight.alcoholMeasurements.length})`}
                </Text>
              </Pressable>
            ) : null
          }
          eyebrow="Alcohol"
          title="측정별 분해 예상 시간">
          {insight.alcoholMeasurements.length === 0 ? (
            <StatusRow label="알코올 측정" value="기록 없음" />
          ) : null}
          {visibleAlcoholMeasurements.map(({ measurement, index }) => {
            const estimate = estimateSessionSoberTime(measurement.mgLX1000, baseline);
            return (
              <StatusRow
                description={`${formatMeasuredAt(measurement.measuredAtUnixMs)} · BrAC ${(measurement.mgLX1000 / 1000).toFixed(3)} mg/L${estimate ? ` · 개인 분해속도 ${(estimate.eliminationMgLPerHourX1000 / 1000).toFixed(3)} mg/L·h 적용` : ''}`}
                key={`${measurement.elapsedMs}-${index}`}
                label={`${index + 1}차 알코올 측정`}
                value={estimate ? `약 ${formatEstimateMinutes(estimate.minutes)}` : '추정 불가'}
              />
            );
          })}
        </Section>

        <Section eyebrow="Heart" title="심박수 추이">
          {insight.hrTrend.length > 0 ? (
            <PpgSparkline points={insight.hrTrend} />
          ) : (
            <StatusRow label="심박 데이터" value="없음" />
          )}
          <StatusRow label="안정 심박(R0)" value={formatBpm(insight.hr.r0)} />
          <StatusRow
            label="평균 / 최고"
            value={`${formatBpm(insight.hr.avg)} / ${formatBpm(insight.hr.max)}`}
          />
          <StatusRow
            label="R0 대비 변화"
            value={insight.hr.peakDeltaVsR0 === null ? '-' : `+${insight.hr.peakDeltaVsR0} BPM`}
          />
        </Section>

        <Section eyebrow="Advice" title="참고 조언">
          {insight.advice.map((line, index) => (
            <Text className="text-sm leading-6 text-gray-800" key={index}>
              • {line}
            </Text>
          ))}
        </Section>

        <View className="border border-gray-200 p-4">
          <Text className="text-xs leading-5 text-gray-500">
            이 정보는 의료 조언이 아니라 참고용 추정입니다. 실제 운전 가능 여부는 법적 기준과 본인
            상태에 따라 신중히 판단하세요.
          </Text>
        </View>
      </Screen>
    </>
  );
}

function sessionEstimateBaseline(session: StoredSession, current: UserBaseline): UserBaseline {
  return {
    ...current,
    sober_alcohol_mg_l_x1000:
      session.sober_alcohol_mg_l_x1000_at_start === undefined
        ? current.sober_alcohol_mg_l_x1000
        : session.sober_alcohol_mg_l_x1000_at_start,
    elimination_mg_l_per_hour_x1000:
      session.elimination_mg_l_per_hour_x1000_at_start === undefined
        ? current.elimination_mg_l_per_hour_x1000
        : session.elimination_mg_l_per_hour_x1000_at_start,
  };
}

function formatDuration(ms: number) {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return hours > 0 ? `${hours}시간 ${minutes}분` : `${minutes}분`;
}

function formatElimination(mgLPerHourX1000: number | null) {
  return mgLPerHourX1000 === null ? '추정 불가' : `${(mgLPerHourX1000 / 1000).toFixed(3)} mg/L·h`;
}

function formatBpm(bpm: number | null) {
  return bpm === null ? '-' : `${bpm} BPM`;
}

function formatEstimateMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}시간` : `${hours}시간 ${remainder}분`;
}
