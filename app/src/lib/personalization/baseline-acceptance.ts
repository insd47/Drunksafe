import type { MeasurementRecord } from '@/lib/storage/history';

export const maxSoberBaselineAlcoholMgLX1000 = 50;
export const minRestingBaselineBpm = 60;
export const maxRestingBaselineBpm = 90;

export type BaselineIssue = 'missing' | 'heart_rate' | 'alcohol';

export function shouldUpdateSoberBaseline(result: MeasurementRecord) {
  return shouldAcceptSoberBaselineSample({
    risk: result.risk,
    alcohol_mg_l_x1000: result.alcohol_mg_l_x1000,
    pulse_bpm: result.pulse_bpm,
    pulse_stable: result.pulse_stable,
  });
}

export function shouldAcceptSoberBaselineSample({
  risk,
  alcohol_mg_l_x1000,
  pulse_bpm,
  pulse_stable,
}: {
  risk: MeasurementRecord['risk'];
  alcohol_mg_l_x1000: number;
  pulse_bpm: number | null;
  pulse_stable: boolean | null;
}) {
  return (
    risk === 'safe' &&
    alcohol_mg_l_x1000 <= maxSoberBaselineAlcoholMgLX1000 &&
    pulse_stable === true &&
    pulse_bpm !== null &&
    pulse_bpm >= minRestingBaselineBpm &&
    pulse_bpm <= maxRestingBaselineBpm
  );
}

export function baselineIssues(value: {
  sample_count?: number;
  risk?: MeasurementRecord['risk'];
  sober_alcohol_mg_l_x1000?: number | null;
  alcohol_mg_l_x1000?: number;
  resting_bpm?: number | null;
  pulse_bpm?: number | null;
  pulse_stable?: boolean | null;
}): BaselineIssue[] {
  const issues: BaselineIssue[] = [];
  const bpm = value.pulse_bpm ?? value.resting_bpm ?? null;
  const alcohol = value.alcohol_mg_l_x1000 ?? value.sober_alcohol_mg_l_x1000 ?? null;
  if (value.sample_count !== undefined && value.sample_count < 1) issues.push('missing');
  if (
    (value.pulse_stable !== undefined && value.pulse_stable !== true) ||
    bpm === null ||
    bpm < minRestingBaselineBpm ||
    bpm > maxRestingBaselineBpm
  )
    issues.push('heart_rate');
  if (
    (value.risk !== undefined && value.risk !== 'safe') ||
    alcohol === null ||
    alcohol > maxSoberBaselineAlcoholMgLX1000
  )
    issues.push('alcohol');
  return [...new Set(issues)];
}

export function baselineIssueCopy(issue: BaselineIssue) {
  if (issue === 'heart_rate')
    return {
      title: '휴식 구간의 심박수가 아닙니다',
      description:
        '심박수가 60~90 BPM 범위가 아니거나 아직 안정적이지 않습니다. 충분히 휴식한 뒤 편한 자세로 다시 측정해 주세요.',
    };
  if (issue === 'alcohol')
    return {
      title: 'BrAC가 높아 기준값으로 사용할 수 없습니다',
      description:
        '알코올을 이미 섭취했거나 기기 내부에 잔류 성분이 있을 수 있습니다. 음주하지 않은 상태에서 기기를 충분히 환기한 뒤 다시 측정해 주세요.',
    };
  return { title: '저장된 기준값이 없습니다', description: '먼저 기준값 측정을 완료해 주세요.' };
}

export function savedResultMessage({
  kind,
  baselineAccepted,
}: {
  kind: 'measurement' | 'baseline';
  baselineAccepted: boolean | null;
}) {
  if (kind === 'baseline' && baselineAccepted === false) {
    return '결과를 히스토리에 저장했지만, 개인 baseline에는 반영하지 않았습니다.';
  }

  return '결과를 히스토리에 저장했습니다.';
}
