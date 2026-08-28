import { Stack } from 'expo-router/stack';

import { PreferencesProvider } from '@/preferences/preferences-provider';

export default function RootLayout() {
  return (
    <PreferencesProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </PreferencesProvider>
  );
}
