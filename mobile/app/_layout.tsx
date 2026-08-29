import { useMemo } from 'react';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router/stack';

import { getQuestionBankRouteOptions } from '@/question-bank/question-bank-route-options';
import { PreferencesProvider, usePreferences } from '@/preferences/preferences-provider';

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    AmiriQuran: require('../assets/fonts/AmiriQuran.ttf'),
  });

  if (!fontsLoaded) return null;

  return (
    <PreferencesProvider>
      <RootStack />
    </PreferencesProvider>
  );
}

function RootStack() {
  const { resolvedColorScheme } = usePreferences();
  const questionBankOptions = useMemo(
    () => getQuestionBankRouteOptions(resolvedColorScheme),
    [resolvedColorScheme]
  );

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen
        name="materials/[subjectKey]/question-bank"
        options={questionBankOptions}
      />
    </Stack>
  );
}
