import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { usePulseReading, usePulseReadingReceivedAt } from '@/lib/ble/session';
import { pulseFeedback, pulseReadingFreshnessMs } from '@/lib/ble/pulse-feedback';

const reasonCopy: Record<string, string> = {
  poor_contact: '센서 접촉 상태가 2회 연속 좋지 않아 다시 측정합니다.',
  insufficient_intervals: '유효한 박동 간격이 8개보다 적어 다시 측정합니다.',
  invalid_pulse_signal: '중앙값에서 벗어난 박동 간격이 너무 많아 다시 측정합니다.',
  ibi_unstable: '박동 간격의 변동이 커서 다시 측정합니다.',
  sample_gap: '샘플 간격이 길게 끊겨 필터와 측정을 다시 시작합니다.',
  insufficient_time_for_retry: '이번 1분 구간에는 20초 재측정 시간이 부족합니다.',
  measurement_finished_after_deadline: '측정이 1분 구간 마감 전에 완료되지 않았습니다.',
  slot_deadline: '이번 1분 구간에서 유효 심박을 얻지 못했습니다.',
};

export function PulseContactGuide({ sessionId, sessionMode = false }: Props) {
  const reading = usePulseReading();
  const receivedAt = usePulseReadingReceivedAt();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const fresh =
    reading?.session_id === sessionId &&
    now - receivedAt <= pulseReadingFreshnessMs(reading, sessionMode);
  const feedback = pulseFeedback(reading, fresh);
  const locallyElapsed =
    fresh && reading && (reading.phase === 'warmup' || reading.phase === 'collecting')
      ? Math.max(0, now - receivedAt)
      : 0;
  const progress =
    fresh && reading
      ? Math.min(1, ((reading.attempt_elapsed_ms ?? 0) + locallyElapsed) / 20_000)
      : 0;
  const failure =
    fresh && reading
      ? (reasonCopy[reading.reason ?? ''] ?? reasonCopy[reading.last_failure ?? ''])
      : undefined;
  return (
    <View className="w-full gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
      <Text className="text-base font-semibold text-gray-950" accessibilityLiveRegion="polite">
        {feedback.title}
      </Text>
      <View className="h-3 overflow-hidden rounded-full bg-gray-200">
        <View className="h-full bg-gray-950" style={{ width: `${progress * 100}%` }} />
      </View>
      <Text className="text-xs text-gray-600">
        {fresh && reading
          ? reading.phase === 'waiting_next'
            ? '이번 1분 측정 완료 · 다음 구간 대기'
            : `20초 측정 ${Math.min(20, Math.floor(((reading.attempt_elapsed_ms ?? 0) + locallyElapsed) / 1000))}초 / 20초`
          : '측정 상태 수신 대기'}
      </Text>
      <View className="flex-row gap-2" accessibilityLabel={feedback.title}>
        {[1, 2, 3, 4].map((level) => (
          <View
            key={level}
            style={{
              flex: 1,
              height: 10,
              borderRadius: 5,
              backgroundColor:
                feedback.level >= level
                  ? feedback.level === 4
                    ? '#15803d'
                    : '#d97706'
                  : '#d1d5db',
            }}
          />
        ))}
      </View>
      <Text className="text-sm text-gray-800">
        추정 BPM {fresh && reading && reading.bpm > 0 ? reading.bpm.toFixed(0) : '--'} · 유효 IBI{' '}
        {fresh && reading
          ? (reading.accepted_intervals ?? Math.max(0, reading.peak_count - 1))
          : '--'}
        개 · IBI 변동{' '}
        {fresh && reading && reading.peak_count >= 2 ? reading.ibi_stddev_ms.toFixed(0) : '--'}ms
      </Text>
      {failure ? (
        <Text className="text-sm font-medium leading-5 text-amber-800">{failure}</Text>
      ) : null}
      {sessionMode && fresh && reading ? (
        <Text className="text-xs text-gray-600">
          {(reading.slot_index ?? 0) + 1}번째 1분 구간 · 이번 구간 재시도{' '}
          {reading.failed_attempts ?? 0}회 · 연속 누락 {reading.consecutive_misses ?? 0}분
        </Text>
      ) : null}
      <Text className="text-xs leading-5 text-gray-600">{feedback.hint}</Text>
      <Text className="text-xs leading-5 text-gray-500">
        센서가 뜨거우면 즉시 피부에서 떼고 전원을 분리하세요.
      </Text>
    </View>
  );
}

type Props = { sessionId: string; sessionMode?: boolean };
