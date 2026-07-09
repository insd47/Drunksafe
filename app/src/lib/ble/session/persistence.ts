import type { MeasurementResult } from '@/lib/ble/model';
import { saveBaselineFromResult } from '@/lib/ble/session/baseline';
import {
  savedResultMessage,
  shouldUpdateSoberBaseline,
} from '@/lib/personalization/baseline-acceptance';
import { recordFromResult, saveMeasurement } from '@/lib/storage/history';

export async function persistMeasurementResult(result: MeasurementResult) {
  let baselineAccepted: boolean | null = null;

  try {
    const { inserted } = await saveMeasurement(recordFromResult(result));

    if (result.kind === 'baseline') {
      baselineAccepted = shouldUpdateSoberBaseline(result);

      if (baselineAccepted && inserted) await saveBaselineFromResult(result);
    }

    return {
      saved: true,
      message: savedResultMessage({ kind: result.kind, baselineAccepted }),
    };
  } catch {
    return { saved: false, message: '결과 저장에 실패했습니다.' };
  }
}
