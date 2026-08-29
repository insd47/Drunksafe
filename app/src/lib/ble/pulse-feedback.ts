import type { PulseReading } from '@/lib/ble/model';

const defaultFreshnessMs = 3500;
const sessionAcquisitionFreshnessMs = 23_000;
const sessionReportGraceMs = 7000;
const sessionSlotMs = 60_000;

/**
 * Session telemetry is normally sent every five seconds. An accepted reading
 * must remain visible until the fixed minute ends instead of expiring between
 * packets and making the progress bar jump from 100% to 0%.
 */
export function pulseReadingFreshnessMs(reading: PulseReading | null, sessionMode: boolean) {
  if (!reading || !sessionMode) return defaultFreshnessMs;
  if (reading.stable && reading.phase === 'waiting_next') {
    const slotElapsed = Math.min(sessionSlotMs, reading.slot_elapsed_ms ?? sessionSlotMs);
    return Math.max(sessionReportGraceMs, sessionSlotMs - slotElapsed + sessionReportGraceMs);
  }
  if (reading.phase === 'warmup' || reading.phase === 'collecting') {
    return sessionAcquisitionFreshnessMs;
  }
  return sessionReportGraceMs;
}

export function pulseFeedback(reading: PulseReading | null, fresh: boolean) {
  if (!fresh || !reading) {
    return {
      level: 0,
      title: '신호 수신 대기',
      hint: '3초 이상 변화가 없으면 연결 상태와 ESP32 펌웨어 업데이트 여부를 확인하세요.',
    };
  }
  if (reading.peak_count === 0) {
    return {
      level: 1,
      title: '맥박 신호가 약합니다',
      hint: '손끝 위치를 조정하고 가만히 대세요. 이 표시만으로 미착용이나 배선 불량을 구분할 수는 없습니다.',
    };
  }
  if (reading.stable) {
    return {
      level: 4,
      title: '안정된 맥박 신호',
      hint: '저장 가능한 신호입니다. 결과가 나올 때까지 자세를 유지하세요.',
    };
  }
  if ((reading.accepted_intervals ?? Math.max(0, reading.peak_count - 1)) < 8) {
    return {
      level: 2,
      title: '맥박을 찾았습니다 · 수집 중',
      hint: '최소 8개의 유효 IBI가 필요합니다. 움직이지 말고 20초 측정을 유지해 주세요.',
    };
  }
  return {
    level: 3,
    title: '신호 안정화가 필요합니다',
    hint: '센서를 누르는 힘과 손의 움직임을 줄여 주세요. 표시 BPM은 아직 저장되지 않은 추정값입니다.',
  };
}

/** A late/retried packet from the same minute must not replace its accepted result. */
export function preserveCompletedMinute(
  current: PulseReading | null,
  incoming: PulseReading
): boolean {
  return (
    current?.session_id === incoming.session_id &&
    current.stable &&
    !incoming.stable &&
    current.slot_index != null &&
    current.slot_index === incoming.slot_index
  );
}
