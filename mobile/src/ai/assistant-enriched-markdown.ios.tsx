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
import {
  prepareEnrichedMarkdownInput,
  resolveEnrichedMarkdownFlavor,
} from './rich-response/enriched-markdown-input';
import { usePreferences } from '@/preferences/preferences-provider';

interface Agent1EnrichedMarkdownProps {
  messageId: string;
  content: string;
  streaming: boolean;
  contentWidth: number;
  palette: Palette;
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
}: Agent1EnrichedMarkdownProps) {
  const { fontScale } = usePreferences();
  const bodyFontSize = scaledFontSize(17, fontScale);
  const markdownStyle = useMemo(
    () => createMarkdownStyle(palette, bodyFontSize),
    [bodyFontSize, palette],
  );
  const markdown = useMemo(() => {
    const stablePrefix = streaming
      ? hideUnclosedMathSuffix(sealIncompleteMarkdown(content))
      : content;
    return prepareEnrichedMarkdownInput(stablePrefix);
  }, [content, streaming]);
  const markdownFlavor = resolveEnrichedMarkdownFlavor(markdown);
  const lastDiagnosticRef = useRef('');
  useEffect(() => {
    if (!__DEV__ || streaming) return;
    const diagnosticKey = `${messageId}:${content.length}:${markdown.length}:${contentWidth}`;
    if (lastDiagnosticRef.current === diagnosticKey) return;
    lastDiagnosticRef.current = diagnosticKey;
    console.info('[Agent1 renderer diagnostics] completed response', {
      messageId,
      sourceCharacters: content.length,
      presentationCharacters: markdown.length,
      contentWidth,
      flavor: markdownFlavor,
    });
  }, [content.length, contentWidth, markdown.length, markdownFlavor, messageId, streaming]);
  const handleLinkPress = useCallback(({ url }: { url: string }) => {
    if (!isSafeAgent1Link(url)) return;
    void Linking.openURL(url).catch(() => undefined);
  }, []);
  const handleNativeLayout = useCallback((event: LayoutChangeEvent) => {
    if (!__DEV__) return;
    const { width, height } = event.nativeEvent.layout;
    console.info('[Agent1 renderer diagnostics] native layout', {
      messageId,
      width,
      height,
      flavor: markdownFlavor,
    });
  }, [markdownFlavor, messageId]);

  if (contentWidth <= 0 || markdown.length === 0) return null;

  return (
    <EnrichedMarkdownText
      onLayout={handleNativeLayout}
      markdown={markdown}
      markdownStyle={markdownStyle}
      containerStyle={{ width: contentWidth, alignSelf: 'stretch' }}
      writingDirection="first-strong"
      flavor={markdownFlavor}
      md4cFlags={MARKDOWN_FLAGS}
      onLinkPress={handleLinkPress}
      enableLinkPreview={false}
      selectionMenuConfig={SELECTION_MENU_CONFIG}
      allowTrailingMargin={false}
    />
  );
});

function createMarkdownStyle(palette: Palette, bodyFontSize: number): MarkdownStyle {
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
      marginBottom: scaledFontSize(10, bodyFontSize / 17),
    },
    h1: {
      color: palette.text,
      fontSize: scaledFontSize(22, bodyFontSize / 17),
      fontWeight: '600',
      marginTop: 9,
      marginBottom: 5,
    },
    h2: {
      color: palette.text,
      fontSize: scaledFontSize(20, bodyFontSize / 17),
      fontWeight: '600',
      marginTop: 8,
      marginBottom: 4,
    },
    h3: {
      color: palette.text,
      fontSize: scaledFontSize(18, bodyFontSize / 17),
      fontWeight: '600',
      marginTop: 7,
      marginBottom: 3,
    },
    h4: {
      color: palette.text,
      fontSize: bodyFontSize,
      fontWeight: '600',
      marginTop: 6,
      marginBottom: 3,
    },
    h5: {
      color: palette.text,
      fontSize: scaledFontSize(16, bodyFontSize / 17),
      fontWeight: '600',
      marginTop: 5,
      marginBottom: 2,
    },
    h6: {
      color: palette.textSecondary,
      fontSize: scaledFontSize(15, bodyFontSize / 17),
      fontWeight: '600',
      marginTop: 5,
      marginBottom: 2,
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
      marginBottom: 10,
    },
    list: {
      color: palette.text,
      fontSize: bodyFontSize,
      bulletColor: palette.textSecondary,
      markerColor: palette.textSecondary,
      gapWidth: 7,
      marginLeft: 10,
      marginBottom: 5,
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
      marginBottom: 10,
    },
    thematicBreak: {
      color: palette.separator,
      height: 1,
      marginTop: 9,
      marginBottom: 9,
    },
    table: {
      color: palette.text,
      fontSize: Math.max(13, bodyFontSize - 1),
      borderColor: palette.border,
      borderWidth: 1,
      borderRadius: 10,
      headerBackgroundColor: palette.surface,
      headerTextColor: palette.text,
      rowEvenBackgroundColor: palette.background,
      rowOddBackgroundColor: palette.surface,
      cellPaddingHorizontal: 9,
      cellPaddingVertical: 8,
    },
    math: {
      color: palette.text,
      backgroundColor: palette.background,
      fontSize: scaledFontSize(18, bodyFontSize / 17),
      textAlign: 'center',
      marginTop: 4,
      marginBottom: 8,
    },
    inlineMath: { color: palette.text },
  };
}

export default Agent1EnrichedMarkdown;
