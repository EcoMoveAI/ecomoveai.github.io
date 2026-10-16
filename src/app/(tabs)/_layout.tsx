import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { useWindowDimensions } from 'react-native';
import { useApp } from '@/state/AppProvider';
import { usePalette } from '@/ui/theme';

/** At this width (tablet landscape / desktop browser) the bottom tab bar becomes a side rail. */
const SIDE_RAIL_MIN_WIDTH = 900;

export default function TabLayout() {
  const c = usePalette();
  const { width } = useWindowDimensions();
  const { trips } = useApp();
  const review = trips.filter((t) => t.confirmationStatus === 'needs_review').length;
  const wide = width >= SIDE_RAIL_MIN_WIDTH;
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.textMuted,
        tabBarStyle: wide
          ? { backgroundColor: c.surface, borderRightColor: c.border, minWidth: 200 }
          : { backgroundColor: c.surface, borderTopColor: c.border },
        tabBarPosition: wide ? 'left' : 'bottom',
        tabBarVariant: wide ? 'material' : 'uikit',
        tabBarLabelPosition: wide ? 'beside-icon' : undefined,
        headerStyle: { backgroundColor: c.bg },
        headerTitleStyle: { color: c.text },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color, size }) => <Ionicons name="leaf" color={color} size={size} /> }} />
      <Tabs.Screen
        name="trips"
        options={{
          title: 'Trips',
          tabBarBadge: review > 0 ? review : undefined,
          tabBarIcon: ({ color, size }) => <Ionicons name="list" color={color} size={size} />,
        }}
      />
      <Tabs.Screen name="insights" options={{ title: 'Insights', tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart" color={color} size={size} /> }} />
      <Tabs.Screen name="assistant" options={{ title: 'AI Assistant', tabBarIcon: ({ color, size }) => <Ionicons name="sparkles" color={color} size={size} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color, size }) => <Ionicons name="person-circle" color={color} size={size} /> }} />
    </Tabs>
  );
}
