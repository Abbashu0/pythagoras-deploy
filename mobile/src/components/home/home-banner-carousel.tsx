import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useIsFocused } from 'expo-router';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchAppContent, type AppContentData, type PublicBanner } from '@/api/app-content';
import { resolveApiUrl } from '@/api/client';
import { BannerPaginationGlass } from '@/components/home/banner-pagination-glass';
import { usePreferences } from '@/preferences/preferences-provider';
import { getPalette } from '@/theme';

const HORIZONTAL_INSET = 18;
const BANNER_ASPECT_WIDTH = 5;
const BANNER_ASPECT_HEIGHT = 2;
const SPLIT_VISUAL_RATIO = 0.42;

type FrameSize = {
  width: number;
  height: number;
};

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

function BannerArtworkPage({ banner, width, height }: { banner: PublicBanner; width: number; height: number }) {
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

export function HomeBannerCarousel() {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { resolvedColorScheme } = usePreferences();
  const palette = getPalette(resolvedColorScheme);
  const isWeb = process.env.EXPO_OS === 'web' || Platform.OS === 'web';
  const fallbackFrameWidth = Math.max(1, windowWidth - HORIZONTAL_INSET * 2);
  const fallbackFrameHeight = (fallbackFrameWidth * BANNER_ASPECT_HEIGHT) / BANNER_ASPECT_WIDTH;
  const [frameSize, setFrameSize] = useState<FrameSize | null>(null);
  const frameWidth = frameSize?.width ?? fallbackFrameWidth;
  const frameHeight = frameSize?.height ?? fallbackFrameHeight;
  const pagerRef = useRef<ScrollView>(null);
  const [scrollX] = useState(() => new Animated.Value(0));
  const activeIndexRef = useRef(0);
  const draggingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [appState, setAppState] = useState(AppState.currentState);
  const [content, setContent] = useState<AppContentData | null>(null);
  const banners = content?.banners ?? [];
  const isAppActive = appState === 'active';

  const clearAutoSlide = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleAutoSlide = useCallback(() => {
    clearAutoSlide();
    if (
      !isFocused ||
      !isAppActive ||
      !frameSize ||
      banners.length < 2 ||
      !content ||
      content.autoSlideInterval <= 0
    ) {
      return;
    }

    timerRef.current = setTimeout(() => {
      if (draggingRef.current) return;

      const nextIndex = (activeIndexRef.current + 1) % banners.length;
      activeIndexRef.current = nextIndex;
      pagerRef.current?.scrollTo({ x: nextIndex * frameWidth, y: 0, animated: true });
    }, content.autoSlideInterval);
  }, [banners.length, clearAutoSlide, content, frameSize, frameWidth, isAppActive, isFocused]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    fetchAppContent(controller.signal)
      .then((nextContent) => {
        if (mounted) setContent(nextContent);
      })
      .catch(() => {
        // Home intentionally stays black when the public content is unavailable.
      });

    return () => {
      mounted = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    scheduleAutoSlide();
    return clearAutoSlide;
  }, [clearAutoSlide, scheduleAutoSlide]);

  useEffect(() => {
    const nextIndex = banners.length === 0 ? 0 : Math.min(activeIndexRef.current, banners.length - 1);
    activeIndexRef.current = nextIndex;
    pagerRef.current?.scrollTo({ x: nextIndex * frameWidth, y: 0, animated: false });
  }, [banners.length, frameWidth]);

  const handleFrameLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      if (width <= 0 || height <= 0) return;

      setFrameSize((current) =>
        current?.width === width && current.height === height ? current : { width, height }
      );

      if (process.env.NODE_ENV !== 'production') {
        console.info(
          `[Pythagoras] Native geometry window=${windowWidth}x${windowHeight} ` +
            `frame=${width}x${height} inset=${HORIZONTAL_INSET} pager=${width}`
        );
      }
    },
    [windowHeight, windowWidth]
  );

  const handleScrollBeginDrag = useCallback(() => {
    draggingRef.current = true;
    clearAutoSlide();
  }, [clearAutoSlide]);

  const handleMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (banners.length === 0 || frameWidth <= 0) return;

      const contentOffsetX = event.nativeEvent.contentOffset.x;
      const pageProgress = contentOffsetX / frameWidth;
      const nearestInteger = Math.round(pageProgress);
      const nextIndex = Math.max(0, Math.min(banners.length - 1, nearestInteger));
      activeIndexRef.current = nextIndex;
      draggingRef.current = false;

      if (process.env.NODE_ENV !== 'production') {
        console.info(
          `[Pythagoras] carousel settled index=${nextIndex} offset=${contentOffsetX} ` +
            `frame=${frameWidth} progress=${pageProgress} error=${Math.abs(pageProgress - nearestInteger)}`
        );
      }

      scheduleAutoSlide();
    },
    [banners.length, frameWidth, scheduleAutoSlide]
  );

  const pagerDirectionStyle = isWeb ? undefined : { direction: 'ltr' as const };

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <StatusBar
        style={
          isFocused
            ? resolvedColorScheme === 'dark'
              ? 'light'
              : 'dark'
            : 'auto'
        }
      />
      <ScrollView
        alwaysBounceVertical
        contentContainerStyle={styles.homeScrollContent}
        contentInsetAdjustmentBehavior="never"
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        style={[styles.homeScroll, { backgroundColor: palette.background }]}
      >
        <View
          style={[
            styles.cardArea,
            {
              backgroundColor: palette.background,
              paddingBottom: insets.bottom + 24,
              paddingTop: insets.top + 12,
            },
          ]}
        >
          <View
            onLayout={handleFrameLayout}
            style={[
              styles.fixedCard,
              {
                aspectRatio: BANNER_ASPECT_WIDTH / BANNER_ASPECT_HEIGHT,
                backgroundColor: palette.background,
                width: fallbackFrameWidth,
              },
            ]}
          >
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
              onScrollBeginDrag={handleScrollBeginDrag}
              pagingEnabled
              scrollEventThrottle={16}
              showsHorizontalScrollIndicator={false}
              style={[styles.internalPager, pagerDirectionStyle, { backgroundColor: palette.background }]}
            >
              {banners.map((banner) => (
                <BannerArtworkPage key={banner.id} banner={banner} height={frameHeight} width={frameWidth} />
              ))}
            </Animated.ScrollView>
            <BannerPaginationGlass pageWidth={frameWidth} scrollX={scrollX} count={banners.length} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  homeScroll: {
    flex: 1,
  },
  homeScrollContent: {
    flexGrow: 1,
  },
  cardArea: {
    alignItems: 'center',
    flex: 1,
    width: '100%',
  },
  fixedCard: {
    borderCurve: 'continuous',
    borderRadius: 30,
    overflow: 'hidden',
    position: 'relative',
  },
  internalPager: {
    flex: 1,
  },
  pagerContent: {
    paddingHorizontal: 0,
  },
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
