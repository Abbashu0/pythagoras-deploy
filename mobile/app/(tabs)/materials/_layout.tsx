import { Stack } from 'expo-router/stack';

import { usePreferences } from '@/preferences/preferences-provider';
import { getMaterialRouteOptions } from '@/materials/material-route-options';

export default function MaterialsLayout() {
  const { resolvedColorScheme } = usePreferences();

  return (
    <Stack screenOptions={getMaterialRouteOptions(resolvedColorScheme)}>
      <Stack.Screen name="index" options={{ title: 'المواد' }} />
    </Stack>
  );
}
