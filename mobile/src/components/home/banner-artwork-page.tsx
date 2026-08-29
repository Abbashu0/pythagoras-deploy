import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import type { PublicBanner } from '@/api/app-content';
import { resolveApiUrl } from '@/api/client';

const SPLIT_VISUAL_RATIO = 0.42;

function imageTransform(banner: PublicBanner, width: number, height: number) {
  return {
    transform: [
      { translateX: (banner.offsetX / 100) * width },
      { translateY: (banner.offsetY / 100) * height },
      { scale: banner.scale > 0 ? banner.scale : 1 },
    ],
  } as const;
}

function BannerImage({ banner, width, height }: { banner: PublicBanner; width: number; height: number }) {
  if (!banner.imageUrl) return null;

  return (
    <Image
      accessibilityLabel={banner.title || undefined}
      cachePolicy="memory-disk"
      contentFit="contain"
      contentPosition="center"
      source={{ uri: resolveApiUrl(banner.imageUrl) }}
      style={[StyleSheet.absoluteFill, imageTransform(banner, width, height)]}
    />
  );
}

export function BannerArtworkPage({ banner, width, height }: { banner: PublicBanner; width: number; height: number }) {
  const isFull = banner.bannerType === 'FULL';
  const visualWidth = width * SPLIT_VISUAL_RATIO;

  return (
    <View
      accessible
      accessibilityLabel={banner.title || undefined}
      accessibilityRole="image"
      style={[styles.page, { height, maxWidth: width, minWidth: width, width }]}
    >
      {isFull ? (
        <BannerImage banner={banner} height={height} width={width} />
      ) : (
        <View style={styles.splitFrame}>
          <View style={[styles.splitVisual, { height, width: visualWidth }]}>
            <BannerImage banner={banner} height={height} width={visualWidth} />
          </View>
          <View style={[styles.splitCopy, { height, width: width - visualWidth }]}>
            <Text numberOfLines={2} selectable style={styles.splitTitle}>
              {banner.title}
            </Text>
            <Text numberOfLines={3} selectable style={styles.splitSubtitle}>
              {banner.subtitle}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flexGrow: 0,
    flexShrink: 0,
    overflow: 'hidden',
  },
  splitFrame: {
    flexDirection: 'row',
  },
  splitVisual: {
    backgroundColor: '#171717',
    overflow: 'hidden',
    position: 'relative',
  },
  splitCopy: {
    backgroundColor: '#111111',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  splitTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  splitSubtitle: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
});
