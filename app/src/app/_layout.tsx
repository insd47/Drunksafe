import '../global.css';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="connect" options={{ presentation: 'modal', title: '기기 연결' }} />
        <Stack.Screen
          name="measure"
          options={{ presentation: 'fullScreenModal', headerShown: false, gestureEnabled: false }}
        />
        <Stack.Screen name="results/[id]" options={{ title: '측정 결과' }} />
        <Stack.Protected guard={__DEV__}>
          <Stack.Screen name="dev" options={{ title: '개발자 도구' }} />
        </Stack.Protected>
      </Stack>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
