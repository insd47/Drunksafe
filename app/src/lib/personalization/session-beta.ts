import type { SessionRecord, SessionStateLabel } from '@/lib/ble/model';

/** 하강 구간의 점이 최소 이만큼 있어야 회귀한다. */
const minTrackPoints = 3;
/** 피크 농도가 이 값(mg/L×1000)보다 낮으면 "마셨다"고 보기 어려워 회귀하지 않는다. */
const minPeakMgLX1000 = 20;

export type AlcoholPoint = { t_ms: number; mg_l_x1000: number };

/**
 * TRACK 알코올 점에서 **피크 이후 하강 구간만** 골라 선형(0차) 회귀로 개인 분해속도를
 * 추정한다. 반환 단위는 mg/L per hour ×1000. 상승만 하거나 값이 0뿐이면 null이다.
 * TRACK은 음주 확인 직후 시작하므로 흡수(상승) 구간이 섞여 있는데, 그 상승분을 회귀에
 * 넣으면 분해속도가 왜곡된다 — 그래서 피크를 찾아 그 뒤만 사용한다.
 * V1은 단순 최소제곱 회귀만 한다. 베이지안 축적/잔차 게이팅은 이후 개선.
 */
export function estimateEliminationMgLPerHourX1000(records: SessionRecord[]): number | null {
  const descent = descentFromPeak(trackAlcoholPoints(records));

  if (descent.length < minTrackPoints) {
    return null;
  }

  const slopePerMs = linearSlope(descent);

  if (slopePerMs === null) {
    return null;
  }

  // 하강 곡선이므로 기울기는 음수여야 한다. 분해속도 = -기울기 × (시간당 ms).
  const perHour = -slopePerMs * 3_600_000;

  if (!Number.isFinite(perHour) || perHour <= 0) {
    return null;
  }

  return Math.round(perHour);
}

/**
 * 최고 농도(피크) 지점을 찾아 그 지점부터 끝까지의 하강 구간만 돌려준다.
 * 피크가 너무 낮으면(사실상 0) 빈 배열을 돌려 회귀를 막는다.
 */
export function descentFromPeak(points: AlcoholPoint[]): AlcoholPoint[] {
  let peakIndex = -1;
  let peakValue = -1;

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (point !== undefined && point.mg_l_x1000 > peakValue) {
      peakValue = point.mg_l_x1000;
      peakIndex = index;
    }
  }

  if (peakIndex < 0 || peakValue < minPeakMgLX1000) {
    return [];
  }

  return points.slice(peakIndex);
}

/** state 전환을 따라가며 TRACK 동안 측정된 알코올 점만 모은다. */
export function trackAlcoholPoints(records: SessionRecord[]): AlcoholPoint[] {
  const ordered = [...records].sort((left, right) => left.index - right.index);
  let state: SessionStateLabel | null = null;
  const points: AlcoholPoint[] = [];

  for (const record of ordered) {
    if (record.kind === 'state' && record.state !== null) {
      state = record.state;
      continue;
    }

    if (record.kind === 'alcohol' && record.mg_l_x1000 !== null && state === 'track') {
      points.push({ t_ms: record.t_ms, mg_l_x1000: record.mg_l_x1000 });
    }
  }

  return points;
}

function linearSlope(points: AlcoholPoint[]): number | null {
  const n = points.length;
  const meanT = points.reduce((sum, point) => sum + point.t_ms, 0) / n;
  const meanY = points.reduce((sum, point) => sum + point.mg_l_x1000, 0) / n;

  let numerator = 0;
  let denominator = 0;

  for (const point of points) {
    const dt = point.t_ms - meanT;
    numerator += dt * (point.mg_l_x1000 - meanY);
    denominator += dt * dt;
  }

  if (denominator === 0) {
    return null;
  }

  return numerator / denominator;
}
