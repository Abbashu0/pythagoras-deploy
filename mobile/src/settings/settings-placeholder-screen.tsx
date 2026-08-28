import { ScrollView, StyleSheet, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { usePreferences } from '@/preferences/preferences-provider';
import { getPalette, scaledFontSize, scaledLineHeight } from '@/theme';

export function SettingsPlaceholderScreen() {
  const { fontScale, resolvedColorScheme } = usePreferences();
  const palette = getPalette(resolvedColorScheme);

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.content}
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
          سيتم إضافة المحتوى لاحقًا
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
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  message: {
    textAlign: 'center',
    writingDirection: 'rtl',
  },
});
