import type { SessionRecord } from '@/lib/ble/model';

const fittingProfileKey = 'drunksafe.alcohol-fitting.v2';
const relativeError = 0.21;
const minimumRetention = 0.8;
const bootstrapRuns = 2000;
export const fittingEndMgLX1000 = 10;

export type FittingGrade = 'A' | 'B' | 'C' | 'D' | 'E' | 'unsuitable';

export type AlcoholFittingProfile = {
  kPerMinute: number;
  kLowPerMinute: number;
  kHighPerMinute: number;
  source: 'device_fitting' | 'developer_input' | 'demo';
  updatedAtUnixMs: number;
  diagnostics?: {
    c0: number;
    peakAtMs: number;
    totalDescentPoints: number;
    includedPoints: number;
    excludedIndices: number[];
    reIncludedIndices: number[];
    rSquare: number;
    rmse: number;
    grade: FittingGrade;
    k21Low: number | null;
    k21High: number | null;
    k95Low: number;
    k95High: number;
    kJointLow: number | null;
    kJointHigh: number | null;
    appliedRange: 'kjoint' | 'k95';
  };
};

export type ExponentialSoberEstimate = {
  minutes: number;
  earliestMinutes: number;
  latestMinutes: number;
  kPerMinute: number;
};

type Point = { tMs: number; value: number; sourceIndex: number };

export async function readFittingProfile() {
  const { readJson } = await import('@/lib/storage/json');
  return readJson<AlcoholFittingProfile | null>(fittingProfileKey, () => null, isProfile);
}

export async function writeFittingProfile(profile: AlcoholFittingProfile) {
  if (!isProfile(profile)) throw new Error('유효하지 않은 fitting 값입니다.');
  const { writeJson } = await import('@/lib/storage/json');
  await writeJson(fittingProfileKey, profile);
}

export async function removeFittingProfile() {
  const { removeJson } = await import('@/lib/storage/json');
  await removeJson(fittingProfileKey);
}

/** PDF 10쪽: Kjoint와 현재 농도의 21% 구간을 함께 적용해 Ct=10 도달 시간을 계산한다. */
export function estimateExponentialSoberTime(
  alcoholMgLX1000: number,
  profile: AlcoholFittingProfile | null
): ExponentialSoberEstimate | null {
  if (!profile) return null;
  if (alcoholMgLX1000 <= fittingEndMgLX1000) {
    return { minutes: 0, earliestMinutes: 0, latestMinutes: 0, kPerMinute: profile.kPerMinute };
  }
  const sigma = Math.max(1, relativeError * alcoholMgLX1000);
  const concentrationLow = Math.max(fittingEndMgLX1000, alcoholMgLX1000 - sigma);
  const concentrationHigh = alcoholMgLX1000 + sigma;
  return {
    minutes: Math.ceil(Math.log(alcoholMgLX1000 / fittingEndMgLX1000) / profile.kPerMinute),
    earliestMinutes: Math.ceil(
      Math.max(0, Math.log(concentrationLow / fittingEndMgLX1000) / profile.kHighPerMinute)
    ),
    latestMinutes: Math.ceil(
      Math.log(concentrationHigh / fittingEndMgLX1000) / profile.kLowPerMinute
    ),
    kPerMinute: profile.kPerMinute,
  };
}

/** PDF 알고리즘 1B와 5~10쪽의 fitting, K21, K95, Kjoint를 구현한다. */
export function fitExponentialProfile(records: SessionRecord[]): AlcoholFittingProfile | null {
  const all = records
    .filter((record) => record.kind === 'alcohol' && record.mg_l_x1000 !== null)
    .sort((left, right) => left.t_ms - right.t_ms)
    .map((record, sourceIndex) => ({
      tMs: record.t_ms,
      value: record.mg_l_x1000 ?? 0,
      sourceIndex,
    }));
  if (all.length < 4) return null;
  let peakIndex = 0;
  for (let index = 1; index < all.length; index += 1) {
    if ((all[index]?.value ?? 0) > (all[peakIndex]?.value ?? 0)) peakIndex = index;
  }
  const peak = all[peakIndex];
  if (!peak || peak.value <= fittingEndMgLX1000) return null;
  const descent = all.slice(peakIndex);
  if (descent.length < 4) return null;

  const initialK = fitK(descent, peak.value, peak.tMs);
  const ranked = descent
    .map((point, index) => ({ index, error: standardizedAbsoluteError(point, peak, initialK) }))
    .sort((left, right) => left.error - right.error);
  const selected = new Set(ranked.filter((item) => item.error <= 1).map((item) => item.index));
  const minimumCount = Math.ceil(descent.length * minimumRetention);
  const reIncluded = new Set<number>();
  for (const item of ranked) {
    if (selected.size >= minimumCount) break;
    if (!selected.has(item.index)) {
      selected.add(item.index);
      reIncluded.add(item.index);
    }
  }
  const included = descent.filter((_, index) => selected.has(index));
  if (included.length < 4 || included.length / descent.length < 0.7) return null;

  const k = fitK(included, peak.value, peak.tMs);
  const predictions = included.map((point) => predict(peak.value, k, point.tMs - peak.tMs));
  const values = included.map((point) => point.value);
  const rSquare = coefficientOfDetermination(values, predictions);
  const rmse = Math.sqrt(
    mean(values.map((value, index) => (value - (predictions[index] ?? 0)) ** 2))
  );
  const grade = fittingGrade(rSquare);
  const k21 = calculateK21(included, peak.value, peak.tMs);
  const k95 = calculateK95(included, peak.value, peak.tMs, k, predictions);
  const jointLow = k21 ? Math.max(k21.low, k95.low) : null;
  const jointHigh = k21 ? Math.min(k21.high, k95.high) : null;
  const jointValid = jointLow !== null && jointHigh !== null && jointLow <= jointHigh;
  const jointContainsEstimate = jointValid && jointLow <= k && k <= jointHigh;
  const appliedLow = Math.min(k, jointContainsEstimate ? jointLow : k95.low);
  const appliedHigh = Math.max(k, jointContainsEstimate ? jointHigh : k95.high);

  return {
    kPerMinute: k,
    kLowPerMinute: appliedLow,
    kHighPerMinute: appliedHigh,
    source: 'device_fitting',
    updatedAtUnixMs: Date.now(),
    diagnostics: {
      c0: peak.value,
      peakAtMs: peak.tMs,
      totalDescentPoints: descent.length,
      includedPoints: included.length,
      excludedIndices: descent.map((_, index) => index).filter((index) => !selected.has(index)),
      reIncludedIndices: [...reIncluded].sort((a, b) => a - b),
      rSquare,
      rmse,
      grade,
      k21Low: k21?.low ?? null,
      k21High: k21?.high ?? null,
      k95Low: k95.low,
      k95High: k95.high,
      kJointLow: jointValid ? jointLow : null,
      kJointHigh: jointValid ? jointHigh : null,
      appliedRange: jointContainsEstimate ? 'kjoint' : 'k95',
    },
  };
}

function fitK(points: Point[], c0: number, t0Ms: number) {
  let low = 0.000001;
  let high = 0.05;
  const loss = (k: number) =>
    points.reduce((sum, point) => {
      const sigma = Math.max(1, relativeError * Math.abs(point.value));
      const residual = point.value - predict(c0, k, point.tMs - t0Ms);
      return sum + (residual / sigma) ** 2;
    }, 0);
  for (let iteration = 0; iteration < 56; iteration += 1) {
    const left = low + (high - low) / 3;
    const right = high - (high - low) / 3;
    if (loss(left) < loss(right)) high = right;
    else low = left;
  }
  return (low + high) / 2;
}

function standardizedAbsoluteError(point: Point, peak: Point, k: number) {
  const sigma = Math.max(1, relativeError * Math.abs(point.value));
  return Math.abs(point.value - predict(peak.value, k, point.tMs - peak.tMs)) / sigma;
}

function calculateK21(points: Point[], c0: number, t0Ms: number) {
  let low = 0;
  let high = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const minutes = (point.tMs - t0Ms) / 60_000;
    if (minutes <= 0) continue;
    const sigma = Math.max(1, relativeError * Math.abs(point.value));
    low = Math.max(low, Math.max(0, Math.log(c0 / (point.value + sigma)) / minutes));
    if (point.value - sigma > 0) {
      high = Math.min(high, Math.log(c0 / (point.value - sigma)) / minutes);
    }
  }
  return low > 0 && Number.isFinite(high) && low <= high ? { low, high } : null;
}

function calculateK95(points: Point[], c0: number, t0Ms: number, k: number, predictions: number[]) {
  const sigmas = points.map((point) => Math.max(1, relativeError * Math.abs(point.value)));
  const residuals = points.map(
    (point, index) => (point.value - (predictions[index] ?? 0)) / (sigmas[index] ?? 1)
  );
  const residualMean = mean(residuals);
  const centered = residuals.map((residual) => residual - residualMean);
  const bootstrapped: number[] = [];
  let seed = 0x5f3759df;
  const random = () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed / 4_294_967_296;
  };
  for (let run = 0; run < bootstrapRuns; run += 1) {
    const synthetic = points.map((point, index) => {
      const sampled = centered[Math.floor(random() * centered.length)] ?? 0;
      const value = Math.max(
        0,
        Math.floor((predictions[index] ?? 0) + (sigmas[index] ?? 1) * sampled)
      );
      return { ...point, value };
    });
    bootstrapped.push(fitK(synthetic, c0, t0Ms));
  }
  bootstrapped.sort((left, right) => left - right);
  return {
    low: quantile(bootstrapped, 0.025) || k * 0.79,
    high: quantile(bootstrapped, 0.975) || k * 1.21,
  };
}

function predict(c0: number, k: number, elapsedMs: number) {
  return c0 * Math.exp(-k * (elapsedMs / 60_000));
}

function coefficientOfDetermination(actual: number[], predicted: number[]) {
  const average = mean(actual);
  const residual = actual.reduce(
    (sum, value, index) => sum + (value - (predicted[index] ?? 0)) ** 2,
    0
  );
  const total = actual.reduce((sum, value) => sum + (value - average) ** 2, 0);
  return total === 0 ? 0 : 1 - residual / total;
}

function fittingGrade(rSquare: number): FittingGrade {
  if (rSquare >= 0.9) return 'A';
  if (rSquare >= 0.85) return 'B';
  if (rSquare >= 0.8) return 'C';
  if (rSquare >= 0.75) return 'D';
  if (rSquare >= 0.7) return 'E';
  return 'unsuitable';
}

function quantile(values: number[], q: number) {
  if (values.length === 0) return 0;
  const position = (values.length - 1) * q;
  const lower = Math.floor(position);
  const fraction = position - lower;
  const left = values[lower] ?? 0;
  const right = values[lower + 1] ?? left;
  return left + (right - left) * fraction;
}

function mean(values: number[]) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isProfile(value: unknown): value is AlcoholFittingProfile {
  if (typeof value !== 'object' || value === null) return false;
  const profile = value as Record<string, unknown>;
  return (
    positive(profile.kPerMinute) &&
    positive(profile.kLowPerMinute) &&
    positive(profile.kHighPerMinute) &&
    (profile.kLowPerMinute as number) <= (profile.kPerMinute as number) &&
    (profile.kPerMinute as number) <= (profile.kHighPerMinute as number) &&
    (profile.source === 'device_fitting' ||
      profile.source === 'developer_input' ||
      profile.source === 'demo') &&
    typeof profile.updatedAtUnixMs === 'number'
  );
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
