import { Text, View } from 'react-native';
import { ComponentProps } from 'react';

export function EditScreenInfo({ path, ...props }: Props) {
  return (
    <View {...props}>
      <View className="ritems-center mx-12">
        <Text className="text-center text-lg leading-6">Open up the code for this screen:</Text>
        <View className="my-2 rounded-md px-1">
          <Text>{path}</Text>
        </View>
        <Text className="text-center text-lg leading-6">
          Change any of the text, save the file, and your app will automatically update.
        </Text>
      </View>
    </View>
  );
}

interface Props extends ComponentProps<typeof View> {
  path: string;
}
