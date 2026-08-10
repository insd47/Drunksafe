import { Tabs } from 'expo-router/js-tabs';
import { Text } from 'react-native';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#030712',
        tabBarInactiveTintColor: '#9ca3af',
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: '홈',
          tabBarIcon: () => <Text className="text-xl">🏠</Text>,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: '기록',
          tabBarIcon: () => <Text className="text-xl">📋</Text>,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '설정',
          tabBarIcon: () => <Text className="text-xl">⚙️</Text>,
        }}
      />
    </Tabs>
  );
}
