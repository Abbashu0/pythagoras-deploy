import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';

import { usePreferences } from '@/preferences/preferences-provider';
import { getPalette } from '@/theme';

export default function AITab() {
  const { resolvedColorScheme } = usePreferences();
  const palette = getPalette(resolvedColorScheme);

  return (
    <>
      <View style={[styles.container, { backgroundColor: palette.background }]} />
      <StatusBar style={resolvedColorScheme === 'dark' ? 'light' : 'dark'} />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
