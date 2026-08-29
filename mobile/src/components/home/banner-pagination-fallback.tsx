import { Animated, StyleSheet, View } from 'react-native';

interface BannerPaginationFallbackProps {
  count: number;
  pageWidth: number;
  scrollX: Animated.Value;
}

const ACTIVE_WIDTH = 16;
const DOT_SIZE = 5.5;
const GAP = 6;
const HORIZONTAL_PADDING = 9;
const VERTICAL_PADDING = 5;

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

export function BannerPaginationFallback({
  count,
  pageWidth,
  scrollX,
}: BannerPaginationFallbackProps) {
  if (count < 2) return null;

  return (
    <View pointerEvents="none" style={styles.positioner}>
      <View style={[styles.capsule, styles.fallbackCapsule]}>
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
      </View>
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
