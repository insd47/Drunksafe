import type { MeasurementResult } from '@/lib/ble/model';

export const maxSoberBaselineAlcoholMgLX1000 = 50;

export function shouldUpdateSoberBaseline(result: MeasurementResult) {
  return shouldAcceptSoberBaselineSample({
    risk: result.risk,
    alcohol_mg_l_x1000: result.alcohol.mg_l_x1000,
  });
}

export function shouldAcceptSoberBaselineSample({
  risk,
  alcohol_mg_l_x1000,
}: {
  risk: MeasurementResult['risk'];
  alcohol_mg_l_x1000: number;
}) {
  return risk === 'safe' && alcohol_mg_l_x1000 <= maxSoberBaselineAlcoholMgLX1000;
}

export function baselineResultDescription({
  risk,
  alcohol_mg_l_x1000,
}: {
  risk: MeasurementResult['risk'];
  alcohol_mg_l_x1000: number;
}) {
  return shouldAcceptSoberBaselineSample({ risk, alcohol_mg_l_x1000 })
    ? '개인 sober 기준값에 반영 가능한 결과입니다.'
    : '히스토리에는 저장하지만 sober baseline에는 반영하지 않습니다.';
}

export function savedResultMessage({
  kind,
  baselineAccepted,
}: {
  kind: 'measurement' | 'baseline';
  baselineAccepted: boolean | null;
}) {
  if (kind === 'baseline' && baselineAccepted === false) {
    return '결과를 히스토리에 저장했습니다. Baseline 조건은 충족하지 못했습니다.';
  }

  return '결과를 히스토리에 저장했습니다.';
}
