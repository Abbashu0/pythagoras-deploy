import { Stack } from 'expo-router';

import { usePreferences } from '@/preferences/preferences-provider';
import { SettingsScreen } from '@/settings/settings-screen';
import { getPalette } from '@/theme';

export default function SettingsRoute() {
  const { resolvedColorScheme } = usePreferences();
  const palette = getPalette(resolvedColorScheme);

  return (
    <>
      <SettingsScreen />
      <Stack.Screen
        options={{
          headerBackButtonDisplayMode: 'minimal',
          headerShadowVisible: false,
          headerShown: true,
          headerTintColor: palette.text,
          headerTitleStyle: { color: palette.text },
          headerTransparent: true,
          title: 'الإعدادات',
        }}
      />
    </>
  );
}
