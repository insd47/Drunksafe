import { Tabs } from 'expo-router/js-tabs';
import { Pressable, Text } from 'react-native';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#030712',
        tabBarInactiveTintColor: '#9ca3af',
        tabBarStyle: { overflow: 'hidden', backgroundColor: '#ffffff' },
        tabBarItemStyle: { overflow: 'hidden' },
        tabBarButton: ({ ref: _ref, ...props }) => (
          <Pressable
            {...props}
            android_ripple={{ color: '#e5e7eb', borderless: false, radius: 28 }}
            style={[props.style, { overflow: 'hidden' }]}
          />
        ),
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
