import { Stack } from 'expo-router/stack';

import { usePreferences } from '@/preferences/preferences-provider';
import { getSettingsRouteOptions } from '@/settings/settings-route-options';

export default function SettingsChildLayout() {
  const { resolvedColorScheme } = usePreferences();

  return (
    <Stack screenOptions={getSettingsRouteOptions(resolvedColorScheme)}>
      <Stack.Screen name="index" options={{ headerShown: false, title: 'الإعدادات' }} />
      <Stack.Screen name="information" options={{ title: 'معلومات' }} />
      <Stack.Screen name="faq" options={{ title: 'الأسئلة الشائعة' }} />
      <Stack.Screen name="support" options={{ title: 'الدعم الفني' }} />
      <Stack.Screen name="appearance" options={{ title: 'المظهر' }} />
    </Stack>
  );
}
