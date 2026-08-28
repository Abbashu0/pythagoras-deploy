import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View } from 'react-native';
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';

interface BannerPaginationGlassProps {
  count: number;
  pageWidth: number;
  scrollX: Animated.Value;
}

const ACTIVE_WIDTH = 16;
const DOT_SIZE = 5.5;
const GAP = 6;
const HORIZONTAL_PADDING = 9;
const VERTICAL_PADDING = 5;

type GlassAvailability = {
  api: boolean;
  liquid: boolean;
};

function getNativeGlassAvailability(): GlassAvailability {
  if (process.env.EXPO_OS !== 'ios') return { api: false, liquid: false };

  try {
    return {
      api: isGlassEffectAPIAvailable(),
      liquid: isLiquidGlassAvailable(),
    };
  } catch {
    return { api: false, liquid: false };
  }
}

function indicatorInterpolation(index: number, count: number, pageWidth: number) {
  const width = Math.max(1, pageWidth);
  const activeScale = ACTIVE_WIDTH / DOT_SIZE;

  if (index === 0) {
    return { inputRange: [0, width], outputRange: [activeScale, 1] };
  }

  if (index === count - 1) {
    return {
      inputRange: [(count - 2) * width, (count - 1) * width],
      outputRange: [1, activeScale],
    };
  }

  return {
    inputRange: [(index - 1) * width, index * width, (index + 1) * width],
    outputRange: [1, activeScale, 1],
  };
}

function PaginationIndicator({
  index,
  count,
  pageWidth,
  scrollX,
}: {
  index: number;
  count: number;
  pageWidth: number;
  scrollX: Animated.Value;
}) {
  const { inputRange, outputRange } = indicatorInterpolation(index, count, pageWidth);
  const activeScale = ACTIVE_WIDTH / DOT_SIZE;
  const scaleX = scrollX.interpolate({
    inputRange,
    outputRange,
    extrapolate: 'clamp',
  });
  const opacity = scrollX.interpolate({
    inputRange,
    outputRange: outputRange.map(
      (value) => 0.55 + ((value - 1) / (activeScale - 1)) * 0.45
    ),
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.indicatorSlot}>
      <Animated.View style={[styles.indicator, { opacity, transform: [{ scaleX }] }]} />
    </View>
  );
}

export function BannerPaginationGlass({ count, pageWidth, scrollX }: BannerPaginationGlassProps) {
  const [glassAvailability] = useState(getNativeGlassAvailability);
  const [reduceTransparency, setReduceTransparency] = useState<boolean | null>(() =>
    process.env.EXPO_OS === 'ios' ? null : true
  );

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.info(
        `[Pythagoras] Glass API: ${glassAvailability.api}; Liquid Glass: ${glassAvailability.liquid}`
      );
    }
  }, [glassAvailability.api, glassAvailability.liquid]);

  useEffect(() => {
    if (process.env.EXPO_OS !== 'ios') return;

    let mounted = true;
    AccessibilityInfo.isReduceTransparencyEnabled()
      .then((enabled) => {
        if (mounted) setReduceTransparency(enabled);
      })
      .catch(() => {
        if (mounted) setReduceTransparency(true);
      });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      setReduceTransparency
    );

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  if (count < 2) return null;

  const useGlass =
    reduceTransparency === false && glassAvailability.api && glassAvailability.liquid;
  const indicators = (
    <View style={styles.indicators}>
      {Array.from({ length: count }, (_, index) => (
        <PaginationIndicator
          key={index}
          count={count}
          index={index}
          pageWidth={pageWidth}
          scrollX={scrollX}
        />
      ))}
    </View>
  );

  return (
    <View pointerEvents="none" style={styles.positioner}>
      {useGlass ? (
        <GlassView
          glassEffectStyle="regular"
          isInteractive={false}
          style={styles.capsule}
        >
          {indicators}
        </GlassView>
      ) : (
        <View style={[styles.capsule, styles.fallbackCapsule]}>{indicators}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  positioner: {
    alignItems: 'center',
    bottom: 10,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  capsule: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: 999,
    justifyContent: 'center',
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingVertical: VERTICAL_PADDING,
  },
  fallbackCapsule: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
  },
  indicators: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: GAP,
    height: DOT_SIZE,
    justifyContent: 'center',
  },
  indicatorSlot: {
    alignItems: 'center',
    height: DOT_SIZE,
    justifyContent: 'center',
    width: ACTIVE_WIDTH,
  },
  indicator: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    height: DOT_SIZE,
    width: DOT_SIZE,
  },
});
