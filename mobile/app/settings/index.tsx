import { StatusBar } from 'expo-status-bar';

import { usePreferences } from '@/preferences/preferences-provider';
import { SettingsScreen } from '@/settings/settings-screen';

export default function SettingsIndexRoute() {
  const { resolvedColorScheme } = usePreferences();

  return (
    <>
      <SettingsScreen />
      <StatusBar style={resolvedColorScheme === 'dark' ? 'light' : 'dark'} />
    </>
  );
}
