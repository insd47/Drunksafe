import { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

export default function Screen({ children }: Props) {
  return (
    <View className="flex-1 bg-white">
      <ScrollView className="flex-1" contentInsetAdjustmentBehavior="automatic">
        <View className="w-full max-w-[520px] self-center px-5 py-5">
          <View className="gap-6">{children}</View>
        </View>
      </ScrollView>
    </View>
  );
}

type Props = {
  children: ReactNode;
};
