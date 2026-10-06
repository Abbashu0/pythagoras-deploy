import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { CHAT_QUALITY_CASES } from '../mobile/src/ai/renderer-quality-fixtures.dev';
const packageRoot = path.join(process.cwd(), 'mobile/node_modules/react-native-enriched-markdown');
const read = (file: string) => fs.readFileSync(path.join(packageRoot, file), 'utf8');
const load = createRequire(path.join(process.cwd(), 'mobile/package.json'));
const MarkdownIt = load('markdown-it');
const parser = new MarkdownIt(); // Test oracle only; production uses existing MD4C AST.

test('fenced-code fixtures retain actual source language and exact code whitespace/Unicode through library MD4C', async () => {
  const wasm = await load(path.join(packageRoot, 'src/web/wasm/md4c.js'))();
  const parseNative = wasm.cwrap('parseMarkdown', 'string', ['string', 'number', 'number', 'number', 'number', 'number']);
  type Node = { type: string; content?: string; attributes?: { language?: string }; children?: Node[] };
  const blocks = (node: Node): Node[] => node.type === 'CodeBlock' ? [node] : (node.children ?? []).flatMap(blocks);
  const raw = (node: Node): string => (node.content ?? '') + (node.children ?? []).map(raw).join('');
  const cases = CHAT_QUALITY_CASES.filter(item => /fence|code|language|block/iu.test(item.title));
  for (const fixture of cases) {
    const tokens = parser.parse(fixture.markdown, {}).filter((token: { type: string }) => token.type === 'fence');
    assert.ok(tokens.length > 0, fixture.title);
    const nativeBlocks = blocks(JSON.parse(parseNative(fixture.markdown, 0, 1, 0, 0, 0)));
    assert.equal(nativeBlocks.length, tokens.length);
    for (const [index, token] of tokens.entries()) {
      const opening = fixture.markdown.indexOf('```' + token.info);
      const start = fixture.markdown.indexOf('\n', opening) + 1;
      const end = fixture.markdown.indexOf('```', start);
      assert.equal(token.content, fixture.markdown.slice(start, end));
      // MD4C normalizes leading code tabs to four-column stops. The native Copy
      // contract is the exact AST content, not reconstruction of raw Markdown.
      const astContent = token.content.replace(/^\t+/gm, (tabs: string) => ' '.repeat(tabs.length * 4));
      assert.equal(raw(nativeBlocks[index]), astContent);
      assert.equal(nativeBlocks[index].attributes?.language ?? '', token.info);
    }
  }
  assert.ok(read('cpp/parser/MD4CParser.cpp').includes('node->setAttribute(ATTR_LANGUAGE, lang)'));
  assert.ok(read('ios/views/ENRMCodeBlockContainerView.m').includes('node.attributes[@"language"]'));
});
test('native centralized language map covers aliases and uses Plain text fallback', () => {
  const source = read('ios/utils/ENRMCodeLanguage.m');
  const aliases = Object.fromEntries([...source.matchAll(/@"([^"\n]+)": @"([^"\n]+)"/gu)].map(match => [match[1], match[2]]));
  for (const [language, label] of [['py', 'Python'], ['ts', 'TypeScript'], ['tsx', 'TypeScript'], ['js', 'JavaScript'], ['jsx', 'JavaScript'], ['json', 'JSON'], ['html', 'HTML'], ['text', 'Plain text'], ['txt', 'Plain text'], ['plaintext', 'Plain text'], ['cpp', 'C++'], ['cs', 'C#'], ['sh', 'Shell'], ['bash', 'Bash'], ['yml', 'YAML'], ['md', 'Markdown']]) assert.equal(aliases[language], label);
  assert.ok(source.includes('trimmed.length ? trimmed : @"Plain text"')); assert.ok(source.includes('controlCharacterSet')); assert.ok(source.includes('NSStringEnumerationByComposedCharacterSequences'));
});
test('code copy uses raw AST bytes and intrinsic no-wrap horizontal container sizing', () => {
  const view = read('ios/views/ENRMCodeBlockContainerView.m');
  const code = read('ios/utils/ENRMCodeLanguage.m');
  assert.ok(view.includes('copyStringToPasteboard(_rawCode)'));
  assert.equal(code.includes('stringByTrimmingCharactersInSet', code.indexOf('NSString *ENRMRawCodeContent')), false);
  for (const value of ['usedRectForTextContainer', '_documentWidth + padding * 2', '[self headerHeight] + _bodyHeight', 'NSLineBreakByClipping', '_codeView.scrollEnabled = NO', 'UISemanticContentAttributeForceLeftToRight']) assert.ok(view.includes(value));
  const long = parser.parse(CHAT_QUALITY_CASES.find(item => item.title.includes('360'))!.markdown, {})[0].content;
  assert.ok(long.split('\n')[0].length > 300);
});

test('native code card keeps a readable LTR header, continuous corners and fixed native copy geometry', () => {
  const view = read('ios/views/ENRMCodeBlockContainerView.m');
  for (const value of ['MAX(14, font.pointSize)', 'MAX(44, ceil(_language.font.lineHeight + 16))', 'configurationWithPointSize:18', 'kCACornerCurveContinuous', '_header.backgroundColor = [UIColor clearColor]', '44, MAX(44, headerHeight)', 'dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.3 * NSEC_PER_SEC))']) assert.ok(view.includes(value), value);
  const copy = view.slice(view.indexOf('- (void)copyCode'));
  assert.equal(/setNeedsLayout|\.frame\s*=/u.test(copy), false);
  const fixtures = CHAT_QUALITY_CASES.find(item => item.title.startsWith('Tabs'))!;
  const token = parser.parse(fixtures.markdown, {})[0];
  assert.ok(token.content.includes('\t\t'));
  assert.ok(token.content.includes('مرحبا 👋'));
  assert.ok(token.content.endsWith('  \n'));
});
test('mixed Arabic/Latin native ranges preserve text and protect parsed code/link/math regions', () => {
  const source = read('ios/utils/ParagraphStyleUtils.m');
  const literal = source.match(/regularExpressionWithPattern:(@".*?") options:0 error:nil/u)![1].slice(1);
  const regex = new RegExp(JSON.parse(literal), 'gu');
  const cases: [string, string[]][] = [
    ['هذا المصطلح API مهم في التطبيق.', ['API']],
    ["ينص Newton's Second Law على العلاقة التالية.", ["Newton's Second Law"]],
    ['نستخدم DNA وRNA وATP داخل الأحياء.', ['DNA', 'RNA', 'ATP']],
    ['يمكن قراءة JSON من TypeScript عبر API.', ['JSON', 'TypeScript', 'API']],
  ];
  for (const [text, expected] of cases) assert.deepEqual([...text.matchAll(regex)].map(match => match[0]), expected);
  assert.ok(source.includes('direction == NSWritingDirectionRightToLeft'));
  for (const attribute of ['CodeAttributeName', 'CodeBlockAttributeName', 'NSLinkAttributeName', 'NSAttachmentAttributeName']) assert.ok(source.includes(`attributes[${attribute}]`));
  assert.ok(source.includes('addAttribute:NSWritingDirectionAttributeName'));
  const transformation = source.slice(source.indexOf('static void ENRMApplyRTLInlineDirections'), source.indexOf('void ENRMApplyFirstStrongParagraphDirections'));
  assert.equal(/insert|replace|append/iu.test(transformation), false);
});
test('normal math alignment is preserved while wide math keeps intrinsic width and native gesture ownership', () => {
  const math = read('ios/views/ENRMMathContainerView.m');
  for (const snippet of ['return padding + (available - formulaWidth) / 2.0', '_scrollView.scrollEnabled = overflows', 'intrinsicSize.width', 'alwaysBounceVertical = NO']) assert.ok(math.includes(snippet));
  const owner = read('ios/EnrichedMarkdown.mm');
  const touch = owner.slice(owner.indexOf('touchEventEmitterAtPoint:'));
  assert.ok(touch.includes('[ENRMMathContainerView class]')); assert.ok(touch.includes('[ENRMCodeBlockContainerView class]')); assert.ok(touch.includes('[TableContainerView class]'));
});
