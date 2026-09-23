import { useCallback, useRef } from 'react';
import { Keyboard, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router/stack';
import * as Haptics from 'expo-haptics';
import ReanimatedDrawerLayout, {
  DrawerKeyboardDismissMode,
  DrawerPosition,
  DrawerType,
  type DrawerLayoutMethods,
} from 'react-native-gesture-handler/ReanimatedDrawerLayout';

import { ChatComposer } from '@/ai/chat-composer';
import { ChatTopControls } from '@/ai/chat-top-controls';
import { usePreferences } from '@/preferences/preferences-provider';
import { getPalette } from '@/theme';

export default function ChatScreen() {
  const { resolvedColorScheme } = usePreferences();
  const palette = getPalette(resolvedColorScheme);
  const { width } = useWindowDimensions();
  const router = useRouter();
  const drawerRef = useRef<DrawerLayoutMethods | null>(null);
  const drawerOpenRef = useRef(false);
  const renderNavigationView = useCallback(
    () => <View style={[styles.sidebar, { backgroundColor: palette.surface }]} />,
    [palette.surface],
  );
  const handleDrawerOpen = useCallback(() => {
    if (drawerOpenRef.current) return;
    drawerOpenRef.current = true;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
  }, []);
  const handleDrawerClose = useCallback(() => {
    if (!drawerOpenRef.current) return;
    drawerOpenRef.current = false;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
  }, []);
  const handleMenuPress = useCallback(() => {
    // Expo UI's keyboard host forwards this blur request to the focused SwiftUI TextFieldRef.
    Keyboard.dismiss();
    drawerRef.current?.openDrawer();
  }, []);

  return (
    <>
      {process.env.EXPO_OS !== 'ios' ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            accessibilityLabel="فتح القائمة"
            icon="line.3.horizontal"
            onPress={handleMenuPress}
            separateBackground
            tintColor={palette.text}
          />
        </Stack.Toolbar>
      ) : null}
      <ReanimatedDrawerLayout
        ref={drawerRef}
        drawerPosition={DrawerPosition.RIGHT}
        drawerType={DrawerType.BACK}
        drawerWidth={width * 0.72}
        edgeWidth={Math.min(width, 64)}
        minSwipeDistance={10}
        drawerBackgroundColor={palette.surface}
        renderNavigationView={renderNavigationView}
        overlayColor="rgba(0, 0, 0, 0.12)"
        keyboardDismissMode={DrawerKeyboardDismissMode.ON_DRAG}
        hideStatusBar={false}
        onDrawerOpen={handleDrawerOpen}
        onDrawerClose={handleDrawerClose}
      >
        <View style={[styles.container, { backgroundColor: palette.background }]}>
          <ChatComposer />
          {process.env.EXPO_OS === 'ios' ? (
            <ChatTopControls
              colorScheme={resolvedColorScheme}
              foregroundColor={palette.text}
              onBack={() => router.back()}
              onMenu={handleMenuPress}
            />
          ) : null}
        </View>
      </ReanimatedDrawerLayout>
      <StatusBar style={resolvedColorScheme === 'dark' ? 'light' : 'dark'} />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  sidebar: {
    flex: 1,
    direction: 'rtl',
  },
});
