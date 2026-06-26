import React, { ComponentProps } from 'react';
import { Text, View } from 'react-native';
import { EditScreenInfo } from './EditScreenInfo';
import { cn } from '@/lib/utils/cn';

export function ScreenContent({ title, path, children, className, ...props }: Props) {
  return (
    <View {...props} className={cn('flex-1 items-center justify-center bg-white', className)}>
      <Text className="my-7 h-[1px] w-4/5 bg-gray-200">{title}</Text>
      <View className="text-xl font-bold" />
      <EditScreenInfo path={path} />
      {children}
    </View>
  );
}

interface Props extends ComponentProps<typeof View> {
  title: string;
  path: string;
}
