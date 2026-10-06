import { memo } from 'react';
import { Platform, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { Button, Host } from '@expo/ui/swift-ui';
import { accessibilityLabel, buttonBorderShape, buttonStyle, foregroundStyle, frame, labelStyle } from '@expo/ui/swift-ui/modifiers';

/** Absolute companion inside the existing KeyboardStickyView. It contributes
 * nothing to Composer geometry, extraContentPadding or transcript height. */
export const ChatScrollToBottomAffordance = memo(function ChatScrollToBottomAffordance({
  visible, composerHeight, safeAreaBottom, colorScheme, tint, onPress,
}: {
  visible: boolean; composerHeight: SharedValue<number>; safeAreaBottom: number;
  colorScheme: 'light' | 'dark'; tint: string; onPress: () => void;
}) {
  const position = useAnimatedStyle(() => ({
    bottom: Math.max(0, composerHeight.get() - safeAreaBottom) + 12,
  }), [composerHeight, safeAreaBottom]);
  if (!visible) return null;
  const nativeGlass = Number.parseInt(String(Platform.Version), 10) >= 26;
  return <Animated.View pointerEvents="box-none" style={[styles.overlay, position]}>
    <Host colorScheme={colorScheme} layoutDirection="leftToRight" ignoreSafeArea="all" matchContents
      style={styles.host}>
      <Button label="الانتقال إلى نهاية المحادثة" systemImage="arrow.down" onPress={onPress}
        modifiers={[
          accessibilityLabel('الانتقال إلى نهاية المحادثة'), labelStyle('iconOnly'),
          buttonStyle(nativeGlass ? 'glass' : 'bordered'), buttonBorderShape('circle'),
          foregroundStyle(tint), frame({ width: 44, height: 44 }),
        ]} />
    </Host>
  </Animated.View>;
});

const styles = StyleSheet.create({
  overlay: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 3 },
  host: { width: 44, height: 44 },
});
