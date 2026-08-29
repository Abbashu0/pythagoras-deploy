import { useEffect, useRef, useState } from 'react';
import { Animated, ScrollView, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { BannerArtworkPage } from '@/components/home/banner-artwork-page';
import { BannerPaginationFallback } from '@/components/home/banner-pagination-fallback';
import type { HomeBannerPagerProps } from '@/components/home/home-banner-pager.types';

export function HomeBannerPager({
  banners,
  frameWidth,
  frameHeight,
  selectedIndex,
  onSelectionChange,
  onInteractionStart,
}: HomeBannerPagerProps) {
  const pagerRef = useRef<ScrollView>(null);
  const [scrollX] = useState(() => new Animated.Value(0));
  const previousIndexRef = useRef(selectedIndex);
  const isWeb = process.env.EXPO_OS === 'web';

  useEffect(() => {
    if (frameWidth <= 0 || frameHeight <= 0) return;

    const shouldAnimate = previousIndexRef.current !== selectedIndex;
    previousIndexRef.current = selectedIndex;
    pagerRef.current?.scrollTo({
      x: selectedIndex * frameWidth,
      y: 0,
      animated: shouldAnimate,
    });
  }, [frameHeight, frameWidth, selectedIndex]);

  const handleMomentumScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (banners.length === 0 || frameWidth <= 0) return;

    const pageProgress = event.nativeEvent.contentOffset.x / frameWidth;
    const nextIndex = Math.max(0, Math.min(banners.length - 1, Math.round(pageProgress)));
    onSelectionChange(nextIndex);
  };

  if (banners.length === 0) return null;

  return (
    <View style={[styles.container, { height: frameHeight, width: frameWidth }]}>
      <Animated.ScrollView
        ref={pagerRef}
        contentContainerStyle={styles.pagerContent}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        contentInset={{ bottom: 0, left: 0, right: 0, top: 0 }}
        decelerationRate="fast"
        directionalLockEnabled
        horizontal
        onMomentumScrollEnd={handleMomentumScrollEnd}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: !isWeb }
        )}
        onScrollBeginDrag={onInteractionStart}
        pagingEnabled
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
        style={[styles.internalPager, isWeb ? undefined : styles.ltrPager]}
      >
        {banners.map((banner) => (
          <BannerArtworkPage key={banner.id} banner={banner} height={frameHeight} width={frameWidth} />
        ))}
      </Animated.ScrollView>
      <BannerPaginationFallback count={banners.length} pageWidth={frameWidth} scrollX={scrollX} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    position: 'relative',
  },
  internalPager: {
    flex: 1,
  },
  ltrPager: {
    direction: 'ltr',
  },
  pagerContent: {
    paddingHorizontal: 0,
  },
});
