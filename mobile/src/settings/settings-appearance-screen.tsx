import { useCallback, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Host, Slider } from '@expo/ui';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';

import {
  type AppearanceMode,
  FONT_SCALE_DEFAULT,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  FONT_SCALE_POINTS,
  FONT_SCALE_STEP,
  type ResolvedColorScheme,
  type ThemeId,
  getFontScalePointIndex,
  usePreferences,
} from '@/preferences/preferences-provider';
import { getPalette, palettes, scaledFontSize, scaledLineHeight, type Palette } from '@/theme';

type AppearanceChoice = AppearanceMode;

type ThemeOption = {
  id: ThemeId;
  name: string;
  swatches: readonly string[];
};

const APPEARANCE_CARD_HEIGHT = 164;
const APPEARANCE_BORDER_WIDTH = 1.5;
const TITLE_SLOT_HEIGHT = 30;

const appearanceChoices: readonly { id: AppearanceChoice; label: string }[] = [
  { id: 'system', label: 'تلقائي' },
  { id: 'light', label: 'الوضع النهاري' },
  { id: 'dark', label: 'الوضع الليلي' },
];

const themeOptions: readonly ThemeOption[] = [
  {
    id: 'default',
    name: 'الثيم الافتراضي',
    swatches: [palettes.dark.background, palettes.dark.surface, palettes.dark.text, palettes.dark.accent],
  },
];

function triggerScalePointHaptic() {
  if (process.env.EXPO_OS === 'ios') {
    void Haptics.selectionAsync().catch(() => undefined);
  } else if (process.env.EXPO_OS === 'android') {
    void Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Segment_Tick).catch(
      () => undefined
    );
  }
}

function SliderScaleMarkers({ colorScheme }: { colorScheme: ResolvedColorScheme }) {
  const palette = getPalette(colorScheme);
  const lastIndex = FONT_SCALE_POINTS.length - 1;

  return (
    <View pointerEvents="none" style={styles.sliderMarkers}>
      {FONT_SCALE_POINTS.map((point, index) => {
        const isDefault = point === FONT_SCALE_DEFAULT;

        return (
          <View
            key={point}
            style={[
              styles.sliderMarker,
              {
                backgroundColor: isDefault ? palette.text : palette.textTertiary,
                left: `${(index / lastIndex) * 100}%`,
              },
              isDefault && {
                backgroundColor: palette.surface,
                borderColor: palette.text,
                borderWidth: 1.25,
                height: 8,
                marginLeft: -4,
                marginTop: -4,
                width: 8,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

function MiniPreviewContent({ palette }: { palette: Palette }) {
  return (
    <>
      <View style={styles.previewHeader}>
        <View style={[styles.previewDot, { backgroundColor: palette.accent }]} />
        <View style={[styles.previewLineShort, { backgroundColor: palette.textSecondary }]} />
      </View>
      <View style={[styles.previewLine, { backgroundColor: palette.text }]} />
      <View style={[styles.previewLineMedium, { backgroundColor: palette.textSecondary }]} />
      <View style={styles.previewFooter}>
        <View style={[styles.previewBlock, { backgroundColor: palette.accentSoft }]} />
        <View style={[styles.previewBlock, { backgroundColor: palette.surfaceElevated }]} />
      </View>
    </>
  );
}

function MiniThemePreview({ mode }: { mode: AppearanceChoice }) {
  const lightPalette = getPalette('light');
  const darkPalette = getPalette('dark');

  if (mode === 'system') {
    return (
      <View style={[styles.miniPreview, { backgroundColor: darkPalette.background }]}>
        <View style={styles.systemPreview}>
          <View style={[styles.systemPreviewPane, { backgroundColor: lightPalette.background }]}>
            <View style={[styles.systemPreviewDot, { backgroundColor: lightPalette.accent }]} />
            <View style={[styles.systemPreviewLine, { backgroundColor: lightPalette.text }]} />
          </View>
          <View style={[styles.systemPreviewPane, { backgroundColor: darkPalette.background }]}>
            <View style={[styles.systemPreviewDot, { backgroundColor: darkPalette.accent }]} />
            <View style={[styles.systemPreviewLine, { backgroundColor: darkPalette.text }]} />
          </View>
        </View>
      </View>
    );
  }

  const palette = mode === 'light' ? lightPalette : darkPalette;

  return (
    <View style={[styles.miniPreview, { backgroundColor: palette.background }]}>
      <MiniPreviewContent palette={palette} />
    </View>
  );
}

function AppearanceTile({
  choice,
  colorScheme,
  fontScale,
  onPress,
  selected,
}: {
  choice: { id: AppearanceChoice; label: string };
  colorScheme: ResolvedColorScheme;
  fontScale: number;
  onPress: () => void;
  selected: boolean;
}) {
  const palette = getPalette(colorScheme);

  return (
    <Pressable
      accessibilityLabel={choice.label}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.appearanceTile,
        {
          backgroundColor: palette.surfaceInset,
          borderColor: selected ? palette.selectionAccent : palette.border,
          borderWidth: APPEARANCE_BORDER_WIDTH,
          opacity: pressed ? 0.86 : 1,
        },
      ]}
    >
      <View style={styles.tileTitleRow}>
        <Text
          numberOfLines={1}
          selectable
          style={[
            styles.tileTitle,
            {
              color: palette.text,
              fontSize: scaledFontSize(15, fontScale),
              lineHeight: scaledLineHeight(15, fontScale, 1.3),
            },
          ]}
        >
          {choice.label}
        </Text>
      </View>
      <MiniThemePreview mode={choice.id} />
    </Pressable>
  );
}

function ThemePicker({
  colorScheme,
  fontScale,
  onThemeChange,
  selectedThemeId,
}: {
  colorScheme: ResolvedColorScheme;
  fontScale: number;
  onThemeChange: (themeId: ThemeId) => void;
  selectedThemeId: ThemeId;
}) {
  const palette = getPalette(colorScheme);

  return (
    <View
      style={[
        styles.themeOptions,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}
    >
      {themeOptions.map((theme) => {
        const selected = theme.id === selectedThemeId;

        return (
          <Pressable
            accessibilityLabel={theme.name}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            key={theme.id}
            onPress={() => onThemeChange(theme.id)}
            style={({ pressed }) => [
              styles.themeCard,
              {
                backgroundColor: palette.surfaceInset,
                borderColor: selected ? palette.selectionAccent : palette.border,
                borderWidth: APPEARANCE_BORDER_WIDTH,
                opacity: pressed ? 0.86 : 1,
              },
            ]}
          >
            <View style={styles.themeCardHeader}>
              <Text
                numberOfLines={1}
                selectable
                style={[
                  styles.themeName,
                  {
                    color: palette.text,
                    fontSize: scaledFontSize(16, fontScale),
                    lineHeight: scaledLineHeight(16, fontScale, 1.3),
                  },
                ]}
              >
                {theme.name}
              </Text>
            </View>
            <View style={styles.swatches}>
              {theme.swatches.map((swatch) => (
                <View
                  key={swatch}
                  style={[styles.swatch, { backgroundColor: swatch, borderColor: palette.border }]}
                />
              ))}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SettingsAppearanceScreen() {
  const { width } = useWindowDimensions();
  const {
    appearanceMode,
    fontScale,
    resolvedColorScheme,
    setAppearanceMode,
    setFontScale,
    setThemeId,
    themeId,
  } = usePreferences();
  const palette = getPalette(resolvedColorScheme);
  const appearanceTileWidth = width >= 340 ? '30%' : '100%';
  const selectedAppearance: AppearanceChoice = appearanceMode;
  const boundedFontScale = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, fontScale));
  const lastHapticPointRef = useRef(getFontScalePointIndex(boundedFontScale));
  const handleFontScaleChange = useCallback(
    (value: number) => {
      const pointIndex = getFontScalePointIndex(value);

      if (pointIndex !== lastHapticPointRef.current) {
        lastHapticPointRef.current = pointIndex;
        triggerScalePointHaptic();
      }

      setFontScale(value);
    },
    [setFontScale]
  );
  const previewSize = scaledFontSize(17, fontScale);
  const previewLineHeight = scaledLineHeight(17, fontScale, 1.45);

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        style={[styles.container, { backgroundColor: palette.background }]}
      >
        <View style={styles.section}>
          <Text
            selectable
            style={[
              styles.sectionTitle,
              {
                color: palette.textSecondary,
                fontSize: scaledFontSize(14, fontScale),
                lineHeight: scaledLineHeight(14, fontScale, 1.35),
              },
            ]}
          >
            الوضع
          </Text>
          <View
            style={[
              styles.appearanceChoices,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}
          >
            {appearanceChoices.map((choice) => (
              <View key={choice.id} style={{ width: appearanceTileWidth }}>
                <AppearanceTile
                  choice={choice}
                  colorScheme={resolvedColorScheme}
                  fontScale={fontScale}
                  onPress={() => setAppearanceMode(choice.id)}
                  selected={selectedAppearance === choice.id}
                />
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text
            selectable
            style={[
              styles.sectionTitle,
              {
                color: palette.textSecondary,
                fontSize: scaledFontSize(14, fontScale),
                lineHeight: scaledLineHeight(14, fontScale, 1.35),
              },
            ]}
          >
            الثيم
          </Text>
          <ThemePicker
            colorScheme={resolvedColorScheme}
            fontScale={fontScale}
            onThemeChange={setThemeId}
            selectedThemeId={themeId}
          />
        </View>

        <View style={styles.section}>
          <Text
            selectable
            style={[
              styles.sectionTitle,
              {
                color: palette.textSecondary,
                fontSize: scaledFontSize(14, fontScale),
                lineHeight: scaledLineHeight(14, fontScale, 1.35),
              },
            ]}
          >
            حجم الخط
          </Text>
          <View
            style={[
              styles.fontControl,
              {
                backgroundColor: palette.surface,
                borderColor: palette.border,
              },
            ]}
          >
            <View style={styles.fontScaleLabels}>
              <Text selectable style={[styles.scaleLabelSmall, { color: palette.textTertiary }]}>A</Text>
              <Text selectable style={[styles.scaleLabelLarge, { color: palette.textTertiary }]}>A</Text>
            </View>
            <View style={styles.sliderWrapper}>
              <Host colorScheme={resolvedColorScheme} style={styles.sliderHost}>
                <Slider
                  max={FONT_SCALE_MAX}
                  min={FONT_SCALE_MIN}
                  onValueChange={handleFontScaleChange}
                  step={FONT_SCALE_STEP}
                  testID="appearance-font-scale-slider"
                  value={boundedFontScale}
                />
              </Host>
              <SliderScaleMarkers colorScheme={resolvedColorScheme} />
            </View>
            <Text
              selectable
              style={[
                styles.preview,
                {
                  color: palette.text,
                  fontSize: previewSize,
                  lineHeight: previewLineHeight,
                },
              ]}
            >
              هكذا سيظهر النص داخل فيثاغورس
            </Text>
          </View>
        </View>
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
    gap: 28,
    paddingBottom: 40,
    paddingHorizontal: 18,
    paddingTop: 24,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontWeight: '600',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  appearanceChoices: {
    borderCurve: 'continuous',
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    direction: 'ltr',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
    padding: 12,
  },
  appearanceTile: {
    borderCurve: 'continuous',
    borderRadius: 18,
    gap: 14,
    height: APPEARANCE_CARD_HEIGHT,
    padding: 12,
  },
  tileTitleRow: {
    alignItems: 'center',
    height: TITLE_SLOT_HEIGHT,
    justifyContent: 'center',
    position: 'relative',
  },
  tileTitle: {
    flexShrink: 1,
    fontWeight: '600',
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  miniPreview: {
    borderCurve: 'continuous',
    borderRadius: 12,
    gap: 8,
    height: 86,
    justifyContent: 'center',
    padding: 12,
  },
  systemPreview: {
    flexDirection: 'row',
    gap: 4,
    height: 62,
  },
  systemPreviewDot: {
    borderRadius: 999,
    height: 7,
    width: 7,
  },
  systemPreviewLine: {
    borderRadius: 999,
    height: 5,
    width: '68%',
  },
  systemPreviewPane: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  previewHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  previewDot: {
    borderRadius: 999,
    height: 7,
    width: 7,
  },
  previewLineShort: {
    borderRadius: 999,
    height: 5,
    opacity: 0.75,
    width: '36%',
  },
  previewLine: {
    borderRadius: 999,
    height: 6,
    opacity: 0.8,
    width: '72%',
  },
  previewLineMedium: {
    borderRadius: 999,
    height: 5,
    opacity: 0.65,
    width: '54%',
  },
  previewFooter: {
    flexDirection: 'row',
    gap: 6,
  },
  previewBlock: {
    borderRadius: 5,
    height: 12,
    opacity: 0.8,
    width: 28,
  },
  themeOptions: {
    borderCurve: 'continuous',
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
    padding: 12,
  },
  themeCard: {
    borderCurve: 'continuous',
    borderRadius: 18,
    gap: 16,
    padding: 16,
  },
  themeCardHeader: {
    alignItems: 'center',
    height: TITLE_SLOT_HEIGHT,
    justifyContent: 'center',
    position: 'relative',
  },
  themeName: {
    alignSelf: 'stretch',
    fontWeight: '600',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  swatches: {
    direction: 'ltr',
    flexDirection: 'row',
    gap: 10,
  },
  swatch: {
    borderCurve: 'continuous',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    height: 24,
    width: 24,
  },
  fontControl: {
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    gap: 12,
    padding: 14,
  },
  fontScaleLabels: {
    alignItems: 'flex-end',
    direction: 'ltr',
    flexDirection: 'row',
    height: 28,
    justifyContent: 'space-between',
  },
  scaleLabelSmall: {
    fontSize: 13,
    lineHeight: 18,
  },
  scaleLabelLarge: {
    fontSize: 24,
    fontWeight: '600',
    lineHeight: 28,
  },
  sliderHost: {
    height: 36,
    width: '100%',
  },
  sliderWrapper: {
    height: 36,
    position: 'relative',
    width: '100%',
  },
  sliderMarkers: {
    bottom: 0,
    left: 10,
    position: 'absolute',
    right: 10,
    top: 0,
  },
  sliderMarker: {
    borderRadius: 999,
    height: 5.5,
    marginLeft: -2.75,
    marginTop: -2.75,
    position: 'absolute',
    top: '50%',
    width: 5.5,
  },
  preview: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
});
