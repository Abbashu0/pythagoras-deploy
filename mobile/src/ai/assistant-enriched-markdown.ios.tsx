import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { Linking, Platform, type LayoutChangeEvent } from 'react-native';
import {
  EnrichedMarkdownText,
  type MarkdownStyle,
} from 'react-native-enriched-markdown';
import { sealIncompleteMarkdown } from '@ronradtke/react-native-markdown-display/dist/lib/view/util/sealIncompleteMarkdown';

import type { Palette } from '@/theme';
import { scaledFontSize } from '@/theme';
import { hideUnclosedMathSuffix } from './rich-response/math-delimiters';
import { isSafeAgent1Link } from './rich-response/math-markdown-plugin';
import { prepareEnrichedMarkdownInput } from './rich-response/enriched-markdown-input';
import { usePreferences } from '@/preferences/preferences-provider';

interface Agent1EnrichedMarkdownProps {
  messageId: string;
  content: string;
  streaming: boolean;
  contentWidth: number;
  palette: Palette;
  layoutDiagnosticsEnabled?: boolean;
  onLayoutDiagnostic?: (
    event: string,
    values: Record<string, string | number | boolean | null>,
  ) => void;
}

const MARKDOWN_FLAGS = {
  latexMath: true,
  underline: false,
  superscript: false,
  subscript: false,
  highlight: false,
} as const;

const SELECTION_MENU_CONFIG = {
  copyAsMarkdown: { enabled: false },
  copyImageUrl: { enabled: false },
} as const;

const Agent1EnrichedMarkdown = memo(function Agent1EnrichedMarkdown({
  messageId,
  content,
  streaming,
  contentWidth,
  palette,
  layoutDiagnosticsEnabled = false,
  onLayoutDiagnostic,
}: Agent1EnrichedMarkdownProps) {
  const { fontScale } = usePreferences();
  const bodyFontSize = scaledFontSize(17, fontScale);
  const markdownStyle = useMemo(
    () => createMarkdownStyle(palette, bodyFontSize, fontScale),
    [bodyFontSize, fontScale, palette],
  );
  const markdown = useMemo(() => {
    const stablePrefix = streaming
      ? hideUnclosedMathSuffix(sealIncompleteMarkdown(content))
      : content;
    return prepareEnrichedMarkdownInput(stablePrefix);
  }, [content, streaming]);
  const lastDiagnosticRef = useRef('');
  useEffect(() => {
    if (!__DEV__ || !layoutDiagnosticsEnabled || streaming) return;
    const diagnosticKey = `${messageId}:${content.length}:${markdown.length}:${contentWidth}`;
    if (lastDiagnosticRef.current === diagnosticKey) return;
    lastDiagnosticRef.current = diagnosticKey;
    onLayoutDiagnostic?.('assistant-source', {
      messageId,
      sourceCharacters: content.length,
      presentationCharacters: markdown.length,
      contentWidth,
      flavor: 'github',
      streaming,
    });
  }, [
    content.length,
    contentWidth,
    layoutDiagnosticsEnabled,
    markdown.length,
    messageId,
    onLayoutDiagnostic,
    streaming,
  ]);
  const handleLinkPress = useCallback(({ url }: { url: string }) => {
    if (!isSafeAgent1Link(url)) return;
    void Linking.openURL(url).catch(() => undefined);
  }, []);
  const handleNativeLayout = useCallback((event: LayoutChangeEvent) => {
    if (!__DEV__ || !layoutDiagnosticsEnabled) return;
    const { x, y, width, height } = event.nativeEvent.layout;
    const metrics = {
      messageId,
      sourceCharacters: content.length,
      presentationCharacters: markdown.length,
      x,
      y,
      width,
      height,
      flavor: 'github',
      streaming,
    };
    onLayoutDiagnostic?.('native-markdown-layout', metrics);
  }, [content.length, layoutDiagnosticsEnabled, markdown.length, messageId, onLayoutDiagnostic, streaming]);

  if (contentWidth <= 0 || markdown.length === 0) return null;

  return (
    <EnrichedMarkdownText
      onLayout={handleNativeLayout}
      markdown={markdown}
      markdownStyle={markdownStyle}
      containerStyle={{ width: contentWidth, alignSelf: 'stretch' }}
      writingDirection="first-strong"
      flavor="github"
      md4cFlags={MARKDOWN_FLAGS}
      onLinkPress={handleLinkPress}
      enableLinkPreview={false}
      selectionMenuConfig={SELECTION_MENU_CONFIG}
      allowTrailingMargin={false}
      streamingAnimation={streaming}
    />
  );
});

const READING_RHYTHM = {
  paragraphAfter: 12,
  majorHeadingBefore: 18,
  sectionHeadingBefore: 16,
  subsectionHeadingBefore: 14,
  compactHeadingBefore: 12,
  tightHeadingBefore: 10,
  headingAfter: 6,
  subsectionHeadingAfter: 5,
  compactHeadingAfter: 4,
  listGroupAfter: 11,
  quoteAfter: 12,
  codeAfter: 10,
  dividerSpacing: 20,
  tableBefore: 10,
  tableAfter: 12,
  displayMathBefore: 10,
  displayMathAfter: 12,
} as const;

function createMarkdownStyle(palette: Palette, bodyFontSize: number, fontScale: number): MarkdownStyle {
  const rhythm = (points: number) => scaledFontSize(points, bodyFontSize / 17);
  const monoFont = Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: 'monospace',
  });

  return {
    paragraph: {
      color: palette.text,
      fontSize: bodyFontSize,
      marginTop: 0,
      marginBottom: rhythm(READING_RHYTHM.paragraphAfter),
    },
    h1: {
      color: palette.text,
      fontSize: scaledFontSize(22, bodyFontSize / 17),
      fontWeight: '600',
      marginTop: rhythm(READING_RHYTHM.majorHeadingBefore),
      marginBottom: rhythm(READING_RHYTHM.headingAfter),
    },
    h2: {
      color: palette.text,
      fontSize: scaledFontSize(20, bodyFontSize / 17),
      fontWeight: '600',
      marginTop: rhythm(READING_RHYTHM.sectionHeadingBefore),
      marginBottom: rhythm(READING_RHYTHM.headingAfter),
    },
    h3: {
      color: palette.text,
      fontSize: scaledFontSize(18, bodyFontSize / 17),
      fontWeight: '600',
      marginTop: rhythm(READING_RHYTHM.subsectionHeadingBefore),
      marginBottom: rhythm(READING_RHYTHM.subsectionHeadingAfter),
    },
    h4: {
      color: palette.text,
      fontSize: bodyFontSize,
      fontWeight: '600',
      marginTop: rhythm(READING_RHYTHM.compactHeadingBefore),
      marginBottom: rhythm(READING_RHYTHM.compactHeadingAfter),
    },
    h5: {
      color: palette.text,
      fontSize: scaledFontSize(16, bodyFontSize / 17),
      fontWeight: '600',
      marginTop: rhythm(READING_RHYTHM.tightHeadingBefore),
      marginBottom: rhythm(READING_RHYTHM.compactHeadingAfter),
    },
    h6: {
      color: palette.textSecondary,
      fontSize: scaledFontSize(15, bodyFontSize / 17),
      fontWeight: '600',
      marginTop: rhythm(READING_RHYTHM.tightHeadingBefore),
      marginBottom: rhythm(READING_RHYTHM.compactHeadingAfter),
    },
    strong: { color: palette.text, fontWeight: 'bold' },
    em: { color: palette.text, fontStyle: 'italic' },
    strikethrough: { color: palette.textSecondary },
    link: { color: palette.accent, underline: true },
    blockquote: {
      color: palette.text,
      fontSize: bodyFontSize,
      backgroundColor: palette.surface,
      borderColor: palette.border,
      borderWidth: 2,
      gapWidth: 10,
      marginBottom: rhythm(READING_RHYTHM.quoteAfter),
    },
    list: {
      color: palette.text,
      fontSize: bodyFontSize,
      bulletColor: palette.textSecondary,
      markerColor: palette.textSecondary,
      gapWidth: 7,
      marginLeft: 10,
      marginBottom: rhythm(READING_RHYTHM.listGroupAfter),
    },
    code: {
      color: palette.text,
      fontFamily: monoFont,
      fontSize: Math.max(12, bodyFontSize - 2),
      backgroundColor: palette.surfaceInset,
      borderColor: palette.border,
    },
    codeBlock: {
      color: palette.text,
      fontFamily: monoFont,
      fontSize: Math.max(12, bodyFontSize - 2),
      backgroundColor: palette.surfaceInset,
      borderColor: palette.border,
      borderWidth: 1,
      borderRadius: 11,
      padding: 10,
      marginBottom: rhythm(READING_RHYTHM.codeAfter),
    },
    thematicBreak: {
      color: palette.separator,
      height: 1,
      marginTop: rhythm(READING_RHYTHM.dividerSpacing),
      marginBottom: rhythm(READING_RHYTHM.dividerSpacing),
    },
    table: {
      color: palette.text,
      fontSize: scaledFontSize(14, fontScale),
      marginTop: rhythm(READING_RHYTHM.tableBefore),
      marginBottom: rhythm(READING_RHYTHM.tableAfter),
      borderColor: palette.border,
      borderWidth: 1,
      borderRadius: 10,
      headerBackgroundColor: palette.surface,
      headerTextColor: palette.text,
      rowEvenBackgroundColor: palette.background,
      rowOddBackgroundColor: palette.surface,
      cellPaddingHorizontal: 6,
      cellPaddingVertical: 8,
    },
    math: {
      color: palette.text,
      backgroundColor: palette.background,
      fontSize: scaledFontSize(18, bodyFontSize / 17),
      textAlign: 'center',
      marginTop: rhythm(READING_RHYTHM.displayMathBefore),
      marginBottom: rhythm(READING_RHYTHM.displayMathAfter),
    },
    inlineMath: { color: palette.text },
  };
}

export default Agent1EnrichedMarkdown;
