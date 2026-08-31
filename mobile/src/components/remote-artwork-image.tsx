import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Image, type ImageStyle } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ImageStyle as ReactNativeImageStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import type { Palette } from '@/theme';

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

type RemoteArtworkPhase = 'loading' | 'loaded' | 'error';

interface ArtworkLoadingSkeletonProps {
  palette: Palette;
}

interface RemoteArtworkImageProps {
  accessibilityLabel?: string;
  accessible?: boolean;
  imageStyle?: StyleProp<ImageStyle | ReactNativeImageStyle>;
  palette: Palette;
  renderErrorFallback: () => ReactNode;
  sourceUri: string;
  style?: StyleProp<ViewStyle>;
}

export function ArtworkLoadingSkeleton({ palette }: ArtworkLoadingSkeletonProps) {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(0);
  const highlightStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.12, 0.24]),
  }));

  useEffect(() => {
    if (reduceMotion) {
      // eslint-disable-next-line react-hooks/immutability
      pulse.value = 0;
      cancelAnimation(pulse);
      return;
    }

    pulse.value = withRepeat(
      withTiming(1, {
        duration: 1500,
        easing: Easing.inOut(Easing.linear),
      }),
      -1,
      true
    );

    return () => cancelAnimation(pulse);
  }, [pulse, reduceMotion]);

  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.skeleton, { backgroundColor: palette.surfaceInset }]}
    >
      <AnimatedLinearGradient
        colors={[palette.surfaceInset, palette.surfaceElevated, palette.surfaceInset]}
        end={{ x: 1, y: 0.5 }}
        locations={[0, 0.5, 1]}
        pointerEvents="none"
        start={{ x: 0, y: 0.5 }}
        style={[StyleSheet.absoluteFill, highlightStyle]}
      />
    </View>
  );
}

export function RemoteArtworkImage({
  accessibilityLabel,
  accessible,
  imageStyle,
  palette,
  renderErrorFallback,
  sourceUri,
  style,
}: RemoteArtworkImageProps) {
  const sourceIdentityRef = useRef(sourceUri);
  const [imageState, setImageState] = useState<{ phase: RemoteArtworkPhase; sourceUri: string }>({
    phase: 'loading',
    sourceUri,
  });

  useEffect(() => {
    sourceIdentityRef.current = sourceUri;
  }, [sourceUri]);

  const updatePhase = useCallback(
    (phase: RemoteArtworkPhase) => {
      if (sourceIdentityRef.current !== sourceUri) return;
      setImageState((current) =>
        current.sourceUri === sourceUri && current.phase === phase
          ? current
          : { phase, sourceUri }
      );
    },
    [sourceUri]
  );

  const phase = imageState.sourceUri === sourceUri ? imageState.phase : 'loading';

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      {phase === 'loading' ? <ArtworkLoadingSkeleton palette={palette} /> : null}
      {phase === 'error' ? renderErrorFallback() : null}
      <Image
        accessible={accessible}
        accessibilityLabel={accessibilityLabel}
        cachePolicy="memory-disk"
        contentFit="contain"
        contentPosition="center"
        onDisplay={() => updatePhase('loaded')}
        onError={() => updatePhase('error')}
        onLoadStart={() => updatePhase('loading')}
        recyclingKey={sourceUri}
        source={{ uri: sourceUri }}
        style={[StyleSheet.absoluteFill, imageStyle]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    overflow: 'hidden',
  },
});
