import { Text, View } from 'react-native';

import { cn } from '@/lib/utils/cn';

export function StatusRow({ label, value, description, tone = 'neutral' }: Props) {
  return (
    <View className="flex-row items-center justify-between gap-4 py-3">
      <View className="min-w-0 flex-1 gap-1">
        <Text className="text-sm font-medium text-gray-950">{label}</Text>
        {description ? (
          <Text className="text-xs leading-5 text-gray-500">{description}</Text>
        ) : null}
      </View>
      <Text className={cn('shrink-0 text-right text-sm font-semibold', toneClass[tone])}>
        {value}
      </Text>
    </View>
  );
}

type Tone = 'neutral' | 'safe' | 'caution' | 'danger';

type Props = {
  label: string;
  value: string;
  description?: string;
  tone?: Tone;
};

const toneClass: Record<Tone, string> = {
  neutral: 'text-gray-950',
  safe: 'text-emerald-700',
  caution: 'text-amber-700',
  danger: 'text-red-700',
};
