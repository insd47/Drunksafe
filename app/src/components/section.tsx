import { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { cn } from '@/lib/utils/cn';

export function Section({ title, eyebrow, action, children, className }: Props) {
  return (
    <View className={cn('gap-3', className)}>
      <View className="flex-row items-end justify-between gap-3">
        <View className="flex-1 gap-1">
          {eyebrow ? <Text className="text-xs font-medium text-gray-500">{eyebrow}</Text> : null}
          <Text className="text-lg font-semibold text-gray-950">{title}</Text>
        </View>
        {action}
      </View>
      <View className="gap-1 border-y border-gray-200">{children}</View>
    </View>
  );
}

type Props = {
  title: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};
