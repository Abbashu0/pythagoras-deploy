import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import { Image } from 'expo-image';

import { resolveApiUrl } from '@/api/client';
import type {
  PublicRichContentBlock,
  PublicRichDocument,
  RichInline,
  RichTextMark,
} from '@/question-bank/question-bank-api';
import { usePreferences } from '@/preferences/preferences-provider';
import { getPalette, scaledFontSize, scaledLineHeight } from '@/theme';

type RichTextTone = 'question' | 'answer' | 'variant';

interface RichDocumentRendererProps {
  document: PublicRichDocument;
  tone?: RichTextTone;
}

export function RichDocumentPreviewText({
  document,
  numberOfLines = 3,
  style,
}: {
  document: PublicRichDocument;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
}) {
  const { fontScale, resolvedColorScheme } = usePreferences();
  const palette = getPalette(resolvedColorScheme);
  const textStyle = getTextStyle('question', fontScale, palette.text);
  const quranLineHeight = getQuranLineHeight(textStyle);

  return (
    <Text selectable numberOfLines={numberOfLines} style={[textStyle, styles.previewText, style]}>
      {document.blocks.map((block, index) => (
        <Text key={block.id}>
          {index > 0 ? '\n' : ''}
          <PreviewBlock block={block} quranLineHeight={quranLineHeight} />
        </Text>
      ))}
    </Text>
  );
}

export function RichDocumentRenderer({ document, tone = 'answer' }: RichDocumentRendererProps) {
  const { fontScale, resolvedColorScheme } = usePreferences();
  const palette = getPalette(resolvedColorScheme);
  const textStyle = getTextStyle(tone, fontScale, palette.text);

  return (
    <View style={styles.document}>
      {document.blocks.map((block) => (
        <RichBlock
          block={block}
          key={block.id}
          palette={palette}
          textStyle={textStyle}
        />
      ))}
    </View>
  );
}

function RichBlock({
  block,
  palette,
  textStyle,
}: {
  block: PublicRichContentBlock;
  palette: ReturnType<typeof getPalette>;
  textStyle: ReturnType<typeof getTextStyle>;
}) {
  const quranLineHeight = getQuranLineHeight(textStyle);

  switch (block.type) {
    case 'paragraph':
      return (
        <Text selectable style={[textStyle, getInlineTextLineStyle(block.spans, quranLineHeight)]}>
          <InlineText quranLineHeight={quranLineHeight} spans={block.spans} />
        </Text>
      );
    case 'heading':
      return (
        <Text
          selectable
          style={[
            textStyle,
            styles.heading,
            getInlineTextLineStyle(block.spans, quranLineHeight),
            { fontSize: textStyle.fontSize + (block.level === 2 ? 3 : 1) },
          ]}
        >
          <InlineText quranLineHeight={quranLineHeight} spans={block.spans} />
        </Text>
      );
    case 'ordered-list':
    case 'bullet-list':
      return (
        <View style={styles.list}>
          {block.items.map((item, index) => (
            <View key={`${block.id}-${index}`} style={styles.listItem}>
              <Text style={[textStyle, styles.listMarker, getInlineTextLineStyle(item.spans, quranLineHeight)]}>
                {block.type === 'ordered-list' ? `${index + 1}.` : '•'}
              </Text>
              <Text selectable style={[textStyle, styles.listText, getInlineTextLineStyle(item.spans, quranLineHeight)]}>
                <InlineText quranLineHeight={quranLineHeight} spans={item.spans} />
              </Text>
            </View>
          ))}
        </View>
      );
    case 'quran':
      return (
        <View style={[styles.quran, { borderColor: palette.border }]}>
          {block.verses.map((verse) => (
            <View key={verse.id} style={styles.quranVerse}>
              {(verse.surah || verse.ayah !== undefined) && (
                <Text style={[styles.meta, { color: palette.textTertiary }]}>
                  {[verse.surah, verse.ayah].filter((part) => part !== undefined).join(' · ')}
                </Text>
              )}
              <Text selectable style={[textStyle, styles.quranText, { lineHeight: quranLineHeight }]}> 
                <InlineText quranLineHeight={quranLineHeight} spans={verse.spans} />
              </Text>
            </View>
          ))}
        </View>
      );
    case 'poetry':
      return (
        <View style={[styles.poetry, { borderColor: palette.border }]}> 
          {block.verses.map((verse) => (
            <View key={verse.id} style={styles.poetryVerse}>
              <Text selectable style={[textStyle, styles.poetryPart, styles.poetrySadr]}>
                <InlineText quranLineHeight={quranLineHeight} spans={verse.sadr} />
              </Text>
              <Text selectable style={[textStyle, styles.poetryPart, styles.poetryAjuz]}>
                <InlineText quranLineHeight={quranLineHeight} spans={verse.ajuz} />
              </Text>
            </View>
          ))}
        </View>
      );
    case 'table':
      return <RichTable block={block} palette={palette} quranLineHeight={quranLineHeight} textStyle={textStyle} />;
    case 'image':
      return (
        <View style={styles.imageBlock}>
          <Image
            accessible
            accessibilityLabel={block.alt || undefined}
            contentFit="contain"
            source={{ uri: resolveApiUrl(block.src) }}
            style={styles.image}
          />
          {block.caption && (
            <Text selectable style={[styles.caption, { color: palette.textSecondary }]}> 
              <InlineText quranLineHeight={quranLineHeight} spans={block.caption} />
            </Text>
          )}
        </View>
      );
    case 'divider':
      return <View style={[styles.divider, { backgroundColor: palette.border }]} />;
  }
}

function PreviewBlock({
  block,
  quranLineHeight,
}: {
  block: PublicRichContentBlock;
  quranLineHeight: number;
}): ReactNode {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
      return <InlineText quranLineHeight={quranLineHeight} spans={block.spans} />;
    case 'ordered-list':
    case 'bullet-list':
      return block.items.map((item, index) => (
        <Text key={`${block.id}-${index}`}>
          {index > 0 ? '\n' : ''}
          {block.type === 'ordered-list' ? `${index + 1}. ` : '• '}
          <InlineText quranLineHeight={quranLineHeight} spans={item.spans} />
        </Text>
      ));
    case 'quran':
      return block.verses.map((verse, index) => (
        <Text key={verse.id} style={[styles.quranPreviewText, { lineHeight: quranLineHeight }]}>
          {index > 0 ? '\n' : ''}
          <InlineText quranLineHeight={quranLineHeight} spans={verse.spans} />
        </Text>
      ));
    case 'poetry':
      return block.verses.map((verse, index) => (
        <Text key={verse.id}>
          {index > 0 ? '\n' : ''}
          <InlineText quranLineHeight={quranLineHeight} spans={verse.sadr} />{'     '}<InlineText quranLineHeight={quranLineHeight} spans={verse.ajuz} />
        </Text>
      ));
    case 'table':
      return block.rows.flatMap((row) => row.cells).map((cell, index) => (
        <Text key={`${block.id}-cell-${index}`}>
          {index > 0 ? ' · ' : ''}
          <InlineText quranLineHeight={quranLineHeight} spans={cell.spans} />
        </Text>
      ));
    case 'image':
      return block.caption ? <InlineText quranLineHeight={quranLineHeight} spans={block.caption} /> : null;
    case 'divider':
      return null;
  }
}

function RichTable({
  block,
  palette,
  quranLineHeight,
  textStyle,
}: {
  block: Extract<PublicRichContentBlock, { type: 'table' }>;
  palette: ReturnType<typeof getPalette>;
  quranLineHeight: number;
  textStyle: ReturnType<typeof getTextStyle>;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.tableContent}
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator
    >
      <View style={styles.table}>
        {block.caption && (
          <Text selectable style={[styles.tableCaption, { color: palette.textSecondary }]}> 
            <InlineText quranLineHeight={quranLineHeight} spans={block.caption} />
          </Text>
        )}
        {block.rows.map((row, rowIndex) => (
          <View key={`${block.id}-row-${rowIndex}`} style={styles.tableRow}>
            {row.cells.map((cell, cellIndex) => (
              <View
                key={`${block.id}-row-${rowIndex}-cell-${cellIndex}`}
                style={[
                  styles.tableCell,
                  { backgroundColor: rowIndex < block.headerRowCount ? palette.surfaceElevated : palette.surface },
                  { borderColor: palette.border },
                ]}
              >
                <Text selectable style={textStyle}>
                  <InlineText quranLineHeight={quranLineHeight} spans={cell.spans} />
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function InlineText({
  quranLineHeight,
  spans,
}: {
  quranLineHeight: number;
  spans: RichInline;
}): ReactNode {
  const quranRanges = findInlineQuranRanges(spans);
  let spanStart = 0;

  return spans.flatMap((span, index) => {
    const segments = splitInlineSpan(span.text, spanStart, quranRanges);
    spanStart += span.text.length;

    return segments.map((segment, segmentIndex) => (
      <Text
        key={`${index}-${segmentIndex}-${segment.text}`}
        style={[
          segment.isQuran ? styles.quranInlineText : undefined,
          segment.isQuran ? { lineHeight: quranLineHeight } : undefined,
          getMarkStyle(span.marks),
        ]}
      >
        {segment.text}
      </Text>
    ));
  });
}

interface InlineQuranRange {
  end: number;
  start: number;
}

interface InlineTextSegment {
  isQuran: boolean;
  text: string;
}

function findInlineQuranRanges(spans: RichInline): InlineQuranRange[] {
  const text = spans.map((span) => span.text).join('');
  const patterns = [
    /قال\s+تعالى\s*[:：]?\s*\(\s*([^()\r\n]+?)\s*\)/gu,
    /قال\s+تعالى\s*[:：]?\s*﴿\s*([^﴿﴾\r\n]+?)\s*﴾/gu,
  ];

  return patterns
    .flatMap((pattern) => {
      const ranges: InlineQuranRange[] = [];
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(text)) !== null) {
        const verse = match[1];
        if (!verse) continue;

        const verseOffset = match[0].indexOf(verse);
        ranges.push({
          end: match.index + verseOffset + verse.length,
          start: match.index + verseOffset,
        });
      }

      return ranges;
    })
    .sort((left, right) => left.start - right.start);
}

function splitInlineSpan(
  text: string,
  spanStart: number,
  quranRanges: InlineQuranRange[]
): InlineTextSegment[] {
  const spanEnd = spanStart + text.length;
  const boundaries = new Set<number>([spanStart, spanEnd]);

  for (const range of quranRanges) {
    if (range.start < spanEnd && range.end > spanStart) {
      boundaries.add(Math.max(spanStart, range.start));
      boundaries.add(Math.min(spanEnd, range.end));
    }
  }

  const points = [...boundaries].sort((left, right) => left - right);
  return points.slice(0, -1).flatMap((point, index) => {
    const nextPoint = points[index + 1];
    const segmentText = text.slice(point - spanStart, nextPoint - spanStart);
    if (!segmentText) return [];

    return [{
      isQuran: quranRanges.some((range) => point >= range.start && point < range.end),
      text: segmentText,
    }];
  });
}

function getMarkStyle(marks: RichTextMark[] | undefined) {
  if (!marks?.length) return undefined;

  return {
    fontStyle: marks.includes('italic') ? ('italic' as const) : ('normal' as const),
    fontWeight: marks.includes('bold') ? ('700' as const) : undefined,
    textDecorationLine: marks.includes('underline') ? ('underline' as const) : ('none' as const),
  };
}

function getTextStyle(tone: RichTextTone, fontScale: number, color: string) {
  const baseSize = tone === 'question' ? 20 : tone === 'variant' ? 17 : 18;
  return {
    color,
    fontSize: scaledFontSize(baseSize, fontScale),
    lineHeight: scaledLineHeight(baseSize, fontScale, 1.58),
    textAlign: 'right' as const,
    writingDirection: 'rtl' as const,
  };
}

function getQuranLineHeight(textStyle: ReturnType<typeof getTextStyle>) {
  return Math.max(textStyle.lineHeight, Math.round(textStyle.fontSize * 1.95));
}

function getInlineTextLineStyle(spans: RichInline, quranLineHeight: number) {
  return findInlineQuranRanges(spans).length > 0 ? { lineHeight: quranLineHeight } : undefined;
}

const styles = StyleSheet.create({
  document: {
    gap: 14,
  },
  heading: {
    fontWeight: '700',
    marginTop: 6,
  },
  list: {
    gap: 8,
  },
  listItem: {
    alignItems: 'flex-start',
    flexDirection: 'row-reverse',
    gap: 8,
  },
  listMarker: {
    minWidth: 24,
    textAlign: 'right',
  },
  listText: {
    flex: 1,
  },
  quran: {
    borderRightWidth: 2,
    gap: 12,
    paddingRight: 12,
  },
  quranVerse: {
    gap: 3,
  },
  quranText: {
    fontFamily: 'AmiriQuran',
    fontWeight: '500',
  },
  quranInlineText: {
    fontFamily: 'AmiriQuran',
    fontWeight: '500',
  },
  meta: {
    fontSize: 12,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  poetry: {
    borderRightWidth: 2,
    gap: 10,
    paddingRight: 12,
  },
  poetryVerse: {
    gap: 4,
  },
  poetryPart: {
    writingDirection: 'rtl',
  },
  poetrySadr: {
    textAlign: 'right',
  },
  poetryAjuz: {
    textAlign: 'left',
  },
  previewText: {
    flexShrink: 1,
  },
  quranPreviewText: {
    fontFamily: 'AmiriQuran',
  },
  imageBlock: {
    gap: 7,
  },
  image: {
    borderRadius: 12,
    height: 180,
    width: '100%',
  },
  caption: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 5,
  },
  tableContent: {
    minWidth: '100%',
  },
  table: {
    minWidth: 320,
  },
  tableCaption: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  tableRow: {
    flexDirection: 'row',
  },
  tableCell: {
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    minWidth: 110,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
});
