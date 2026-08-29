import { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function Screen({ children }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-white">
      <ScrollView className="flex-1" contentInsetAdjustmentBehavior="automatic">
        <View
          className="w-full max-w-[520px] self-center px-5 pt-5"
          style={{ paddingBottom: Math.max(20, insets.bottom + 20) }}>
          <View className="gap-6">{children}</View>
        </View>
      </ScrollView>
    </View>
  );
}

type Props = {
  children: ReactNode;
};
