import { useMemo } from 'react';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router/stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { getProfileSheetRouteOptions } from '@/profile/profile-route-options';
import { getQuestionBankRouteOptions } from '@/question-bank/question-bank-route-options';
import { PreferencesProvider, usePreferences } from '@/preferences/preferences-provider';
import { getSettingsSheetRouteOptions } from '@/settings/settings-route-options';
import { getPalette } from '@/theme';

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    AmiriQuran: require('../assets/fonts/AmiriQuran.ttf'),
  });

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PreferencesProvider>
        <RootStack />
      </PreferencesProvider>
    </GestureHandlerRootView>
  );
}

function RootStack() {
  const { resolvedColorScheme } = usePreferences();
  const palette = getPalette(resolvedColorScheme);
  const questionBankOptions = useMemo(
    () => getQuestionBankRouteOptions(resolvedColorScheme),
    [resolvedColorScheme]
  );
  const settingsSheetOptions = useMemo(
    () => getSettingsSheetRouteOptions(resolvedColorScheme),
    [resolvedColorScheme]
  );
  const profileSheetOptions = useMemo(
    () => getProfileSheetRouteOptions(resolvedColorScheme),
    [resolvedColorScheme]
  );

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen
        name="chat"
        options={{
          contentStyle: { backgroundColor: palette.background },
          gestureEnabled: true,
          headerBackButtonDisplayMode: 'minimal',
          headerBackVisible: true,
          headerShadowVisible: false,
          headerShown: process.env.EXPO_OS !== 'ios',
          headerTintColor: palette.text,
          headerTitle: '',
          headerTransparent: true,
          title: '',
        }}
      />
      <Stack.Screen name="profile" options={profileSheetOptions} />
      <Stack.Screen name="settings" options={settingsSheetOptions} />
      <Stack.Screen
        name="materials/[subjectKey]/question-bank"
        options={questionBankOptions}
      />
    </Stack>
  );
}
