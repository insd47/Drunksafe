import type { StoredSession } from '@/lib/storage/sessions';

const alcoholPositiveMgLX1000 = 20;

export type SessionHrStats = {
  count: number;
  min: number | null;
  max: number | null;
  avg: number | null;
  /** 앱의 기준값 측정으로 저장된 개인 휴식 심박. */
  r0: number | null;
  /** 최고 심박 − R0 (음주 중 상승폭). */
  peakDeltaVsR0: number | null;
};

export type SessionInsight = {
  durationMs: number;
  eliminationMgLPerHourX1000: number | null;
  peakAlcoholMgLX1000: number;
  bacUpperMilliPercent: number;
  drinkConfirmed: boolean;
  alcoholMeasurements: { elapsedMs: number; measuredAtUnixMs: number; mgLX1000: number }[];
  hr: SessionHrStats;
  /** 심박 추이 스파크라인용 (bpm을 raw로). */
  hrTrend: { t: number; raw: number }[];
  advice: string[];
};

/** 저장된 세션 원본에서 요약 지표(분해속도·BAC 상한·심박 추이·조언)를 계산한다. */
export function analyzeSession(
  session: StoredSession,
  eliminationMgLPerHourX1000: number | null,
  fallbackRestingBpm: number | null = null
): SessionInsight {
  const samples = session.samples;
  const durationMs = samples.reduce((max, sample) => Math.max(max, sample.t_ms), 0);

  const alcoholMeasurements = samples
    .filter((sample) => sample.kind === 'alcohol' && sample.mg_l_x1000 !== null)
    .map((sample) => ({
      elapsedMs: sample.t_ms,
      measuredAtUnixMs: sample.at_unix_ms,
      mgLX1000: sample.mg_l_x1000 as number,
    }));
  const alcoholValues = alcoholMeasurements.map((sample) => sample.mgLX1000);
  const peakAlcohol = alcoholValues.length > 0 ? Math.max(...alcoholValues) : 0;
  const bacUpper = bracToBacMilliPercent(peakAlcohol);

  const heartSamples = samples.filter((sample) => sample.kind === 'heart' && sample.bpm !== null);
  const bpms = heartSamples.map((sample) => sample.bpm as number);
  const min = bpms.length > 0 ? Math.min(...bpms) : null;
  const max = bpms.length > 0 ? Math.max(...bpms) : null;
  const avg = bpms.length > 0 ? Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length) : null;
  // R0 must never be inferred from the first/lowest values in this drinking
  // session. New records preserve the baseline used at session start; legacy
  // records may use the currently saved measured baseline supplied by the UI.
  const r0 = session.resting_bpm ?? fallbackRestingBpm;
  const peakDeltaVsR0 = r0 !== null && max !== null ? max - r0 : null;

  const hrTrend = heartSamples.map((sample) => ({ t: sample.t_ms, raw: sample.bpm as number }));
  const drinkConfirmed =
    samples.some((sample) => sample.kind === 'drink_confirmed') ||
    alcoholValues.some((value) => value >= alcoholPositiveMgLX1000);

  return {
    durationMs,
    eliminationMgLPerHourX1000,
    peakAlcoholMgLX1000: peakAlcohol,
    bacUpperMilliPercent: bacUpper,
    drinkConfirmed,
    alcoholMeasurements,
    hr: { count: bpms.length, min, max, avg, r0, peakDeltaVsR0 },
    hrTrend,
    advice: buildAdvice(bacUpper, peakDeltaVsR0),
  };
}

/** BrAC(mg/L×1000) → BAC 밀리퍼센트. 호흡:혈중 2100:1 비율(21/100). */
function bracToBacMilliPercent(alcoholMgLX1000: number): number {
  return Math.min(65535, Math.floor((alcoholMgLX1000 * 21 + 50) / 100));
}

/** 규칙 기반 참고 조언 (의료 진단 아님). */
function buildAdvice(bacUpperMilliPercent: number, peakDeltaVsR0: number | null): string[] {
  const advice: string[] = [];

  if (bacUpperMilliPercent >= 30) {
    advice.push('혈중 알코올이 법적 운전 기준(0.03%)을 넘었을 수 있습니다. 절대 운전하지 마세요.');
  } else if (bacUpperMilliPercent >= 15) {
    advice.push('알코올이 아직 남아 있을 수 있습니다. 운전을 미루고 충분히 쉬세요.');
  } else {
    advice.push('측정된 알코올이 낮습니다. 그래도 컨디션에 따라 운전은 신중히 판단하세요.');
  }

  if (peakDeltaVsR0 !== null && peakDeltaVsR0 >= 20) {
    advice.push(
      '음주 중 심박이 안정 시보다 크게 올랐습니다. 수분을 충분히 섭취하고 무리하지 마세요.'
    );
  }

  advice.push('물을 충분히 마시고, 공복 음주와 취침 직전 과음을 피하세요.');
  return advice;
}
