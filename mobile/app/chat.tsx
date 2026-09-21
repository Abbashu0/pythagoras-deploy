import { useLocalSearchParams, useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';

import { usePreferences } from '@/preferences/preferences-provider';
import {
  getNormalTabIcon,
  getNormalTabLabel,
  getNormalTabPath,
  parseNormalTab,
} from '@/navigation/last-normal-tab';
import { getPalette } from '@/theme';

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ returnTab?: string | string[] }>();
  const { resolvedColorScheme } = usePreferences();
  const palette = getPalette(resolvedColorScheme);
  const returnTab = parseNormalTab(params.returnTab);
  const returnLabel = getNormalTabLabel(returnTab);

  const returnToPreviousPage = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace(getNormalTabPath(returnTab));
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.container, { backgroundColor: palette.background }]} />
      <Stack.Toolbar placement="bottom">
        <Stack.Toolbar.Button
          accessibilityHint={`يعود إلى ${returnLabel}`}
          accessibilityLabel={`العودة إلى ${returnLabel}`}
          icon={getNormalTabIcon(returnTab)}
          onPress={returnToPreviousPage}
          separateBackground
          tintColor={palette.text}
        />
        <Stack.Toolbar.Spacer />
      </Stack.Toolbar>
      <StatusBar style={resolvedColorScheme === 'dark' ? 'light' : 'dark'} />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
