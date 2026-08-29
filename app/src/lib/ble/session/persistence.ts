import type { MeasurementResult } from '@/lib/ble/model';
import { shouldUpdateSoberBaseline } from '@/lib/personalization/baseline-acceptance';
import { recordFromResult, type MeasurementRecord } from '@/lib/storage/history-records';
import type { UserBaseline } from '@/lib/storage/profile';

const fallbackEliminationMgLPerHourX1000 = 62;

const emptyAnalysisBaseline: UserBaseline = {
  sober_alcohol_mg_l_x1000: null,
  sober_alcohol_mad_mg_l_x1000: null,
  elimination_mg_l_per_hour_x1000: null,
  resting_bpm: null,
  sample_count: 0,
  updated_at_unix_ms: null,
};

export type PersistedMeasurement = {
  record: MeasurementRecord;
  saved: boolean;
};

export async function persistMeasurementResult(
  result: MeasurementResult,
  measuredAtUnixMs: number
): Promise<PersistedMeasurement> {
  let record = recordFromResult(
    result,
    {
      baseline: emptyAnalysisBaseline,
      conservativeEliminationMgLPerHourX1000: fallbackEliminationMgLPerHourX1000,
      recentMeasurementCount: 0,
    },
    measuredAtUnixMs
  );

  try {
    const [{ readHistory, saveMeasurement }, profile] = await Promise.all([
      import('@/lib/storage/history'),
      import('@/lib/storage/profile'),
    ]);
    const [baseline, history] = await Promise.all([profile.readBaseline(), readHistory()]);
    record = recordFromResult(
      result,
      {
        baseline,
        conservativeEliminationMgLPerHourX1000: profile.conservativeEliminationMgLPerHourX1000(),
        recentMeasurementCount: history.filter((item) => item.kind === 'measurement').length,
      },
      measuredAtUnixMs
    );
    const { inserted } = await saveMeasurement(record);

    if (result.kind === 'baseline' && inserted && shouldUpdateSoberBaseline(record)) {
      await profile.writeBaseline(baselineAfterResult(baseline, record));
    }

    return { record, saved: true };
  } catch {
    return { record, saved: false };
  }
}

export function baselineAfterResult(
  baseline: UserBaseline,
  result: MeasurementRecord
): UserBaseline {
  const alcohol = result.alcohol_mg_l_x1000;
  const stableBpm = result.pulse_stable ? clampU16(Math.round(result.pulse_bpm ?? 0)) : null;

  return {
    ...baseline,
    // A controlled baseline measurement replaces the reference. Averaging with an
    // old invalid baseline can pin later valid measurements near that stale value.
    sober_alcohol_mg_l_x1000: alcohol,
    sober_alcohol_mad_mg_l_x1000: 0,
    resting_bpm: stableBpm,
    sample_count: 1,
    updated_at_unix_ms: result.measured_at_unix_ms,
  };
}

function clampU16(value: number) {
  return Math.max(0, Math.min(65535, value));
}
