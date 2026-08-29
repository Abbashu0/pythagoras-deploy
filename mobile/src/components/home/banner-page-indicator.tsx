import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';

interface BannerPageIndicatorProps {
  count: number;
  selectedIndex: number;
}

const DOT_DIAMETER = 6;
const DOT_GAP = 8;
const CAPSULE_HORIZONTAL_PADDING = 10;
const CAPSULE_VERTICAL_PADDING = 6;
const BOTTOM_OFFSET = 8;

function getGlassAvailability() {
  try {
    return isGlassEffectAPIAvailable() && isLiquidGlassAvailable();
  } catch {
    return false;
  }
}

export function BannerPageIndicator({ count, selectedIndex }: BannerPageIndicatorProps) {
  const [glassAvailable] = useState(getGlassAvailability);
  const [reduceTransparency, setReduceTransparency] = useState(false);

  useEffect(() => {
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

  const indicators = (
    <View style={styles.indicators}>
      {Array.from({ length: count }, (_, index) => (
        <View
          key={index}
          style={[styles.dot, index === selectedIndex ? styles.activeDot : styles.inactiveDot]}
        />
      ))}
    </View>
  );

  return (
    <View
      accessibilityElementsHidden
      accessible={false}
      pointerEvents="none"
      style={styles.positioner}
    >
      {glassAvailable && !reduceTransparency ? (
        <GlassView glassEffectStyle="regular" isInteractive={false} style={styles.capsule}>
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
    bottom: BOTTOM_OFFSET,
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 1,
  },
  capsule: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: 999,
    justifyContent: 'center',
    paddingHorizontal: CAPSULE_HORIZONTAL_PADDING,
    paddingVertical: CAPSULE_VERTICAL_PADDING,
  },
  fallbackCapsule: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
  },
  indicators: {
    alignItems: 'center',
    direction: 'ltr',
    flexDirection: 'row',
    gap: DOT_GAP,
    height: DOT_DIAMETER,
    justifyContent: 'center',
  },
  dot: {
    borderRadius: DOT_DIAMETER / 2,
    height: DOT_DIAMETER,
    width: DOT_DIAMETER,
  },
  activeDot: {
    backgroundColor: '#FFFFFF',
    opacity: 1,
  },
  inactiveDot: {
    backgroundColor: '#FFFFFF',
    opacity: 0.42,
  },
});
