import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { CHAT_QUALITY_CASES, PREVIEW_HEIGHT_TAIL_FIXTURE } from '../mobile/src/ai/renderer-quality-fixtures.dev';
const packageRoot = path.join(process.cwd(), 'mobile/node_modules/react-native-enriched-markdown');
const read = (file: string) => fs.readFileSync(path.join(packageRoot, file), 'utf8');
const load = createRequire(path.join(process.cwd(), 'mobile/package.json'));
const MarkdownIt = load('markdown-it');
const parser = new MarkdownIt(); // Test oracle only; production uses existing MD4C AST.

// Execute the boolean policy expressions from the native helper against a
// controlled prop cache/live presentation. UIKit/Fabric execution needs iOS.
const measurement = read('ios/internals/ShadowMeasurementUtils.h');
function nativeCondition(marker: string, from = 0) {
  const start = measurement.indexOf(marker, from) + marker.length;
  assert.ok(start >= marker.length, marker);
  let depth = 1;
  for (let end = start; end < measurement.length; end++) {
    if (measurement[end] === '(') depth++;
    if (measurement[end] === ')' && --depth === 0) return measurement.slice(start, end);
  }
  throw new Error(`Unclosed native condition: ${marker}`);
}
function nativePolicy(expression: string, context: Record<string, unknown>) {
  return Boolean(vm.runInNewContext(expression.replace(/\bnil\b/gu, 'null').replaceAll('std::isfinite', 'Number.isFinite')
    .replaceAll('[view hasRenderedMarkdown:currentMarkdown]', 'view.matchesMarkdown')
    .replaceAll('[view hasRenderedWithStyleFingerprint:styleFingerprint]', 'view.matchesStyle')
    .replaceAll('[view hasNativePresentationGeometryOverride]', 'view.nativePresentationGeometryOverride'), context));
}
type LiveMeasurement = { height: number; matchesMarkdown: boolean; matchesStyle: boolean; nativePresentationGeometryOverride: boolean };
function nativeMeasurementOracle(cache: Map<string, number>, view: LiveMeasurement | null, receivedCounter: number,
  lastExactMeasurementCounter: number, streaming = false) {
  const key = PREVIEW_HEIGHT_TAIL_FIXTURE;
  const typedProps = { streamingAnimation: streaming, markdown: { empty: () => false } };
  const context = { typedProps, view, receivedCounter, lastExactMeasurementCounter,
    needsExactLiveMeasurement: false, nativePresentationGeometryOverride: false,
    shouldUseMeasurementCache: false, measuredLiveView: false, size: { width: 350, height: 0 } };
  context.needsExactLiveMeasurement = nativePolicy(measurement.match(/const bool needsExactLiveMeasurement = ([^;]+);/u)![1], context);
  const readOverride = nativeCondition('if (', measurement.indexOf('if (view && !typedProps.streamingAnimation'));
  if (nativePolicy(readOverride, context)) {
    context.nativePresentationGeometryOverride = nativePolicy(measurement.match(/nativePresentationGeometryOverride = (\[view [^;]+);/u)![1], context);
  }
  context.shouldUseMeasurementCache = nativePolicy(measurement.match(/const bool shouldUseMeasurementCache =\s*([^;]+);/u)![1], context);
  if (context.shouldUseMeasurementCache && cache.has(key)) return { height: cache.get(key)!, counter: lastExactMeasurementCounter, from: 'cache' };
  const usesLive = nativePolicy(nativeCondition('if (', measurement.indexOf('if (view && (')), context);
  context.measuredLiveView = usesLive;
  context.size.height = usesLive ? view!.height : 930;
  const cacheGuard = nativeCondition('if (', measurement.indexOf('  // Only source-default mocks'));
  if (nativePolicy(cacheGuard, context)) cache.set(key, context.size.height);
  const consumes = nativePolicy(nativeCondition('if (', measurement.indexOf('if (measuredLiveView && ')), context);
  return { height: context.size.height, counter: consumes ? Math.max(lastExactMeasurementCounter, receivedCounter) : lastExactMeasurementCounter,
    from: usesLive ? 'live' : 'mock' };
}

test('completed Source/Preview tail bypasses an old prop cache for each native exact height request', () => {
  const cache = new Map([[PREVIEW_HEIGHT_TAIL_FIXTURE, 930]]);
  assert.ok(PREVIEW_HEIGHT_TAIL_FIXTURE.includes('Block 9 — Unknown Language'));
  assert.ok(PREVIEW_HEIGHT_TAIL_FIXTURE.endsWith('انتهى اختبار العرض.'));
  assert.equal(parser.parse(PREVIEW_HEIGHT_TAIL_FIXTURE, {}).filter((item: { type: string }) => item.type === 'fence').length, 9);
  assert.equal(nativeMeasurementOracle(cache, null, 0, 0).from, 'cache');
  let counter = 0;
  for (const height of [1228, 930, 1526, 1228, 930]) {
    const result = nativeMeasurementOracle(cache, { height, matchesMarkdown: true, matchesStyle: true, nativePresentationGeometryOverride: height !== 930 }, counter + 1, counter);
    assert.equal(result.from, 'live'); // no source-default mock or old cached rectangle
    assert.equal(result.height, height);
    assert.equal(result.counter, ++counter);
    assert.equal(cache.get(PREVIEW_HEIGHT_TAIL_FIXTURE), 930); // presentation heights never poison prop cache
  }
  const helper = measurement.slice(measurement.indexOf('static inline Size ENRMMeasureMarkdownContent'));
  assert.equal(/\bhtml\b|\bmermaid\b|blockIndex/iu.test(helper), false);
  assert.ok(helper.indexOf('needsExactLiveMeasurement') < helper.indexOf('MeasurementCache::shared().get'));
});

test('initial mount restores Source cache, Preview stays live at the same counter, and returning Source restores cache again', () => {
  const cache = new Map([[PREVIEW_HEIGHT_TAIL_FIXTURE, 930]]);
  assert.deepEqual(nativeMeasurementOracle(cache, null, 0, 0), { height: 930, counter: 0, from: 'cache' });
  const view = { height: 930, matchesMarkdown: true, matchesStyle: true, nativePresentationGeometryOverride: false };
  const mount = nativeMeasurementOracle(cache, view, 1, 0);
  assert.deepEqual(mount, { height: 930, counter: 1, from: 'live' });
  assert.deepEqual(nativeMeasurementOracle(cache, view, 1, mount.counter), { height: 930, counter: 1, from: 'cache' });
  view.height = 1228; view.nativePresentationGeometryOverride = true;
  const exact = nativeMeasurementOracle(cache, view, 2, mount.counter);
  assert.deepEqual(exact, { height: 1228, counter: 2, from: 'live' });
  // Counter 2 is consumed; Preview geometry, not the counter, remains authoritative.
  const second = nativeMeasurementOracle(cache, view, 2, exact.counter);
  assert.deepEqual(second, { height: 1228, counter: 2, from: 'live' });
  assert.deepEqual(nativeMeasurementOracle(cache, view, 2, second.counter), second); // unrelated parent layout
  cache.delete(PREVIEW_HEIGHT_TAIL_FIXTURE);
  assert.equal(nativeMeasurementOracle(cache, null, 0, 0).from, 'mock');
  assert.equal(cache.get(PREVIEW_HEIGHT_TAIL_FIXTURE), 930); // identical source-default sibling
  assert.deepEqual(nativeMeasurementOracle(cache, view, 2, second.counter), second);
  cache.set(PREVIEW_HEIGHT_TAIL_FIXTURE, 777); // even a different prop-only entry cannot win
  assert.deepEqual(nativeMeasurementOracle(cache, view, 2, second.counter), second);
  view.height = 930; view.nativePresentationGeometryOverride = false;
  const source = nativeMeasurementOracle(cache, view, 3, second.counter);
  assert.deepEqual(source, { height: 930, counter: 3, from: 'live' });
  assert.equal(cache.get(PREVIEW_HEIGHT_TAIL_FIXTURE), 777); // neither mode writes live heights
  cache.set(PREVIEW_HEIGHT_TAIL_FIXTURE, 930); // source-default cache geometry
  assert.deepEqual(nativeMeasurementOracle(cache, view, 3, source.counter), { height: 930, counter: 3, from: 'cache' });
});

test('unavailable, mismatched or invalid live geometry does not consume the native exact request', () => {
  const cache = new Map([[PREVIEW_HEIGHT_TAIL_FIXTURE, 930]]);
  assert.equal(nativeMeasurementOracle(cache, null, 3, 0).counter, 0);
  const mismatch = nativeMeasurementOracle(cache, { height: 1228, matchesMarkdown: false, matchesStyle: true, nativePresentationGeometryOverride: true }, 3, 0);
  assert.equal(mismatch.from, 'mock'); assert.equal(mismatch.counter, 0);
  assert.equal(nativeMeasurementOracle(cache, { height: 1228, matchesMarkdown: true, matchesStyle: false, nativePresentationGeometryOverride: true }, 3, 0).counter, 0);
  assert.equal(nativeMeasurementOracle(cache, { height: NaN, matchesMarkdown: true, matchesStyle: true, nativePresentationGeometryOverride: true }, 3, 0).counter, 0);
  const ready = nativeMeasurementOracle(cache, { height: 1228, matchesMarkdown: true, matchesStyle: true, nativePresentationGeometryOverride: true }, 3, 0);
  assert.equal(ready.from, 'live'); assert.equal(ready.counter, 3);
  assert.equal(cache.get(PREVIEW_HEIGHT_TAIL_FIXTURE), 930);
});

test('ordinary mounted Source retains the cache; streaming counters and ShadowNode cloning keep their initialization', () => {
  const cache = new Map<string, number>();
  assert.equal(nativeMeasurementOracle(cache, null, 0, 0).from, 'mock');
  assert.equal(nativeMeasurementOracle(cache, null, 0, 0).from, 'cache');
  assert.equal(nativeMeasurementOracle(cache, null, 5, 0, true).counter, 0);
  const live = { height: 930, matchesMarkdown: true, matchesStyle: true, nativePresentationGeometryOverride: false };
  assert.equal(nativeMeasurementOracle(cache, live, 1, 0).from, 'live'); // normal first state attachment
  assert.equal(nativeMeasurementOracle(cache, live, 1, 1).from, 'cache'); // consumed ordinary mount
  const emptyCache = new Map<string, number>();
  assert.equal(nativeMeasurementOracle(emptyCache, live, 1, 1).from, 'live');
  assert.equal(emptyCache.size, 0); // even ordinary live sizes are not written to the prop cache
  assert.equal(nativeMeasurementOracle(cache, live, 0, -1, true).counter, 0);
  live.nativePresentationGeometryOverride = true;
  assert.equal(nativeMeasurementOracle(cache, live, 2, 1, true).from, 'live'); // streaming still cannot read the prop cache
  for (const stem of ['EnrichedMarkdownShadowNode', 'EnrichedMarkdownTextShadowNode']) {
    const header = read(`ios/internals/${stem}.h`), source = read(`ios/internals/${stem}.mm`);
    assert.ok(header.includes('localHeightRecalculationCounter_{0}'));
    assert.ok(header.includes('lastExactMeasurementCounter_{0}'));
    assert.ok(source.includes(`static_cast<const ${stem} &>(sourceShadowNode).lastExactMeasurementCounter_`));
    assert.ok(source.includes('lastExactMeasurementCounter_ = -1'));
  }
  for (const stem of ['EnrichedMarkdownState', 'EnrichedMarkdownTextState']) {
    const state = read(`ios/internals/${stem}.h`);
    assert.ok(state.includes('counter_{0}'));
    assert.ok(state.includes('getHeightRecalculationCounter() const'));
  }
  assert.ok(measurement.includes('typedProps.streamingAnimation && view && receivedCounter <= lastExactMeasurementCounter'));
});

test('native geometry override is current segment state, read on main, not initial-mount counter authority', () => {
  const semanticBody = (file: string) => {
    const match = read(file).match(/- \(BOOL\)hasNativePresentationGeometryOverride\s*\{([\s\S]*?)\n\}/u);
    assert.ok(match, file);
    return match[1];
  };
  assert.equal(semanticBody('ios/views/ENRMCodeBlockContainerView.m').trim(), 'return _previewing;');
  assert.equal(semanticBody('ios/EnrichedMarkdownText.mm').trim(), 'return NO;');
  const owner = semanticBody('ios/EnrichedMarkdown.mm');
  for (const value of ['for (RCTUIView *segment in _segmentViews)', 'respondsToSelector:@selector(hasNativePresentationGeometryOverride)', '[(id)segment hasNativePresentationGeometryOverride]', 'return YES;', 'return NO;']) assert.ok(owner.includes(value));
  assert.equal(/ENRMCodeBlockContainerView|\bhtml\b|\bmermaid\b|blockIndex|Counter/u.test(owner.replace('// Query current mounted segments, not a sticky counter or a code language.', '')), false);
  for (const stem of ['EnrichedMarkdown', 'EnrichedMarkdownText']) {
    assert.ok(read(`ios/${stem}.h`).includes('- (BOOL)hasNativePresentationGeometryOverride;'));
    assert.ok(read(`ios/${stem}.mm`).includes('if (oldState == nullptr) {\n    [self requestHeightUpdate];'));
  }
  assert.ok(read('ios/views/ENRMCodeBlockContainerView.h').includes('- (BOOL)hasNativePresentationGeometryOverride;'));
  const query = measurement.slice(measurement.indexOf('if (view && !typedProps.streamingAnimation'), measurement.indexOf('  const bool shouldUseMeasurementCache'));
  for (const value of ['!needsExactLiveMeasurement', '[view hasNativePresentationGeometryOverride]', '[NSThread isMainThread]', 'readNativePresentationGeometry();', 'dispatch_sync(dispatch_get_main_queue(), readNativePresentationGeometry)']) assert.ok(query.includes(value));
  assert.ok(measurement.indexOf('[view hasNativePresentationGeometryOverride]') < measurement.indexOf('MeasurementCache::shared().get'));
  assert.equal(measurement.includes('receivedCounter > 0'), false);
  assert.equal(measurement.includes('nativePresentationIsAuthoritative'), false);
});

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
  const labels = source.slice(source.indexOf('labels = @{'), source.indexOf('NSString *ENRMCodeHighlightLanguage'));
  const aliases = Object.fromEntries([...labels.matchAll(/@"([^"\n]+)": @"([^"\n]+)"/gu)].map(match => [match[1], match[2]]));
  for (const [language, label] of [['py', 'Python'], ['ts', 'TypeScript'], ['tsx', 'TypeScript'], ['js', 'JavaScript'], ['jsx', 'JavaScript'], ['json', 'JSON'], ['html', 'HTML'], ['text', 'Plain text'], ['txt', 'Plain text'], ['plaintext', 'Plain text'], ['cpp', 'C++'], ['cs', 'C#'], ['sh', 'Shell'], ['bash', 'Bash'], ['yml', 'YAML'], ['md', 'Markdown']]) assert.equal(aliases[language], label);
  assert.ok(source.includes('trimmed.length ? trimmed : @"Plain text"')); assert.ok(source.includes('controlCharacterSet')); assert.ok(source.includes('NSStringEnumerationByComposedCharacterSequences'));
});
test('code copy uses raw AST bytes and intrinsic no-wrap horizontal container sizing', () => {
  const view = read('ios/views/ENRMCodeBlockContainerView.m');
  const code = read('ios/utils/ENRMCodeLanguage.m');
  assert.ok(view.includes('copyStringToPasteboard(_rawCode)'));
  assert.equal(code.includes('stringByTrimmingCharactersInSet', code.indexOf('NSString *ENRMRawCodeContent')), false);
  for (const value of ['usedRectForTextContainer', '_documentWidth + padding * 2', '[self headerHeight] + [self visibleBodyHeightForWidth:width]', 'return _previewing ? cap : MIN(_bodyHeight, cap)', 'NSLineBreakByClipping', '_codeView.scrollEnabled = NO', 'UISemanticContentAttributeForceLeftToRight']) assert.ok(view.includes(value));
  const long = parser.parse(CHAT_QUALITY_CASES.find(item => item.title.includes('360'))!.markdown, {})[0].content;
  assert.ok(long.split('\n')[0].length > 300);
});

test('native code card keeps a readable LTR header, continuous corners and fixed native copy geometry', () => {
  const view = read('ios/views/ENRMCodeBlockContainerView.m');
  const header = read('ios/views/ENRMCodeBlockContainerView.h');
  const owner = read('ios/EnrichedMarkdown.mm');
  assert.ok(header.includes('NSString *menuCopyLabel;'));
  assert.equal(header.includes('NSString *copyLabel;'), false);
  assert.ok(view.includes('self.menuCopyLabel'));
  assert.ok(owner.includes('view.menuCopyLabel = owner->_selectionMenuLabels.copyLabel'));
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
