import type { MeasurementResult } from '@/lib/ble/model';
import { readBaseline, writeBaseline } from '@/lib/storage/profile';

export async function saveBaselineFromResult(result: MeasurementResult) {
  const baseline = await readBaseline();
  const previousCount = baseline.sample_count;
  const alcohol = result.alcohol.mg_l_x1000;
  const previousMean = baseline.sober_alcohol_mg_l_x1000;
  const alcoholDeviation = previousMean === null ? 0 : Math.abs(alcohol - previousMean);
  const stableBpm = result.pulse?.stable ? clampU16(Math.round(result.pulse.bpm)) : null;

  await writeBaseline({
    ...baseline,
    sober_alcohol_mg_l_x1000: rollingAverage(previousMean, previousCount, alcohol),
    sober_alcohol_mad_mg_l_x1000: rollingAverage(
      baseline.sober_alcohol_mad_mg_l_x1000,
      previousCount,
      alcoholDeviation
    ),
    resting_bpm:
      stableBpm === null
        ? baseline.resting_bpm
        : rollingAverage(baseline.resting_bpm, previousCount, stableBpm),
    sample_count: Math.min(previousCount + 1, 65535),
    updated_at_unix_ms: result.measured_at_unix_ms ?? Date.now(),
  });
}

function rollingAverage(previous: number | null, count: number, next: number) {
  if (previous === null || count <= 0) return clampU16(next);
  return clampU16(Math.round((previous * count + next) / (count + 1)));
}

function clampU16(value: number) {
  return Math.max(0, Math.min(65535, value));
}
