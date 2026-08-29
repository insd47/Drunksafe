import type { UserBaseline } from '@/lib/storage/profile';

const minEliminationMgLPerHourX1000 = 20;
const maxEliminationMgLPerHourX1000 = 120;
const maxUsableSoberBaselineMgLX1000 = 50;

export type SessionSoberEstimate = {
  minutes: number;
  eliminationMgLPerHourX1000: number;
  alcoholAboveBaselineMgLX1000: number;
};

/**
 * Current-reading estimate using the user's stored post-peak linear elimination
 * rate. This is intentionally not a statistical confidence interval and must
 * not be presented as a safe-to-drive time.
 */
export function estimateSessionSoberTime(
  alcoholMgLX1000: number,
  baseline: UserBaseline
): SessionSoberEstimate | null {
  const rate = baseline.elimination_mg_l_per_hour_x1000;
  if (
    rate === null ||
    rate < minEliminationMgLPerHourX1000 ||
    rate > maxEliminationMgLPerHourX1000
  ) {
    return null;
  }

  const soberReference =
    baseline.sober_alcohol_mg_l_x1000 !== null &&
    baseline.sober_alcohol_mg_l_x1000 <= maxUsableSoberBaselineMgLX1000
      ? baseline.sober_alcohol_mg_l_x1000
      : 0;
  const aboveBaseline = Math.max(0, alcoholMgLX1000 - soberReference);

  return {
    minutes: Math.min(65535, Math.ceil((aboveBaseline * 60) / rate)),
    eliminationMgLPerHourX1000: rate,
    alcoholAboveBaselineMgLX1000: aboveBaseline,
  };
}
