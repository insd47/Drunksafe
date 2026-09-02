
import type { MeasurementResult } from '@/lib/ble/model';
import type { UserBaseline } from '@/lib/storage/profile';

const legalLimitMilliPercent = 30;
const cautionMilliPercent = 15;
const defaultBracNoiseMgLX1000 = 10;
const minEliminationMgLPerHourX1000 = 20;
const maxEliminationMgLPerHourX1000 = 120;
const maxSoberBaselineMgLX1000 = 50;
const maxSoberBaselineMadMgLX1000 = 50;

/** raw 측정값과 앱 로컬 상태로 보수적인 운전 위험 분석을 계산한다. */
export function analyzeMeasurement(
  result: MeasurementResult,
  state: MeasurementAnalysisState
): MeasurementAnalysis {
  const alcohol = result.alcohol_mg_l_x1000;
  const baseline = soberBaselineMgLX1000(state.baseline) ?? 0;
  const correctedAlcohol = Math.max(0, alcohol - baseline);
  const upperAlcohol = upperAlcoholMgLX1000(alcohol, state.baseline);
  const rawBac = bracToBacMilliPercent(alcohol);
  const bacMilliPercent = bracToBacMilliPercent(correctedAlcohol);
  const bacUpperMilliPercent = Math.max(bracToBacMilliPercent(upperAlcohol), rawBac);

  return {
    bac_milli_percent: bacMilliPercent,
    bac_upper_milli_percent: bacUpperMilliPercent,
    risk: riskFromUpperBac(bacUpperMilliPercent),
    sober_time_minutes: soberTimeMinutes(
      upperAlcohol,
      bacUpperMilliPercent,
      state.baseline.elimination_mg_l_per_hour_x1000,
      state.conservativeEliminationMgLPerHourX1000
    ),
    confidence_percent: confidencePercent(result, state),
  };
}

function upperAlcoholMgLX1000(alcohol: number, baseline: UserBaseline) {
  const soberBaseline = soberBaselineMgLX1000(baseline) ?? 0;
  const soberBaselineMad = soberBaselineMadMgLX1000(baseline);
  const baselineNoise = Math.max(
    defaultBracNoiseMgLX1000,
    soberBaselineMad === null ? defaultBracNoiseMgLX1000 : soberBaselineMad * 3
  );

  return Math.max(0, alcohol - Math.max(0, soberBaseline - baselineNoise));
}

function soberBaselineMgLX1000(baseline: UserBaseline) {
  const value = baseline.sober_alcohol_mg_l_x1000;
  return value !== null && value <= maxSoberBaselineMgLX1000 ? value : null;
}

function soberBaselineMadMgLX1000(baseline: UserBaseline) {
  const value = baseline.sober_alcohol_mad_mg_l_x1000;
  return value === null ? null : Math.min(value, maxSoberBaselineMadMgLX1000);
}

export function bracToBacMilliPercent(alcoholMgLX1000: number) {
  return Math.min(65535, Math.floor((alcoholMgLX1000 * 21 + 50) / 100));
}

function soberTimeMinutes(
  upperAlcoholMgLX1000: number,
  bacUpperMilliPercent: number,
  storedEliminationMgLPerHourX1000: number | null,
  conservativeEliminationMgLPerHourX1000: number
) {
  if (upperAlcoholMgLX1000 === 0 || bacUpperMilliPercent < cautionMilliPercent) {
    return 0;
  }

  const eliminationMgLPerHourX1000 = validElimination(storedEliminationMgLPerHourX1000)
    ? storedEliminationMgLPerHourX1000
    : conservativeEliminationMgLPerHourX1000;

  return Math.min(65535, Math.ceil((upperAlcoholMgLX1000 * 60) / eliminationMgLPerHourX1000));
}

function validElimination(value: number | null): value is number {
  return (
    value !== null &&
    value >= minEliminationMgLPerHourX1000 &&
    value <= maxEliminationMgLPerHourX1000
  );
}

// @ts-ignore
function riskFromUpperBac(bacUpperMilliPercent: number): Risk {
  if (bacUpperMilliPercent >= legalLimitMilliPercent) {
    return 'danger';
  }

  if (bacUpperMilliPercent >= cautionMilliPercent) {
    return 'caution';
  }

  return 'safe';
}

function confidencePercent(result: MeasurementResult, state: MeasurementAnalysisState) {
  let confidence = 55;

  if (soberBaselineMgLX1000(state.baseline) !== null) {
    confidence += 10;
  }

  if (soberBaselineMadMgLX1000(state.baseline) !== null) {
    confidence += 5;
  }

  if (state.baseline.elimination_mg_l_per_hour_x1000 !== null) {
    confidence += 10;
  }

  if (state.recentMeasurementCount > 0) {
    confidence += 5;
  }

  const restingBpm = state.baseline.resting_bpm;

  if (restingBpm !== null && result.pulse.status === 'measured') {
    confidence += Math.abs(result.pulse.bpm - restingBpm) <= 20 ? 5 : -10;
  } else if (restingBpm !== null) {
    confidence -= 5;
  }

  return Math.min(90, confidence);
}

export interface MeasurementAnalysisState {
  baseline: UserBaseline;
  conservativeEliminationMgLPerHourX1000: number;
  recentMeasurementCount: number;
}

export interface MeasurementAnalysis {
  bac_milli_percent: number;
  bac_upper_milli_percent: number;
  risk: Risk;
  sober_time_minutes: number;
  confidence_percent: number;
}

export type Risk = 'safe' | 'caution' | 'danger';
