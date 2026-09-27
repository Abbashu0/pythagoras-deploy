import React, { memo, useMemo, type ComponentType, type ReactNode } from 'react';
import AstRenderer from '@ronradtke/react-native-markdown-display/dist/lib/view/AstRenderer';
import { createMarkdownIt } from '@ronradtke/react-native-markdown-display/dist/lib/view/createMarkdownIt';
import markdownParser from '@ronradtke/react-native-markdown-display/dist/lib/view/parser';
import removeTextStyleProps from '@ronradtke/react-native-markdown-display/dist/lib/view/util/removeTextStyleProps';
import { sealIncompleteMarkdown } from '@ronradtke/react-native-markdown-display/dist/lib/view/util/sealIncompleteMarkdown';
import type {
  ASTNode,
  MarkdownItPlugin,
  MarkdownStyleMap,
  RenderRules,
} from '@ronradtke/react-native-markdown-display';
import { RNHostView } from '@expo/ui/swift-ui';
import { Linking, Platform, ScrollView, StyleSheet, Text, View, type TextProps, type TextStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';

import type { Palette } from '@/theme';
import { scaledFontSize, scaledLineHeight } from '@/theme';
import { usePreferences } from '@/preferences/preferences-provider';
import { hideUnclosedMathSuffix } from './rich-response/math-delimiters';
import { agent1MathMarkdownPlugin, isSafeAgent1Link } from './rich-response/math-markdown-plugin';
import { getInlineMathAttachmentMetrics, renderTexToSvg } from './rich-response/mathjax-svg';
import { stabilizeNodeKey } from './rich-response/stable-markdown-keys';
import {
  firstStrongTextDirection,
  resolveDirectionalListFlow,
  resolveDirectionalTextStyle,
  textFromDirectionNodes,
} from './rich-response/text-direction';

interface AssistantRichRendererProps {
  messageId: string;
  content: string;
  streaming: boolean;
  contentWidth: number;
  palette: Palette;
}

interface MathTokenMeta {
  display?: boolean;
  raw?: string;
}

const BLOCK_STYLE_KEYS = [
  'body', 'heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6', 'hr',
  'strong', 'em', 'ins', 's', 'blockquote', 'bullet_list', 'ordered_list', 'list_item',
  'bullet_list_icon', 'ordered_list_icon', 'bullet_list_content', 'ordered_list_content',
  'code_inline', 'code_block', 'fence', 'fence_header', 'fence_language_label', 'fence_code',
  'fence_token', 'table', 'thead', 'tbody', 'th', 'tr', 'td', 'link', 'blocklink', 'image',
  'text', 'textgroup', 'paragraph', 'hardbreak', 'softbreak', 'pre', 'inline', 'span',
] as const;

const SelectableText: ComponentType<TextProps> = function SelectableMarkdownText(props) {
  return <Text {...props} selectable />;
};

const Agent1AssistantMarkdown = memo(function Agent1AssistantMarkdown({
  messageId,
  content,
  streaming,
  contentWidth,
  palette,
}: AssistantRichRendererProps) {
  const { fontScale } = usePreferences();
  const bodyFontSize = scaledFontSize(17, fontScale);
  const bodyLineHeight = scaledLineHeight(17, fontScale, 1.45);
  const styleMap = useMemo(
    () => createMarkdownStyles(palette, bodyFontSize, bodyLineHeight),
    [bodyFontSize, bodyLineHeight, palette],
  );
  const parser = useMemo(
    () => {
      const instance = createMarkdownIt({
        typographer: false,
        plugins: [agent1MathMarkdownPlugin as MarkdownItPlugin],
      }).set({
        html: false,
        linkify: false,
        breaks: false,
      });
      instance.validateLink = isSafeAgent1Link;
      return instance;
    },
    [],
  );
  const renderer = useMemo(
    () =>
      createAssistantAstRenderer({
        messageId,
        palette,
        styleMap,
        contentWidth,
        fontScale,
      }),
    [contentWidth, fontScale, messageId, palette, styleMap],
  );

  const visibleContent = streaming
    ? hideUnclosedMathSuffix(sealIncompleteMarkdown(content))
    : content;

  if (contentWidth <= 0) return null;
  const parsedResponse = markdownParser(visibleContent, renderer.render, parser);

  return (
    <RNHostView matchContents>
      {/* Keep the bridge's physical layout LTR; prose direction is resolved per inline/text boundary below. */}
      <View style={{ width: contentWidth, alignSelf: 'stretch', direction: 'ltr' }}>
        {parsedResponse}
      </View>
    </RNHostView>
  );
});

function createMarkdownStyles(
  palette: Palette,
  bodyFontSize: number,
  bodyLineHeight: number,
): MarkdownStyleMap {
  const monoFont = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });
  return {
    body: { width: '100%' },
    heading1: { color: palette.text, fontSize: scaleFont(22, bodyFontSize), fontWeight: '600', marginTop: 9, marginBottom: 5, width: '100%' },
    heading2: { color: palette.text, fontSize: scaleFont(20, bodyFontSize), fontWeight: '600', marginTop: 8, marginBottom: 4, width: '100%' },
    heading3: { color: palette.text, fontSize: scaleFont(18, bodyFontSize), fontWeight: '600', marginTop: 7, marginBottom: 3, width: '100%' },
    heading4: { color: palette.text, fontSize: scaleFont(17, bodyFontSize), fontWeight: '600', marginTop: 6, marginBottom: 3, width: '100%' },
    heading5: { color: palette.text, fontSize: scaleFont(16, bodyFontSize), fontWeight: '600', marginTop: 5, marginBottom: 2, width: '100%' },
    heading6: { color: palette.textSecondary, fontSize: scaleFont(15, bodyFontSize), fontWeight: '600', marginTop: 5, marginBottom: 2, width: '100%' },
    hr: { backgroundColor: palette.separator, height: StyleSheet.hairlineWidth, marginVertical: 9, width: '100%' },
    strong: { fontWeight: '700', color: palette.text },
    em: { fontStyle: 'italic' },
    ins: { textDecorationLine: 'underline' },
    s: { textDecorationLine: 'line-through' },
    blockquote: { backgroundColor: palette.surface, borderColor: palette.border, paddingHorizontal: 12, paddingVertical: 3, width: '100%' },
    bullet_list: { width: '100%' },
    ordered_list: { width: '100%' },
    list_item: { width: '100%', marginVertical: 2 },
    bullet_list_icon: { color: palette.textSecondary },
    ordered_list_icon: { color: palette.textSecondary },
    bullet_list_content: { flex: 1 },
    ordered_list_content: { flex: 1 },
    code_inline: { color: palette.text, backgroundColor: palette.surfaceInset, borderColor: palette.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: 5, paddingHorizontal: 4, fontFamily: monoFont, fontSize: Math.max(12, bodyFontSize - 2), writingDirection: 'ltr', textAlign: 'left' },
    code_block: { color: palette.text, backgroundColor: palette.surfaceInset, borderColor: palette.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: 11, padding: 10, fontFamily: monoFont, writingDirection: 'ltr', textAlign: 'left' },
    fence: { backgroundColor: palette.surfaceInset, borderColor: palette.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: 11, overflow: 'hidden', width: '100%' },
    fence_header: { paddingHorizontal: 10, paddingVertical: 5, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border },
    fence_language_label: { color: palette.textSecondary, fontSize: Math.max(11, bodyFontSize - 5), fontFamily: monoFont, writingDirection: 'ltr', textAlign: 'left' },
    fence_code: { backgroundColor: palette.surfaceInset, padding: 10 },
    fence_token: { color: palette.text, fontSize: Math.max(12, bodyFontSize - 2), lineHeight: scaledLineHeight(Math.max(12, bodyFontSize - 2), 1, 1.45), fontFamily: monoFont, writingDirection: 'ltr', textAlign: 'left' },
    table: { borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border, borderRadius: 10, overflow: 'hidden', alignSelf: 'flex-start' },
    thead: { backgroundColor: palette.surface },
    tbody: {},
    th: { minWidth: 96, maxWidth: 220, flexBasis: 112, flexGrow: 1, flexShrink: 1, paddingHorizontal: 9, paddingVertical: 8, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: palette.border },
    tr: { flexDirection: 'row', alignItems: 'stretch' },
    td: { minWidth: 96, maxWidth: 220, flexBasis: 112, flexGrow: 1, flexShrink: 1, paddingHorizontal: 9, paddingVertical: 8, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: palette.border },
    link: { color: palette.accent, textDecorationLine: 'underline' },
    blocklink: { width: '100%' },
    image: { display: 'none' },
    text: { color: palette.text, fontSize: bodyFontSize, lineHeight: bodyLineHeight },
    textgroup: { color: palette.text, fontSize: bodyFontSize, lineHeight: bodyLineHeight, flexShrink: 1 },
    paragraph: { marginTop: 0, marginBottom: 10, width: '100%' },
    hardbreak: { color: palette.text },
    softbreak: { color: palette.text },
    pre: { width: '100%' },
    inline: { width: '100%' },
    span: { color: palette.text },
  };
}

function createAssistantAstRenderer({
  messageId,
  palette,
  styleMap,
  contentWidth,
  fontScale,
}: {
  messageId: string;
  palette: Palette;
  styleMap: MarkdownStyleMap;
  contentWidth: number;
  fontScale: number;
}): AstRenderer {
  const styleSheet = StyleSheet.create(styleMap as never) as MarkdownStyleMap;
  const normalizedStyles = { ...styleSheet } as MarkdownStyleMap;
  for (const key of BLOCK_STYLE_KEYS) {
    normalizedStyles[`_VIEW_SAFE_${key}`] = removeTextStyleProps(
      StyleSheet.flatten(styleSheet[key]) ?? {},
    );
  }

  const rules = createAssistantRules(palette, normalizedStyles, contentWidth, fontScale);
  return new StableAssistantAstRenderer(messageId, rules, normalizedStyles);
}

function createAssistantRules(
  palette: Palette,
  styles: MarkdownStyleMap,
  contentWidth: number,
  fontScale: number,
): RenderRules {
  const rules: RenderRules = {
    unknown: () => null,
    body: (node, children, _parents, map) => <View key={node.key} style={map._VIEW_SAFE_body}>{children}</View>,
    heading1: (node, children, _parents, map) => <View key={node.key} style={map._VIEW_SAFE_heading1}>{children}</View>,
    heading2: (node, children, _parents, map) => <View key={node.key} style={map._VIEW_SAFE_heading2}>{children}</View>,
    heading3: (node, children, _parents, map) => <View key={node.key} style={map._VIEW_SAFE_heading3}>{children}</View>,
    heading4: (node, children, _parents, map) => <View key={node.key} style={map._VIEW_SAFE_heading4}>{children}</View>,
    heading5: (node, children, _parents, map) => <View key={node.key} style={map._VIEW_SAFE_heading5}>{children}</View>,
    heading6: (node, children, _parents, map) => <View key={node.key} style={map._VIEW_SAFE_heading6}>{children}</View>,
    hr: (node, _children, _parents, map) => <View key={node.key} style={map._VIEW_SAFE_hr} />,
    blockquote: (node, children, parents, map) => renderBlockquote(node, children, parents, map, palette),
    bullet_list: (node, children, _parents, map) => <View key={node.key} style={map._VIEW_SAFE_bullet_list}>{children}</View>,
    ordered_list: (node, children, _parents, map) => <View key={node.key} style={map._VIEW_SAFE_ordered_list}>{children}</View>,
    list_item: (node, children, parents) => renderListItem(node, children, parents, palette),
    strong: (node, children, _parents, map, inherited) => renderFormattedInline(node, children, map.strong, inherited),
    em: (node, children, _parents, map, inherited) => renderFormattedInline(node, children, map.em, inherited),
    s: (node, children, _parents, map, inherited) => renderFormattedInline(node, children, map.s, inherited),
    ins: (node, children, _parents, map, inherited) => renderFormattedInline(node, children, map.ins, inherited),
    code_inline: (node, _children, _parents, map, inherited) => (
      <SelectableText key={node.key} style={[inherited as TextStyle, map.code_inline]}>
        {node.content}
      </SelectableText>
    ),
    code_block: (node) => renderCodeBlock(node, palette, fontScale),
    fence: (node) => renderCodeBlock(node, palette, fontScale),
    table: (node, children, _parents, map) => (
      <ScrollView
        key={node.key}
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        style={{ width: contentWidth, maxWidth: '100%' }}
        contentContainerStyle={{ alignItems: 'flex-start', direction: 'ltr' }}
      >
        <View style={map._VIEW_SAFE_table}>{children}</View>
      </ScrollView>
    ),
    thead: (node, children, _parents, map) => <View key={node.key} style={map._VIEW_SAFE_thead}>{children}</View>,
    tbody: (node, children, _parents, map) => <View key={node.key} style={map._VIEW_SAFE_tbody}>{children}</View>,
    tr: (node, children, _parents, map) => <View key={node.key} style={map._VIEW_SAFE_tr}>{children}</View>,
    th: (node, children, _parents, map) => <View key={node.key} style={map._VIEW_SAFE_th}>{children}</View>,
    td: (node, children, _parents, map) => <View key={node.key} style={map._VIEW_SAFE_td}>{children}</View>,
    link: (node, children, parents, map) => (
      <SelectableText
        key={node.key}
        accessibilityRole="link"
        onPress={() => safeOpenLink(node.attributes.href)}
        style={[map.link, inheritedTextStyle(parents, map)]}
      >
        {children}
      </SelectableText>
    ),
    blocklink: () => null,
    image: () => null,
    text: (node, _children, _parents, map, inherited) => (
      <SelectableText key={node.key} style={[inherited as TextStyle, map.text]}>{node.content}</SelectableText>
    ),
    textgroup: (node, children, parents, map) => (
      <SelectableText key={node.key} style={[map.textgroup, inheritedTextStyle(parents, map)]}>
        {children}
      </SelectableText>
    ),
    paragraph: (node, children, _parents, map) => (
      <View key={node.key} style={[map._VIEW_SAFE_paragraph, { width: '100%' }]}>{children}</View>
    ),
    hardbreak: (node, _children, _parents, map) => <SelectableText key={node.key} style={map.hardbreak}>{'\n'}</SelectableText>,
    softbreak: (node, _children, _parents, map) => <SelectableText key={node.key} style={map.softbreak}>{'\n'}</SelectableText>,
    pre: (node, children, _parents, map) => <View key={node.key} style={map._VIEW_SAFE_pre}>{children}</View>,
    inline: (node, children, parents, map) => renderDirectionalInline(node, children, parents, map, palette),
    span: (node, children, _parents, map) => <SelectableText key={node.key} style={map.span}>{children}</SelectableText>,
    agent1_math_inline: (node) => renderMathNode(node, false, contentWidth, fontScale, palette),
    agent1_math_block: (node) => renderMathNode(node, true, contentWidth, fontScale, palette),
  };
  return rules;
}

function renderDirectionalInline(
  node: ASTNode,
  children: ReactNode[],
  parents: ASTNode[],
  styles: MarkdownStyleMap,
  palette: Palette,
): ReactNode {
  const direction = firstStrongTextDirection(textFromDirectionNodes(node));
  const inherited = inheritedTextStyle(parents, styles);
  const directionalStyle = resolveDirectionalTextStyle(direction);

  // Keep the whole prose run in one native Text paragraph; Fabric lays inline Views as text attachments.
  return (
    <SelectableText
      key={node.key}
      style={[
        StyleSheet.flatten(styles.text),
        inherited,
        {
          color: palette.text,
          ...directionalStyle,
          width: '100%',
        },
      ]}
    >
      {children}
    </SelectableText>
  );
}

function inheritedTextStyle(parents: ASTNode[], styles: MarkdownStyleMap): TextStyle {
  const textStyleKeys = new Set([
    'color', 'fontFamily', 'fontSize', 'fontStyle', 'fontVariant', 'fontWeight', 'letterSpacing',
    'lineHeight', 'textAlign', 'textDecorationColor', 'textDecorationLine', 'textDecorationStyle',
    'textTransform', 'writingDirection',
  ]);
  const result: Record<string, unknown> = {};

  for (let index = parents.length - 1; index >= 0; index -= 1) {
    const node = parents[index];
    if (!node) continue;
    const style = StyleSheet.flatten(styles[node.type]);
    if (!style) continue;
    for (const [key, value] of Object.entries(style)) {
      if (textStyleKeys.has(key)) result[key] = value;
    }
  }

  return result as TextStyle;
}

function renderBlockquote(
  node: ASTNode,
  children: ReactNode[],
  _parents: ASTNode[],
  styles: MarkdownStyleMap,
  palette: Palette,
): ReactNode {
  const direction = firstStrongTextDirection(textFromDirectionNodes(node));
  return (
    <View
      key={node.key}
      style={[
        styles._VIEW_SAFE_blockquote,
        {
          borderLeftWidth: direction === 'rtl' ? 0 : 2,
          borderRightWidth: direction === 'rtl' ? 2 : 0,
          borderLeftColor: palette.border,
          borderRightColor: palette.border,
          width: '100%',
        },
      ]}
    >
      {children}
    </View>
  );
}

function renderListItem(
  node: ASTNode,
  children: ReactNode[],
  parents: ASTNode[],
  palette: Palette,
): ReactNode {
  const direction = firstStrongTextDirection(textFromDirectionNodes(node));
  const list = [...parents].reverse().find((parent) => parent.type === 'ordered_list' || parent.type === 'bullet_list');
  const isOrdered = list?.type === 'ordered_list';
  const start = Number(list?.attributes.start ?? '1');
  const marker = isOrdered ? `${Number.isFinite(start) ? start + node.index : node.index + 1}.` : '•';
  return (
    <View
      key={node.key}
      style={{
        alignItems: 'flex-start',
        ...resolveDirectionalListFlow(direction),
        marginVertical: 2,
        width: '100%',
      }}
    >
      <Text style={{ color: palette.textSecondary, minWidth: 24, textAlign: 'center', writingDirection: 'ltr' }}>{marker}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
    </View>
  );
}

function renderMathNode(
  node: ASTNode,
  display: boolean,
  contentWidth: number,
  fontScale: number,
  palette: Palette,
): ReactNode {
  const meta = (node.sourceMeta ?? {}) as MathTokenMeta;
  return (
    <MathFormula
      key={node.key}
      content={node.content}
      display={display || meta.display === true}
      raw={meta.raw ?? node.content}
      width={contentWidth}
      fontScale={fontScale}
      color={palette.text}
      fallbackColor={palette.textSecondary}
    />
  );
}

function MathFormula({
  content,
  display,
  raw,
  width,
  fontScale,
  color,
  fallbackColor,
}: {
  content: string;
  display: boolean;
  raw: string;
  width: number;
  fontScale: number;
  color: string;
  fallbackColor: string;
}) {
  const payload = useMemo(() => renderTexToSvg(content, display), [content, display]);
  const fontSize = scaledFontSize(17, fontScale);
  const inlineMetrics = payload ? getInlineMathAttachmentMetrics(payload, fontSize) : null;
  const formulaWidth = inlineMetrics?.width ?? 0;
  const formulaHeight = inlineMetrics?.svgHeight ?? 0;
  const fitsSafetyBounds =
    formulaWidth <= Math.max(1_024, width * 6) && formulaHeight <= Math.max(768, fontSize * 40);
  const svg = payload && fitsSafetyBounds ? colorizeSvg(payload.svg, color) : null;

  if (!payload || !svg || !fitsSafetyBounds) {
    return (
      <Text
        selectable
        style={{ color: fallbackColor, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: Math.max(12, fontSize - 2), textAlign: 'left', writingDirection: 'ltr' }}
      >
        {raw}
      </Text>
    );
  }

  // A single measured View child becomes an inline attachment in RN 0.86 iOS Text layout.
  const inlineAttachment = inlineMetrics ? (
    <View
      style={{
        direction: 'ltr',
        height: inlineMetrics.attachmentHeight,
        overflow: 'visible',
        width: inlineMetrics.width,
      }}
    >
      <View
        style={{
          height: inlineMetrics.svgHeight,
          transform: [{ translateY: inlineMetrics.translateY }],
          width: inlineMetrics.width,
        }}
      >
        <SvgXml xml={svg} width={inlineMetrics.width} height={inlineMetrics.svgHeight} />
      </View>
    </View>
  ) : null;

  if (!display && formulaWidth <= width) return inlineAttachment;

  const scrollWidth = display ? width : Math.min(width, Math.max(1, formulaWidth));
  const contentMinimumWidth = display ? width : undefined;
  const displayedSvg = display ? (
    <SvgXml
      xml={svg}
      width={formulaWidth}
      height={formulaHeight}
      color={color}
      fill={color}
      stroke={color}
    />
  ) : inlineAttachment;

  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={display}
      style={{
        alignSelf: display ? 'center' : 'auto',
        direction: 'ltr',
        height: display ? formulaHeight + 8 : inlineMetrics?.attachmentHeight ?? formulaHeight,
        maxWidth: width,
        width: scrollWidth,
      }}
      contentContainerStyle={{
        alignItems: 'center',
        direction: 'ltr',
        justifyContent: formulaWidth <= width ? 'center' : 'flex-start',
        minWidth: contentMinimumWidth,
        paddingHorizontal: display ? 6 : 0,
        paddingVertical: display ? 4 : 0,
      }}
    >
      {display ? <View style={{ justifyContent: 'center', height: formulaHeight }}>{displayedSvg}</View> : displayedSvg}
    </ScrollView>
  );
}

function renderCodeBlock(node: ASTNode, palette: Palette, fontScale: number): ReactNode {
  const language = typeof node.sourceInfo === 'string' ? node.sourceInfo.trim().split(/\s+/u)[0] : '';
  const code = node.content.endsWith('\n') ? node.content.slice(0, -1) : node.content;
  const fontSize = Math.max(12, scaledFontSize(15, fontScale));
  return (
    <View
      key={node.key}
      style={{
        backgroundColor: palette.surfaceInset,
        borderColor: palette.border,
        borderRadius: 11,
        borderWidth: StyleSheet.hairlineWidth,
        marginVertical: 5,
        overflow: 'hidden',
        width: '100%',
      }}
    >
      {language ? (
        <Text style={{ borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth, color: palette.textSecondary, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: Math.max(11, fontSize - 3), paddingHorizontal: 10, paddingVertical: 6, textAlign: 'left', writingDirection: 'ltr' }}>
          {language}
        </Text>
      ) : null}
      <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator>
        <Text
          selectable
          style={{ color: palette.text, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize, lineHeight: scaledLineHeight(fontSize, 1, 1.45), padding: 10, textAlign: 'left', writingDirection: 'ltr' }}
        >
          {code}
        </Text>
      </ScrollView>
    </View>
  );
}

function safeOpenLink(url: string | undefined): void {
  if (!url || !isSafeAgent1Link(url)) return;
  void Linking.openURL(url).catch(() => undefined);
}

function colorizeSvg(svg: string, color: string): string {
  const safeColor = /^#[0-9a-f]{3,8}$/iu.test(color) ? color : '#000000';
  return svg.replace(/currentColor/giu, safeColor);
}

function renderFormattedInline(
  node: ASTNode,
  children: ReactNode[],
  style: unknown,
  inheritedStyles: unknown,
): ReactNode {
  return (
    <SelectableText key={node.key} style={[inheritedStyles as never, style as never]}>
      {children}
    </SelectableText>
  );
}

function scaleFont(baseSize: number, bodyFontSize: number): number {
  return Math.round((baseSize * bodyFontSize) / 17);
}

class StableAssistantAstRenderer extends AstRenderer {
  constructor(
    private readonly messageId: string,
    rules: RenderRules,
    styles: MarkdownStyleMap,
  ) {
    super(rules, styles, undefined, null, null, [], null, false, undefined, undefined);
  }

  override render = (nodes: readonly ASTNode[]): ReactNode => {
    const root: ASTNode = {
      type: 'body',
      sourceType: 'body',
      sourceInfo: null,
      sourceMeta: null,
      block: true,
      key: `${this.messageId}:body`,
      content: '',
      markup: '',
      tokenIndex: -1,
      index: 0,
      attributes: {},
      children: nodes.map((node, index) => stabilizeNodeKey(node, this.messageId, [index])),
    };
    return this.renderNode(root, [], true);
  };
}

export default Agent1AssistantMarkdown;
