import { memo, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { CHAT_BOTTOM_FADE_LOCATIONS, CHAT_TOP_FADE_LOCATIONS, chatBottomFadeHeight, chatEdgeFadeColors } from './chat-edge-fade';

/** Paint-only siblings of the transcript. No measured content, scroll handlers,
 * token subscriptions, blur dependency, React keyboard-frame state or insets. */
export const ChatEdgeFades = memo(function ChatEdgeFades({ background, topHeight, composerHeight, safeAreaBottom, keyboardProgress, breathingGap }: {
  background: string; topHeight: number; composerHeight: SharedValue<number>;
  safeAreaBottom: number; keyboardProgress: SharedValue<number>; breathingGap: number;
}) {
  const colors = useMemo(() => chatEdgeFadeColors(background), [background]);
  const bottomStyle = useAnimatedStyle(() => ({
    height: chatBottomFadeHeight(composerHeight.get(), safeAreaBottom, keyboardProgress.get(), breathingGap),
  }), [composerHeight, safeAreaBottom, keyboardProgress, breathingGap]);
  return <>
    <LinearGradient pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      colors={colors.top} locations={CHAT_TOP_FADE_LOCATIONS}
      start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }}
      style={[styles.top, { height: topHeight }]} />
    <KeyboardStickyView pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={styles.bottom} offset={{ closed: 0, opened: 0 }}>
      <Animated.View pointerEvents="none" style={bottomStyle}>
        <LinearGradient pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
          colors={colors.bottom} locations={CHAT_BOTTOM_FADE_LOCATIONS}
          start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </KeyboardStickyView>
  </>;
});

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1 },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 1 },
});
