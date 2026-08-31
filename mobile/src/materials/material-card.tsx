import { useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import type { PublicMaterial, PublicMaterialSettings } from '@/api/app-content';
import { resolveApiUrl } from '@/api/client';
import { RemoteArtworkImage } from '@/components/remote-artwork-image';
import { materialIcons } from '@/materials/material-icons';
import { MaterialNativeIcon } from '@/materials/material-native-icon';
import type { ResolvedColorScheme } from '@/preferences/preferences-provider';
import { getPalette, scaledFontSize, scaledLineHeight } from '@/theme';

interface MaterialCardProps {
  cardHeight: number;
  colorScheme: ResolvedColorScheme;
  fontScale: number;
  material: PublicMaterial;
  materialSettings: PublicMaterialSettings;
  onPress: () => void;
  width: number;
}

type FrameSize = {
  height: number;
  width: number;
};

function getFallbackColor(gradient: string, fallback: string) {
  return gradient.match(/#[0-9a-f]{6}/i)?.[0] ?? fallback;
}

function getImageTransform(material: PublicMaterial, width: number, height: number) {
  return {
    transform: [
      { translateX: (material.offsetX / 100) * width },
      { translateY: (material.offsetY / 100) * height },
      { scale: material.scale > 0 ? material.scale : 1 },
    ],
  } as const;
}

function MaterialFade({ intensity }: { intensity: number }) {
  const normalizedIntensity = Math.max(0, Math.min(1, intensity));
  const colors = [
    `rgba(0,0,0,${normalizedIntensity})`,
    'rgba(0,0,0,0)',
  ] as const;

  return (
    <LinearGradient
      colors={colors}
      end={{ x: 0.5, y: 0 }}
      locations={[0, 1]}
      pointerEvents="none"
      start={{ x: 0.5, y: 1 }}
      style={styles.fadeLayer}
    />
  );
}

export function MaterialCard({
  cardHeight,
  colorScheme,
  fontScale,
  material,
  materialSettings,
  onPress,
  width,
}: MaterialCardProps) {
  const [frameSize, setFrameSize] = useState<FrameSize | null>(null);
  const frameWidth = frameSize?.width || width;
  const frameHeight = frameSize?.height || cardHeight;
  const textBottom = 20 + materialSettings.textVerticalPosition * 0.8;
  const textScale = materialSettings.textScale > 0 ? materialSettings.textScale : 1;
  const palette = getPalette(colorScheme);
  const fallbackColor = getFallbackColor(material.gradient, palette.surfaceInset);
  const imageUri = material.imageUrl ? resolveApiUrl(material.imageUrl) : null;

  const handleLayout = (event: LayoutChangeEvent) => {
    const { height, width: measuredWidth } = event.nativeEvent.layout;
    if (height <= 0 || measuredWidth <= 0) return;

    setFrameSize((current) =>
      current?.width === measuredWidth && current.height === height
        ? current
        : { height, width: measuredWidth }
    );
  };

  return (
    <Pressable
      accessibilityHint="فتح المادة"
      accessibilityLabel={material.label}
      accessibilityRole="button"
      onLayout={handleLayout}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: fallbackColor,
          height: cardHeight,
          opacity: pressed ? 0.9 : 1,
          width,
        },
      ]}
    >
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {imageUri ? (
          <RemoteArtworkImage
            accessible={false}
            imageStyle={getImageTransform(material, frameWidth, frameHeight)}
            palette={palette}
            renderErrorFallback={() => (
              <View style={styles.fallbackArtwork}>
                <MaterialNativeIcon
                  color="rgba(255,255,255,0.7)"
                  colorScheme={colorScheme}
                  name={materialIcons.questionBank}
                  size={64}
                />
              </View>
            )}
            sourceUri={imageUri}
          />
        ) : (
          <View style={styles.fallbackArtwork}>
            <MaterialNativeIcon
              color="rgba(255,255,255,0.7)"
              colorScheme={colorScheme}
              name={materialIcons.questionBank}
              size={64}
            />
          </View>
        )}
      </View>

      <MaterialFade intensity={materialSettings.fadeIntensity} />

      <View
        pointerEvents="none"
        style={[styles.textOverlay, { bottom: textBottom }]}
      >
        <Text
          selectable
          style={[
            styles.arabicTitle,
            {
              color: '#FFFFFF',
              fontSize: scaledFontSize(24 * textScale, fontScale),
              lineHeight: scaledLineHeight(24 * textScale, fontScale, 1.3),
            },
          ]}
        >
          {material.label}
        </Text>
        <Text
          selectable
          style={[
            styles.englishTitle,
            {
              color: 'rgba(255,255,255,0.72)',
              fontSize: scaledFontSize(12 * textScale, fontScale),
              lineHeight: scaledLineHeight(12 * textScale, fontScale, 1.3),
            },
          ]}
        >
          {material.englishTitle}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderCurve: 'continuous',
    borderRadius: 28,
    overflow: 'hidden',
    position: 'relative',
  },
  fallbackArtwork: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  fadeLayer: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  textOverlay: {
    alignItems: 'center',
    left: 18,
    position: 'absolute',
    right: 18,
  },
  arabicTitle: {
    fontWeight: '700',
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  englishTitle: {
    letterSpacing: 1.2,
    marginTop: 4,
    textAlign: 'center',
  },
});
