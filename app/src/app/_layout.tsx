import '../global.css';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

export default function RootLayout() {
    return (
        <SafeAreaProvider>
          <SafeAreaView style={{ flex: 1 }}>
            <Stack screenOptions={{ headerShown: true }}>
              <Stack.Screen name="index" options={{ title: 'Drunksafe' }} />
              <Stack.Screen name="onboarding" options={{ title: '온보딩' }} />
              <Stack.Screen name="measure/[sessionId]" options={{ title: '측정' }} />
              <Stack.Screen name="results/[id]" options={{ title: '결과' }} />
              <Stack.Screen name="history" options={{ title: '히스토리' }} />
            </Stack>
            <StatusBar style="auto" />
          </SafeAreaView>
        </SafeAreaProvider>
    );
}
