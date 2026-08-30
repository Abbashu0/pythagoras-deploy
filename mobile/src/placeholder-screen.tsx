import { ScrollView, StyleSheet, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { usePreferences } from '@/preferences/preferences-provider';
import { getPalette, scaledFontSize, scaledLineHeight } from '@/theme';

export function PlaceholderScreen({ title }: { title: string }) {
  const { fontScale, resolvedColorScheme } = usePreferences();
  const palette = getPalette(resolvedColorScheme);

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, { backgroundColor: palette.background }]}
        style={{ backgroundColor: palette.background }}
      >
        <Text
          selectable
          style={[
            styles.title,
            {
              color: palette.text,
              fontSize: scaledFontSize(24, fontScale),
              lineHeight: scaledLineHeight(24, fontScale, 1.25),
            },
          ]}
        >
          {title}
        </Text>
      </ScrollView>
      <StatusBar style={resolvedColorScheme === 'dark' ? 'light' : 'dark'} />
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
  },
});
