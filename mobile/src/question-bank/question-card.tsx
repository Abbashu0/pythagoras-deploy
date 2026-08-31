import type { RefObject } from 'react';
import { Platform, PlatformColor, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';

import type { PublicQuestionSummary } from '@/question-bank/question-bank-api';
import { questionBankIcons } from '@/question-bank/question-bank-icons';
import { RichDocumentPreviewText } from '@/question-bank/rich-document-renderer';
import { getQuestionSourceBadges } from '@/question-bank/question-source-badges';
import type { Palette } from '@/theme';
import { scaledFontSize, scaledLineHeight } from '@/theme';

export const QUESTION_CARD_HEIGHT = 116;
export const QUESTION_CARD_RADIUS = 22;
export const QUESTION_CARD_GAP = 11;

const FAVORITE_SLOT_SIZE = 16;
const FAVORITE_ORDINAL_GAP = 6;

interface QuestionCardProps {
  cardRef: RefObject<View | null>;
  fontScale: number;
  hidden?: boolean;
  isFavorite?: boolean;
  onPress: () => void;
  palette: Palette;
  question: PublicQuestionSummary;
}

export function QuestionCard({
  cardRef,
  fontScale,
  hidden = false,
  isFavorite = false,
  onPress,
  palette,
  question,
}: QuestionCardProps) {
  const questionFontSize = scaledFontSize(17, fontScale);
  const sourceBadges = getQuestionSourceBadges(question.sourceSummary);
  const sourceAccessibilityText = sourceBadges.map((badge) => badge.label).join('. ');
  const accessibilityLabel = [
    `السؤال رقم ${question.ordinal}. ${question.primaryPreview}`,
    sourceAccessibilityText,
    isFavorite ? 'مضاف إلى المفضلة' : '',
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <View
      ref={cardRef}
      collapsable={false}
      pointerEvents={hidden ? 'none' : 'auto'}
      style={[
        styles.measureFrame,
        {
          opacity: hidden ? 0 : 1,
        },
      ]}
    >
      <Pressable
        accessibilityHint="يفتح قارئ السؤال"
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
          onPress();
        }}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: pressed ? palette.surfacePressed : palette.surface,
            borderColor: palette.border,
          },
        ]}
      >
        <View pointerEvents="none" style={styles.metaRow}>
          <View style={styles.metaLeading}>
            {sourceBadges.map((badge) => (
              <View
                key={badge.sourceKind}
                style={[styles.sourceBadge, { backgroundColor: palette.surfaceElevated }]}
              >
                <Text style={[styles.sourceBadgeText, { color: palette.textSecondary }]}>
                  {badge.label}
                </Text>
              </View>
            ))}
          </View>
          <View style={styles.metaTrailing}>
            <View style={styles.favoriteSlot}>
              {isFavorite ? (
                <Host matchContents style={styles.favoriteIconHost}>
                  <Icon
                    color={Platform.OS === 'ios' ? PlatformColor('systemRed') : '#BA1A1A'}
                    name={questionBankIcons.heartFill}
                    size={15}
                  />
                </Host>
              ) : null}
            </View>
            <Text selectable style={[styles.ordinal, { color: Platform.OS === 'ios' ? PlatformColor('systemBlue') : palette.selectionAccent }]}>#{question.ordinal}</Text>
          </View>
        </View>
        <View style={styles.textRegion}>
          {question.primaryPreviewRich.blocks.length ? (
            <RichDocumentPreviewText
              document={question.primaryPreviewRich}
              numberOfLines={3}
              style={[styles.question, { color: palette.text, fontSize: questionFontSize, lineHeight: scaledLineHeight(17, fontScale, 1.48) }]}
            />
          ) : (
            <Text selectable numberOfLines={3} style={[styles.question, { color: palette.text, fontSize: questionFontSize, lineHeight: scaledLineHeight(17, fontScale, 1.48) }]}>
              {question.primaryPreview}
            </Text>
          )}
        </View>
      </Pressable>
    </View>
  );
}

export function QuestionCardSkeleton({ palette }: { palette: Palette }) {
  return (
    <View
      style={[
        styles.card,
        styles.skeletonCard,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}
    >
       <View style={[styles.skeletonOrdinal, { backgroundColor: palette.surfaceElevated }]} />
      <View style={styles.skeletonTextRegion}>
        <View style={[styles.skeletonLine, { backgroundColor: palette.surfaceElevated, width: '88%' }]} />
        <View style={[styles.skeletonLine, { backgroundColor: palette.surfaceElevated, width: '72%' }]} />
        <View style={[styles.skeletonLine, { backgroundColor: palette.surfaceElevated, width: '54%' }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  measureFrame: {
    height: QUESTION_CARD_HEIGHT,
    width: '100%',
  },
  card: {
    alignSelf: 'stretch',
    borderCurve: 'continuous',
    borderRadius: QUESTION_CARD_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    height: QUESTION_CARD_HEIGHT,
    overflow: 'hidden',
    paddingBottom: 15,
    paddingHorizontal: 18,
    paddingTop: 14,
  },
  metaRow: {
    alignItems: 'center',
    direction: 'ltr',
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 18,
    position: 'absolute',
    right: 18,
    top: 12,
  },
  metaLeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  metaTrailing: {
    alignItems: 'center',
    direction: 'ltr',
    flexDirection: 'row',
    gap: FAVORITE_ORDINAL_GAP,
  },
  ordinal: {
    fontSize: 18,
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
    lineHeight: 22,
    textAlign: 'right',
    writingDirection: 'ltr',
  },
  sourceBadge: {
    borderRadius: 9,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  sourceBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
    writingDirection: 'rtl',
  },
  favoriteIconHost: {
    height: FAVORITE_SLOT_SIZE,
    width: FAVORITE_SLOT_SIZE,
  },
  favoriteSlot: {
    alignItems: 'center',
    height: FAVORITE_SLOT_SIZE,
    justifyContent: 'center',
    width: FAVORITE_SLOT_SIZE,
  },
  textRegion: {
    flex: 1,
    justifyContent: 'center',
    paddingTop: 22,
  },
  question: {
    fontWeight: '500',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  skeletonCard: {
    justifyContent: 'center',
  },
  skeletonOrdinal: {
    borderRadius: 5,
    height: 14,
    left: 18,
    position: 'absolute',
    top: 14,
    width: 28,
  },
  skeletonTextRegion: {
    gap: 10,
    marginTop: 16,
  },
  skeletonLine: {
    borderRadius: 5,
    height: 10,
  },
});
