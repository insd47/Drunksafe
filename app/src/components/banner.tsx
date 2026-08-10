import { Text, View } from 'react-native';

import { cn } from '@/lib/utils/cn';

export function Banner({ tone, title, description }: Props) {
  return (
    <View className={cn('gap-1 border p-4', boxClass[tone])}>
      <Text className={cn('text-sm font-semibold', titleClass[tone])}>{title}</Text>
      {description ? (
        <Text className={cn('text-xs leading-5', descriptionClass[tone])}>{description}</Text>
      ) : null}
    </View>
  );
}

type BannerTone = 'info' | 'caution' | 'danger';

type Props = {
  tone: BannerTone;
  title: string;
  description?: string;
};

const boxClass: Record<BannerTone, string> = {
  info: 'border-gray-300 bg-gray-50',
  caution: 'border-amber-400 bg-amber-50',
  danger: 'border-red-400 bg-red-50',
};

const titleClass: Record<BannerTone, string> = {
  info: 'text-gray-950',
  caution: 'text-amber-800',
  danger: 'text-red-800',
};

const descriptionClass: Record<BannerTone, string> = {
  info: 'text-gray-600',
  caution: 'text-amber-700',
  danger: 'text-red-700',
};
