import { Text, View } from 'react-native';

import type { PpgPoint } from '@/lib/ble/session';

const defaultWindow = 200;

/** PPG raw waveform을 의존성 없이 얇은 막대 그래프로 그린다. 최근 `maxPoints`개만 보여준다. */
export function PpgSparkline({
  points,
  maxPoints = defaultWindow,
}: {
  points: PpgPoint[];
  maxPoints?: number;
}) {
  const windowPoints = points.slice(-maxPoints);

  if (windowPoints.length === 0) {
    return (
      <View className="h-28 items-center justify-center border border-gray-200 bg-gray-50">
        <Text className="text-xs text-gray-400">측정을 시작하면 PPG 파형이 여기 표시됩니다</Text>
      </View>
    );
  }

  const raws = windowPoints.map((point) => point.raw);
  const min = Math.min(...raws);
  const max = Math.max(...raws);
  const range = max - min;

  return (
    <View className="h-28 flex-row items-end gap-px overflow-hidden border border-gray-200 bg-gray-50 px-1">
      {windowPoints.map((point, index) => {
        const percent = range === 0 ? 50 : ((point.raw - min) / range) * 100;

        return (
          <View
            className="flex-1 bg-gray-950"
            key={index}
            style={{ height: `${Math.max(2, percent)}%` }}
          />
        );
      })}
    </View>
  );
}
