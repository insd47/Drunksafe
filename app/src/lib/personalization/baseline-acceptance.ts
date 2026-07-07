import type { MeasurementResult } from '@/lib/ble/model';

export const maxSoberBaselineAlcoholMgLX1000 = 50;

export function shouldUpdateSoberBaseline(result: MeasurementResult) {
  return result.risk === 'safe' && result.alcohol.mg_l_x1000 <= maxSoberBaselineAlcoholMgLX1000;
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
