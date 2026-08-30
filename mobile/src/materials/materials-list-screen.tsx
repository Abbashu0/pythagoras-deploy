import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import {
  DEFAULT_MATERIAL_SETTINGS,
  clearAppContentCache,
  fetchAppContent,
  type AppContentData,
} from '@/api/app-content';
import { MaterialCard } from '@/materials/material-card';
import {
  DEFAULT_MATERIAL_CARD_HEIGHT,
  DEFAULT_NATIVE_MATERIAL_CARD_HEIGHT,
  getNativeMaterialCardHeight,
} from '@/materials/material-dimensions';
import { usePreferences } from '@/preferences/preferences-provider';
import { getPalette, scaledFontSize, scaledLineHeight } from '@/theme';

const HORIZONTAL_INSET = 18;
const CARD_GAP = 16;

export function MaterialsListScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { fontScale, resolvedColorScheme } = usePreferences();
  const palette = getPalette(resolvedColorScheme);
  const [content, setContent] = useState<AppContentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  const loadContent = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setHasError(false);

    try {
      const nextContent = await fetchAppContent(controller.signal);
      if (!controller.signal.aborted) setContent(nextContent);
    } catch (error) {
      if (controller.signal.aborted) return;
      setHasError(true);
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[Pythagoras] Materials content unavailable', error);
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  const retryContent = useCallback(() => {
    clearAppContentCache();
    setLoading(true);
    setHasError(false);
    void loadContent();
  }, [loadContent]);

  useEffect(() => {
    const controller = new AbortController();
    requestRef.current = controller;

    fetchAppContent(controller.signal)
      .then((nextContent) => {
        if (controller.signal.aborted) return;
        setContent(nextContent);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setHasError(true);
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[Pythagoras] Materials content unavailable', error);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, []);

  const cardWidth = Math.max(1, width - HORIZONTAL_INSET * 2);
  const materialSettings = content?.materialSettings ?? DEFAULT_MATERIAL_SETTINGS;
  const cardHeight = getNativeMaterialCardHeight(
    materialSettings.cardHeight ?? DEFAULT_MATERIAL_CARD_HEIGHT
  );
  const availableMaterials = (content?.materials ?? [])
    .filter((material) => material.available)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id));

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        style={[styles.container, { backgroundColor: palette.background }]}
      >
        {loading ? (
          <View style={styles.cardList}>
            {Array.from({ length: 3 }, (_, index) => (
              <View
                key={index}
                style={[
                  styles.skeletonCard,
                  {
                    backgroundColor: palette.surfaceElevated,
                    height: DEFAULT_NATIVE_MATERIAL_CARD_HEIGHT,
                    width: cardWidth,
                  },
                ]}
              />
            ))}
          </View>
        ) : hasError ? (
          <View style={styles.stateContainer}>
            <Text
              selectable
              style={[
                styles.stateTitle,
                {
                  color: palette.text,
                  fontSize: scaledFontSize(18, fontScale),
                  lineHeight: scaledLineHeight(18, fontScale, 1.35),
                },
              ]}
            >
              تعذر تحميل المواد
            </Text>
            <Pressable
              accessibilityLabel="إعادة تحميل المواد"
              accessibilityRole="button"
              onPress={retryContent}
              style={({ pressed }) => [
                styles.retryButton,
                {
                  backgroundColor: pressed ? palette.surfacePressed : palette.surfaceElevated,
                  opacity: pressed ? 0.9 : 1,
                },
              ]}
            >
              <Text
                selectable
                style={[
                  styles.retryLabel,
                  {
                    color: palette.text,
                    fontSize: scaledFontSize(16, fontScale),
                    lineHeight: scaledLineHeight(16, fontScale, 1.3),
                  },
                ]}
              >
                إعادة المحاولة
              </Text>
            </Pressable>
          </View>
        ) : availableMaterials.length === 0 ? (
          <View style={styles.stateContainer}>
            <Text
              selectable
              style={[
                styles.stateTitle,
                {
                  color: palette.textSecondary,
                  fontSize: scaledFontSize(17, fontScale),
                  lineHeight: scaledLineHeight(17, fontScale, 1.4),
                },
              ]}
            >
              لا توجد مواد متاحة حاليًا
            </Text>
          </View>
        ) : (
          <View style={styles.cardList}>
            {availableMaterials.map((material) => (
              <MaterialCard
                key={material.id}
                cardHeight={cardHeight}
                colorScheme={resolvedColorScheme}
                fontScale={fontScale}
                material={material}
                materialSettings={materialSettings}
                onPress={() =>
                  router.push(`/materials/${material.subjectKey}` as import('expo-router').Href)
                }
                width={cardWidth}
              />
            ))}
          </View>
        )}
      </ScrollView>
      <StatusBar style={resolvedColorScheme === 'dark' ? 'light' : 'dark'} />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    gap: CARD_GAP,
    paddingBottom: 40,
    paddingHorizontal: HORIZONTAL_INSET,
    paddingTop: 24,
  },
  cardList: {
    gap: CARD_GAP,
  },
  skeletonCard: {
    borderCurve: 'continuous',
    borderRadius: 28,
  },
  stateContainer: {
    alignItems: 'center',
    flexGrow: 1,
    gap: 16,
    justifyContent: 'center',
    minHeight: 260,
  },
  stateTitle: {
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  retryButton: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: 16,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 20,
  },
  retryLabel: {
    fontWeight: '600',
    textAlign: 'center',
    writingDirection: 'rtl',
  },
});
