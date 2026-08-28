import { ScrollView, StyleSheet, Text } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { usePreferences } from '@/preferences/preferences-provider';
import { getMaterialRouteOptions } from '@/materials/material-route-options';
import { getPalette, scaledFontSize, scaledLineHeight } from '@/theme';

export function MaterialPlaceholderScreen({ title }: { title: string }) {
  const { fontScale, resolvedColorScheme } = usePreferences();
  const palette = getPalette(resolvedColorScheme);

  return (
    <>
      <Stack.Screen options={{ ...getMaterialRouteOptions(resolvedColorScheme), title }} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { backgroundColor: palette.background },
        ]}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        style={[styles.container, { backgroundColor: palette.background }]}
      >
        <Text
          selectable
          style={[
            styles.message,
            {
              color: palette.textSecondary,
              fontSize: scaledFontSize(17, fontScale),
              lineHeight: scaledLineHeight(17, fontScale, 1.45),
            },
          ]}
        >
          سيتم ربط هذه الصفحة لاحقًا
        </Text>
      </ScrollView>
      <StatusBar style={resolvedColorScheme === 'dark' ? 'light' : 'dark'} />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
    paddingBottom: 40,
    paddingHorizontal: 18,
    paddingTop: 24,
  },
  message: {
    textAlign: 'center',
    writingDirection: 'rtl',
  },
});
