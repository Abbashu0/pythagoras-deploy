import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  PlatformColor,
  type ColorValue,
  useWindowDimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  fetchQuestionDetail,
  type PublicQuestionDetail,
  type PublicQuestionOccurrence,
  type PublicQuestionSummary,
  type QuestionSourceKind,
} from '@/question-bank/question-bank-api';
import { questionBankIcons } from '@/question-bank/question-bank-icons';
import { QUESTION_CARD_RADIUS } from '@/question-bank/question-card';
import { RichDocumentRenderer } from '@/question-bank/rich-document-renderer';
import {
  countMinisterialOccurrences,
  getAggregateQuestionOccurrences,
  getOrderedQuestionVariants,
  getPrimaryQuestionVariant,
  getQuestionVariantLabel,
  QUESTION_VARIANTS_SECTION_TITLE,
  shouldRenderQuestionVariants,
} from '@/question-bank/question-reader-model';
import { HomeCircularAction } from '@/profile/profile-entry';
import { usePreferences } from '@/preferences/preferences-provider';
import { getPalette, scaledFontSize, scaledLineHeight } from '@/theme';

export interface QuestionSourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface QuestionReaderOverlayProps {
  bankNodeId: string;
  initialFavorite: boolean;
  onClosed: () => void;
  onFavoriteChange: (favorite: boolean) => Promise<void>;
  question: PublicQuestionSummary;
  sourceRect: QuestionSourceRect | null;
  subjectKey: string;
}

const READER_OPEN_DURATION = 300;
const READER_CLOSE_DURATION = 260;
const READER_MIN_HEIGHT = 320;
const READER_HEADER_HEIGHT = 62;
const READER_CONTENT_PADDING_TOP = 10;
const READER_CONTENT_PADDING_BOTTOM = 34;
const READER_VERTICAL_CHROME =
  READER_HEADER_HEIGHT + READER_CONTENT_PADDING_TOP + READER_CONTENT_PADDING_BOTTOM;

export function QuestionReaderOverlay({
  bankNodeId,
  initialFavorite,
  onClosed,
  onFavoriteChange,
  question,
  sourceRect,
  subjectKey,
}: QuestionReaderOverlayProps) {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { fontScale, resolvedColorScheme } = usePreferences();
  const palette = getPalette(resolvedColorScheme);
  const reduceMotion = useReducedMotion();
  const [detail, setDetail] = useState<PublicQuestionDetail | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [favoriteOverride, setFavoriteOverride] = useState<boolean | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const favoriteRef = useRef(initialFavorite);
  const confirmedFavoriteRef = useRef(initialFavorite);
  const favoriteWriteRef = useRef<Promise<void>>(Promise.resolve());
  const progress = useSharedValue(0);
  const readerHeight = useSharedValue(READER_MIN_HEIGHT);
  const favorite = favoriteOverride ?? initialFavorite;

  useEffect(() => {
    if (favoriteOverride === null) {
      favoriteRef.current = initialFavorite;
      confirmedFavoriteRef.current = initialFavorite;
    }
  }, [favoriteOverride, initialFavorite]);

  const safeHeight = Math.max(1, windowHeight - insets.top - insets.bottom);
  const maxReaderHeight = Math.max(READER_MIN_HEIGHT, Math.min(safeHeight * 0.78, 720));
  const desiredReaderHeight = Math.min(
    maxReaderHeight,
    Math.max(READER_MIN_HEIGHT, (contentHeight ?? 0) + READER_VERTICAL_CHROME)
  );
  const targetRect = useMemo(() => {
    const width = Math.max(280, Math.min(windowWidth - 30, 680));
    return {
      height: desiredReaderHeight,
      width,
      x: (windowWidth - width) / 2,
      y: insets.top + Math.max(12, (safeHeight - desiredReaderHeight) / 2),
    };
  }, [desiredReaderHeight, insets.top, safeHeight, windowWidth]);

  const fromRect = useMemo(() => {
    if (sourceRect && sourceRect.width > 0 && sourceRect.height > 0) return sourceRect;
    return {
      height: targetRect.height * 0.92,
      width: targetRect.width * 0.92,
      x: targetRect.x + targetRect.width * 0.04,
      y: targetRect.y + targetRect.height * 0.04,
    };
  }, [sourceRect, targetRect]);

  useEffect(() => {
    readerHeight.value = withTiming(desiredReaderHeight, {
      duration: reduceMotion ? 100 : 180,
      easing: Easing.out(Easing.cubic),
    });
  }, [desiredReaderHeight, readerHeight, reduceMotion]);

  useEffect(() => {
    progress.value = 0;
    progress.value = withTiming(1, {
      duration: reduceMotion ? 120 : READER_OPEN_DURATION,
      easing: Easing.out(Easing.cubic),
    });
  }, [progress, reduceMotion]);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;
    fetchQuestionDetail(subjectKey, bankNodeId, question.questionId, controller.signal)
      .then((nextDetail) => {
        if (mounted) setDetail(nextDetail);
      })
      .catch((error) => {
        if (!mounted || controller.signal.aborted) return;
        setDetailError(true);
        if (process.env.NODE_ENV !== 'production') console.warn('[Pythagoras] Question detail unavailable', error);
      });
    return () => {
      mounted = false;
      controller.abort();
    };
  }, [bankNodeId, question.questionId, retryKey, subjectKey]);

  const readerStyle = useAnimatedStyle(() => ({
    borderRadius: interpolate(progress.value, [0, 1], [QUESTION_CARD_RADIUS, 30], Extrapolation.CLAMP),
    height: interpolate(progress.value, [0, 1], [fromRect.height, readerHeight.value], Extrapolation.CLAMP),
    left: interpolate(progress.value, [0, 1], [fromRect.x, targetRect.x], Extrapolation.CLAMP),
    top: interpolate(progress.value, [0, 1], [fromRect.y, targetRect.y], Extrapolation.CLAMP),
    width: interpolate(progress.value, [0, 1], [fromRect.width, targetRect.width], Extrapolation.CLAMP),
  }));
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 0.28], Extrapolation.CLAMP),
  }));

  const closeReader = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    // Reanimated owns this shared value on the UI thread during the close.
    // eslint-disable-next-line react-hooks/immutability
    progress.value = withTiming(0, {
      duration: reduceMotion ? 100 : READER_CLOSE_DURATION,
      easing: Easing.in(Easing.cubic),
    }, (finished) => {
      if (finished) runOnJS(onClosed)();
    });
  }, [isClosing, onClosed, progress, reduceMotion]);

  const handleFavorite = useCallback(() => {
    if (isClosing) return;
    // Keep the next state synchronously so rapid taps cannot read the same
    // pre-render value more than once.
    const nextFavorite = !favoriteRef.current;
    favoriteRef.current = nextFavorite;
    setFavoriteOverride(nextFavorite);
    void Haptics.selectionAsync().catch(() => undefined);

    // SQLite writes are serialized, while the icon remains optimistically
    // responsive to every accepted tap.
    const operation = favoriteWriteRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          await onFavoriteChange(nextFavorite);
          confirmedFavoriteRef.current = nextFavorite;
        } catch (error) {
          if (favoriteRef.current === nextFavorite) {
            favoriteRef.current = confirmedFavoriteRef.current;
            setFavoriteOverride(confirmedFavoriteRef.current);
          }
          throw error;
        }
      });

    favoriteWriteRef.current = operation;
    void operation.catch(() => undefined);
  }, [isClosing, onFavoriteChange]);

  const retryDetail = useCallback(() => {
    setDetail(null);
    setDetailError(false);
    setRetryKey((value) => value + 1);
  }, []);

  const primaryVariant = getPrimaryQuestionVariant(detail);
  const sortedVariants = getOrderedQuestionVariants(detail);
  const occurrences = useMemo(() => getAggregateQuestionOccurrences(detail), [detail]);
  const favoriteColor = favorite ? Platform.OS === 'ios' ? PlatformColor('systemRed') : '#BA1A1A' : palette.textSecondary;

  return (
    <Modal animationType="none" onRequestClose={closeReader} presentationStyle="overFullScreen" statusBarTranslucent transparent visible>
      <View style={styles.modalRoot}>
        <BlurView blurMethod={Platform.OS === 'android' ? 'dimezisBlurViewSdk31Plus' : undefined} intensity={45} style={StyleSheet.absoluteFill} tint={resolvedColorScheme === 'dark' ? 'dark' : 'light'} />
        <Animated.View pointerEvents="none" style={[styles.scrim, scrimStyle]} />
        <Pressable accessibilityHint="يغلق قارئ السؤال" accessibilityLabel="إغلاق قارئ السؤال" accessibilityRole="button" onPress={closeReader} style={StyleSheet.absoluteFill} />
        <Animated.View accessibilityViewIsModal importantForAccessibility="yes" style={[styles.readerPosition, readerStyle]}>
          <View style={[styles.readerSurface, { backgroundColor: palette.surface }]}>
            <View style={styles.utilityRow}>
              <ReaderCircleButton accessibilityLabel={favorite ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'} color={favoriteColor} icon={favorite ? 'heartFill' : 'heart'} onPress={handleFavorite} resolvedColorScheme={resolvedColorScheme} selected={favorite} />
              <Text pointerEvents="none" selectable style={[styles.readerOrdinal, { color: Platform.OS === 'ios' ? PlatformColor('systemBlue') : palette.selectionAccent, fontSize: scaledFontSize(16, fontScale) }]}>#{question.ordinal}</Text>
              <ReaderCircleButton accessibilityLabel="إغلاق السؤال" color={palette.textSecondary} icon="close" onPress={closeReader} resolvedColorScheme={resolvedColorScheme} />
            </View>
            <ScrollView contentContainerStyle={styles.readerContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator style={styles.readerBody}>
              <View onLayout={(event) => setContentHeight(event.nativeEvent.layout.height)}>
                <Text selectable style={[styles.sectionLabel, { color: palette.textSecondary, fontSize: scaledFontSize(14, fontScale) }]}>السؤال</Text>
                {primaryVariant ? <RichDocumentRenderer document={primaryVariant.content} tone="question" /> : <RichDocumentRenderer document={question.primaryPreviewRich} tone="question" />}
                <ProvenanceBlock occurrences={occurrences} palette={palette} fontScale={fontScale} />
                {detailError && !detail ? <DetailError onRetry={retryDetail} palette={palette} /> : null}
                {detail ? (
                  <>
                    <View style={[styles.sectionDivider, { backgroundColor: palette.border }]} />
                    <Text selectable style={[styles.sectionLabel, { color: palette.textSecondary, fontSize: scaledFontSize(14, fontScale) }]}>الجواب</Text>
                    {detail.sharedAnswer ? <RichDocumentRenderer document={detail.sharedAnswer} tone="answer" /> : <Text selectable style={[styles.missingAnswer, { color: palette.textTertiary, fontSize: scaledFontSize(16, fontScale), lineHeight: scaledLineHeight(16, fontScale, 1.45) }]}>لا يوجد جواب مضاف لهذا السؤال</Text>}
                    {shouldRenderQuestionVariants(sortedVariants) ? <VariantsList fontScale={fontScale} palette={palette} variants={sortedVariants} /> : null}
                  </>
                ) : null}
                {!detail && !detailError ? <ReaderSkeleton palette={palette} /> : null}
              </View>
            </ScrollView>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function ReaderCircleButton({ accessibilityLabel, color, icon, onPress, resolvedColorScheme, selected = false }: { accessibilityLabel: string; color: ColorValue; icon: keyof typeof questionBankIcons; onPress: () => void; resolvedColorScheme: 'light' | 'dark'; selected?: boolean }) {
  return (
    <HomeCircularAction
      accessibilityLabel={accessibilityLabel}
      accessibilityState={selected ? { selected: true } : undefined}
      onPress={onPress}
      size={52}
    >
      <Host colorScheme={resolvedColorScheme} layoutDirection="rightToLeft" matchContents style={styles.readerActionIconHost}>
        <Icon color={color} name={questionBankIcons[icon]} size={21} />
      </Host>
    </HomeCircularAction>
  );
}

function ReaderDisclosure({ accessibilityLabel, expanded, fontScale, label, onPress, palette }: { accessibilityLabel?: string; expanded: boolean; fontScale: number; label: string; onPress: () => void; palette: ReturnType<typeof getPalette> }) {
  const { resolvedColorScheme } = usePreferences();
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={({ pressed }) => [styles.disclosure, pressed && styles.disclosurePressed]}
    >
      <Text style={[styles.disclosureText, { color: palette.textSecondary, fontSize: scaledFontSize(13, fontScale) }]}>{label}</Text>
      <Host
        colorScheme={resolvedColorScheme}
        layoutDirection="rightToLeft"
        matchContents
        style={[styles.chevronHost, expanded && styles.chevronExpanded]}
      >
        <Icon color={palette.textSecondary} name={questionBankIcons.chevronDown} size={16} />
      </Host>
    </Pressable>
  );
}

function ProvenanceBlock({ occurrences, palette, fontScale }: { occurrences: PublicQuestionOccurrence[]; palette: ReturnType<typeof getPalette>; fontScale: number }) {
  const [expanded, setExpanded] = useState(false);
  if (!occurrences.length) return null;
  if (occurrences.length === 1) {
    return <View style={styles.provenanceSingle}><Text selectable style={[styles.occurrenceText, { color: palette.textSecondary, fontSize: scaledFontSize(13, fontScale), lineHeight: scaledLineHeight(13, fontScale, 1.4) }]}>{formatOccurrence(occurrences[0])}</Text></View>;
  }
  const ministerialCount = countMinisterialOccurrences(occurrences);
  const summaryLabel = ministerialCount > 0
    ? `وزاري ${ministerialCount}${ministerialCount === 1 ? '' : ' مرات'}`
    : `المصادر ${occurrences.length}`;
  return (
    <View style={styles.provenanceBlock}>
      <ReaderDisclosure
        accessibilityLabel={summaryLabel}
        expanded={expanded}
        label={summaryLabel}
        onPress={() => setExpanded((value) => !value)}
        palette={palette}
        fontScale={fontScale}
      />
      {expanded && occurrences.map((occurrence) => <Text key={occurrence.id} selectable style={[styles.occurrenceText, { color: palette.textSecondary, fontSize: scaledFontSize(13, fontScale), lineHeight: scaledLineHeight(13, fontScale, 1.4) }]}>{formatOccurrence(occurrence)}</Text>)}
    </View>
  );
}

function VariantsList({ fontScale, palette, variants }: { fontScale: number; palette: ReturnType<typeof getPalette>; variants: PublicQuestionDetail['variants'] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.variantsSection}>
      <ReaderDisclosure
        accessibilityLabel={QUESTION_VARIANTS_SECTION_TITLE}
        expanded={expanded}
        fontScale={fontScale}
        label={QUESTION_VARIANTS_SECTION_TITLE}
        onPress={() => setExpanded((value) => !value)}
        palette={palette}
      />
      {expanded ? (
        <View style={styles.variantsList}>
          {variants.map((variant, index) => (
            <View
              key={variant.id}
              style={[styles.variantBlock, { borderColor: palette.border }]}
            >
              <Text selectable style={[styles.variantLabel, { color: palette.textTertiary, fontSize: scaledFontSize(13, fontScale) }]}>{getQuestionVariantLabel(index)}</Text>
              <RichDocumentRenderer document={variant.content} tone="variant" />
              <VariantProvenance fontScale={fontScale} occurrences={variant.occurrences} palette={palette} />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function VariantProvenance({ occurrences, palette, fontScale }: { occurrences: PublicQuestionOccurrence[]; palette: ReturnType<typeof getPalette>; fontScale: number }) {
  if (!occurrences.length) return null;
  return <View style={styles.variantProvenance}>{occurrences.map((occurrence) => <Text key={occurrence.id} selectable style={[styles.occurrenceText, { color: palette.textSecondary, fontSize: scaledFontSize(13, fontScale), lineHeight: scaledLineHeight(13, fontScale, 1.4) }]}>{formatOccurrence(occurrence)}</Text>)}</View>;
}

function ReaderSkeleton({ palette }: { palette: ReturnType<typeof getPalette> }) {
  return <View style={styles.skeleton}>{[0, 1, 2].map((index) => <View key={index} style={[styles.skeletonLine, { backgroundColor: palette.surfaceElevated, width: index === 2 ? '55%' : index === 1 ? '82%' : '94%' }]} />)}</View>;
}

function DetailError({ onRetry, palette }: { onRetry: () => void; palette: ReturnType<typeof getPalette> }) {
  return <View style={styles.detailError}><Text selectable style={[styles.detailErrorText, { color: palette.textTertiary }]}>تعذر تحميل تفاصيل السؤال</Text><Pressable accessibilityRole="button" onPress={onRetry}><Text style={[styles.retryText, { color: palette.textSecondary }]}>إعادة المحاولة</Text></Pressable></View>;
}

const SOURCE_LABELS: Record<QuestionSourceKind, string> = {
  ministerial: 'وزاري',
  'discussion-question': 'أسئلة المناقشة',
  'educational-tv': 'التلفزيون التربوي',
  'end-of-chapter': 'أسئلة نهاية الفصل',
  'book-question': 'سؤال من الكتاب',
  'book-exercise': 'تمرين من الكتاب',
  enrichment: 'إثرائي',
  other: 'مصدر آخر',
};

function formatOccurrence(occurrence: PublicQuestionOccurrence) {
  const sourceLabel = occurrence.sourceKind === 'other' && occurrence.sourceName?.trim() ? occurrence.sourceName.trim() : SOURCE_LABELS[occurrence.sourceKind];
  const parts = [sourceLabel, occurrence.year?.toString(), occurrence.roundCode, occurrence.session, occurrence.sourceKind !== 'other' ? occurrence.sourceName : null, occurrence.branches.length ? occurrence.branches.join('، ') : null, occurrence.qualifiers.length ? occurrence.qualifiers.join('، ') : null].filter((part): part is string => Boolean(part?.trim()));
  if (parts.length > 1 || !occurrence.rawLabel.trim()) return parts.join(' • ');
  return occurrence.rawLabel.trim();
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1 },
  scrim: { backgroundColor: '#000000', bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  readerPosition: { overflow: 'hidden', position: 'absolute' },
  readerSurface: { borderCurve: 'continuous', flex: 1, overflow: 'hidden' },
  utilityRow: { alignItems: 'center', direction: 'ltr', flexDirection: 'row', justifyContent: 'space-between', minHeight: READER_HEADER_HEIGHT, paddingHorizontal: 16, paddingTop: 8 },
  readerActionIconHost: { height: 24, width: 24 },
  readerOrdinal: { fontVariant: ['tabular-nums'], fontWeight: '700', left: 0, position: 'absolute', right: 0, textAlign: 'center', writingDirection: 'ltr' },
  readerBody: { flex: 1 },
  readerContent: { gap: 15, paddingBottom: READER_CONTENT_PADDING_BOTTOM, paddingHorizontal: 20, paddingTop: READER_CONTENT_PADDING_TOP },
  sectionLabel: { fontWeight: '700', textAlign: 'right', writingDirection: 'rtl' },
  sectionDivider: { height: StyleSheet.hairlineWidth, marginVertical: 6 },
  missingAnswer: { textAlign: 'right', writingDirection: 'rtl' },
  provenanceSingle: { alignItems: 'center', paddingTop: 2 },
  provenanceBlock: { alignItems: 'stretch', gap: 8 },
  disclosure: { alignItems: 'center', alignSelf: 'center', flexDirection: 'row', gap: 4, minHeight: 44, paddingHorizontal: 12, paddingVertical: 5 },
  disclosurePressed: { opacity: 0.65 },
  disclosureText: { fontWeight: '600', writingDirection: 'rtl' },
  chevronHost: { height: 18, width: 18 },
  chevronExpanded: { transform: [{ rotate: '180deg' }] },
  occurrenceText: { textAlign: 'center', writingDirection: 'rtl' },
  variantsSection: { gap: 13, marginTop: 6 },
  variantsList: { gap: 13 },
  variantBlock: { borderTopWidth: StyleSheet.hairlineWidth, gap: 10, paddingTop: 13 },
  variantProvenance: { gap: 5, paddingTop: 1 },
  variantLabel: { fontWeight: '600', textAlign: 'right', writingDirection: 'rtl' },
  skeleton: { gap: 11, paddingVertical: 7 },
  skeletonLine: { borderRadius: 5, height: 11 },
  detailError: { alignItems: 'flex-end', gap: 7 },
  detailErrorText: { textAlign: 'right', writingDirection: 'rtl' },
  retryText: { fontWeight: '600', textAlign: 'right', writingDirection: 'rtl' },
});
