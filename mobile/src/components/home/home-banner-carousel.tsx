import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { useIsFocused } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchAppContent, type AppContentData } from '@/api/app-content';
import { HomeBannerPager } from '@/components/home/home-banner-pager';
import { usePreferences } from '@/preferences/preferences-provider';
import { getPalette } from '@/theme';

const HORIZONTAL_INSET = 18;
const BANNER_ASPECT_WIDTH = 5;
const BANNER_ASPECT_HEIGHT = 2;

type FrameSize = {
  width: number;
  height: number;
};

export function HomeBannerCarousel() {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { resolvedColorScheme } = usePreferences();
  const palette = getPalette(resolvedColorScheme);
  const fallbackFrameWidth = Math.max(1, windowWidth - HORIZONTAL_INSET * 2);
  const fallbackFrameHeight = (fallbackFrameWidth * BANNER_ASPECT_HEIGHT) / BANNER_ASPECT_WIDTH;
  const [frameSize, setFrameSize] = useState<FrameSize | null>(null);
  const frameWidth = frameSize?.width ?? fallbackFrameWidth;
  const frameHeight = frameSize?.height ?? fallbackFrameHeight;
  const activeIndexRef = useRef(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const draggingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [appState, setAppState] = useState(AppState.currentState);
  const [content, setContent] = useState<AppContentData | null>(null);
  const banners = content?.banners ?? [];
  const isAppActive = appState === 'active';
  const isIOS = process.env.EXPO_OS === 'ios';

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
      timerRef.current = null;

      if (draggingRef.current) {
        return;
      }

      const nextIndex = (activeIndexRef.current + 1) % banners.length;
      activeIndexRef.current = nextIndex;
      setSelectedIndex(nextIndex);
    }, content.autoSlideInterval);
  }, [banners.length, clearAutoSlide, content, frameSize, isAppActive, isFocused]);

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
  }, [clearAutoSlide, scheduleAutoSlide, selectedIndex]);

  useEffect(() => {
    const nextIndex = banners.length === 0 ? 0 : Math.min(activeIndexRef.current, banners.length - 1);
    activeIndexRef.current = nextIndex;
    setSelectedIndex(nextIndex);
  }, [banners.length]);

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

  const handlePagerSelectionChange = useCallback(
    (nextIndex: number) => {
      if (nextIndex < 0 || nextIndex >= banners.length) return;

      activeIndexRef.current = nextIndex;
      setSelectedIndex(nextIndex);
      draggingRef.current = false;
      scheduleAutoSlide();
    },
    [banners.length, scheduleAutoSlide]
  );

  const handleNativeTouchEnd = useCallback(() => {
    if (!isIOS || !draggingRef.current) return;

    draggingRef.current = false;
    scheduleAutoSlide();
  }, [isIOS, scheduleAutoSlide]);

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
            onTouchCancel={isIOS ? handleNativeTouchEnd : undefined}
            onTouchEnd={isIOS ? handleNativeTouchEnd : undefined}
            onTouchStart={isIOS ? handleScrollBeginDrag : undefined}
            style={[
              styles.fixedCard,
              {
                aspectRatio: BANNER_ASPECT_WIDTH / BANNER_ASPECT_HEIGHT,
                backgroundColor: palette.background,
                width: fallbackFrameWidth,
              },
            ]}
          >
            <HomeBannerPager
              banners={banners}
              frameHeight={frameHeight}
              frameWidth={frameWidth}
              onInteractionStart={isIOS ? undefined : handleScrollBeginDrag}
              onSelectionChange={handlePagerSelectionChange}
              selectedIndex={selectedIndex}
            />
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
});
