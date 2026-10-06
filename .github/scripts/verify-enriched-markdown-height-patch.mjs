import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const packageRoot = path.join(root, 'mobile/node_modules/react-native-enriched-markdown');
const sourcePath = path.join(packageRoot, 'ios/EnrichedMarkdown.mm');
const tableSourcePath = path.join(packageRoot, 'ios/views/TableContainerView.m');
const patchPath = path.join(root, 'mobile/patches/react-native-enriched-markdown+0.7.4.patch');

function fail(message) {
  console.error(`Native enriched-markdown patch validation failed: ${message}`);
  process.exit(1);
}

// Mask comments and quoted literals while preserving every UTF-16 source offset.
function codeOnly(source) {
  const chars = source.split('');
  let mode = 'code';
  let quote = '';
  const mask = (index) => {
    if (source[index] !== '\n' && source[index] !== '\r') chars[index] = ' ';
  };

  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    const next = source[i + 1];
    if (mode === 'line') {
      if (c === '\n' || c === '\r') mode = 'code';
      else mask(i);
    } else if (mode === 'block') {
      if (c === '*' && next === '/') {
        mask(i); mask(i + 1); i += 1; mode = 'code';
      } else mask(i);
    } else if (mode === 'string' || mode === 'char') {
      if (c === '\\') {
        mask(i);
        if (i + 1 < source.length) { mask(i + 1); i += 1; }
      } else {
        mask(i);
        if (c === quote) mode = 'code';
      }
    } else if (c === '/' && next === '/') {
      mask(i); mask(i + 1); i += 1; mode = 'line';
    } else if (c === '/' && next === '*') {
      mask(i); mask(i + 1); i += 1; mode = 'block';
    } else if (c === '"' || c === "'") {
      mask(i); quote = c; mode = c === '"' ? 'string' : 'char';
    }
  }
  return chars.join('');
}

function oneMatch(source, pattern, label) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) fail(`expected one ${label}; found ${matches.length}`);
  return matches[0];
}

function methodBody(source, signature, label) {
  const afterSignature = signature.index + signature[0].length;
  const open = source.indexOf('{', afterSignature);
  if (open < 0 || /[^\s]/.test(source.slice(afterSignature, open))) {
    fail(`${label} has no body immediately after its signature`);
  }
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}' && --depth === 0) return { start: signature.index, open, close: i };
  }
  fail(`${label} has no matching closing brace`);
}

function depthAt(source, open, target) {
  let depth = 0;
  for (let i = open; i < target; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
  }
  return depth;
}

function lineAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

if (!fs.existsSync(patchPath)) fail('patch-package patch file is missing');
const version = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).version;
if (version !== '0.7.4') fail(`expected package version 0.7.4; found ${version}`);
const source = fs.readFileSync(sourcePath, 'utf8');
if (!source.includes('Upstream issue #824')) fail('installed source lacks the issue #824 patch marker');
const code = codeOnly(source);

const extension = oneMatch(code, /@interface\s+EnrichedMarkdown\s*\(\s*\)\s*<[^>]*>/g, 'class extension');
const extensionEnd = code.indexOf('@end', extension.index + extension[0].length);
const declaration = oneMatch(code,
  /-\s*\(void\)\s*validateHeightForCurrentWidth:\s*\(CGFloat\)\s*width\s*;/g,
  'height-validator declaration');
if (extensionEnd < 0 || declaration.index < extension.index || declaration.index >= extensionEnd) {
  fail('height-validator declaration is outside @interface EnrichedMarkdown ()');
}

const implementation = oneMatch(code, /@implementation\s+EnrichedMarkdown\b/g, 'class implementation');
const implementationEnd = code.indexOf('@end', implementation.index + implementation[0].length);
if (implementationEnd < 0) fail('class implementation has no @end');
const apply = oneMatch(code,
  /^[ \t]*-\s*\(void\)\s*applyRenderedSegments:\s*\(NSArray\s*\*\)\s*renderedSegments\s+renderedMarkdown:\s*\(NSString\s*\*\)\s*renderedMarkdown[ \t]*$/gm,
  'applyRenderedSegments implementation');
const validate = oneMatch(code,
  /^[ \t]*-\s*\(void\)\s*validateHeightForCurrentWidth:\s*\(CGFloat\)\s*width[ \t]*$/gm,
  'height-validator implementation');
const layout = oneMatch(code, /^[ \t]*-\s*\(void\)\s*layoutSubviews[ \t]*$/gm, 'layoutSubviews implementation');
for (const [name, signature] of [['applyRenderedSegments', apply], ['height validator', validate], ['layoutSubviews', layout]]) {
  if (signature.index < implementation.index || signature.index >= implementationEnd) fail(`${name} is outside @implementation`);
}

const applyBody = methodBody(code, apply, 'applyRenderedSegments');
const validateBody = methodBody(code, validate, 'validateHeightForCurrentWidth');
const layoutBody = methodBody(code, layout, 'layoutSubviews');
if (validateBody.start <= applyBody.close) fail('height-validator implementation begins before applyRenderedSegments closes');
if (validateBody.close >= layoutBody.start) fail('height-validator does not close before layoutSubviews');
if (layoutBody.close >= implementationEnd) fail('layoutSubviews does not close inside the class implementation');

const calls = [...code.matchAll(/\[self\s+validateHeightForCurrentWidth:self\.bounds\.size\.width\s*\];/g)]
  .filter((match) => match.index >= applyBody.start && match.index < applyBody.close);
if (calls.length !== 1) fail(`expected one validation call in applyRenderedSegments; found ${calls.length}`);
if (depthAt(code, applyBody.open, calls[0].index) !== 2) {
  fail('validation call must be inside the usable-width block but outside _pendingForceHeightUpdate');
}

if (!fs.existsSync(tableSourcePath)) fail('installed iOS table source is missing');
const tableSource = fs.readFileSync(tableSourcePath, 'utf8');
const tableCode = codeOnly(tableSource);
const renderGrid = oneMatch(
  tableCode,
  /^[ \t]*-\s*\(void\)\s*renderGridIOS[ \t]*$/gm,
  'iOS table grid implementation',
);
const renderGridBody = methodBody(tableCode, renderGrid, 'renderGridIOS');
const renderGridCode = tableCode.slice(renderGridBody.open, renderGridBody.close + 1);
if (!/rowData\.cellTexts\s*=\s*isRightToLeft\s*\?\s*\[\[sourceCells reverseObjectEnumerator\]\s*allObjects\]\s*:\s*sourceCells/u.test(renderGridCode)) {
  fail('RTL table columns must be reversed only in the visual grid data');
}
if (!/displayColumnWidths\s*=\s*isRightToLeft\s*\?\s*\[\[_colWidths reverseObjectEnumerator\]\s*allObjects\]\s*:\s*_colWidths/u.test(renderGridCode) ||
    !/columnWidths\s*:\s*displayColumnWidths/u.test(renderGridCode)) {
  fail('RTL table widths must match the visual column order');
}

const layoutSignature = oneMatch(
  tableCode,
  /^[ \t]*-\s*\(void\)\s*layoutSubviews[ \t]*$/gm,
  'table layoutSubviews implementation',
);
const tableLayoutBody = methodBody(tableCode, layoutSignature, 'table layoutSubviews');
const tableLayoutCode = tableCode.slice(tableLayoutBody.open, tableLayoutBody.close + 1);
if (!/gridOriginX\s*=\s*isRightToLeft\s*&&\s*_totalTableWidth\s*<\s*self\.bounds\.size\.width/u.test(tableLayoutCode) ||
    !/leadingOffset\s*=\s*isRightToLeft\s*\?/u.test(tableLayoutCode)) {
  fail('fitting tables must align right in RTL and wide tables must begin at RTL leading edge');
}
if (!/if\s*\(\s*!_hasUserScrolledHorizontally[^)]*\)[\s\S]*?setContentOffset/u.test(tableLayoutCode)) {
  fail('RTL leading-edge restoration must stop after the reader manually scrolls');
}

const dragHandler = oneMatch(
  tableCode,
  /^[ \t]*-\s*\(void\)\s*scrollViewWillBeginDragging:\s*\(UIScrollView\s*\*\)\s*scrollView[ \t]*$/gm,
  'table scroll interaction handler',
);
const dragBody = methodBody(tableCode, dragHandler, 'scrollViewWillBeginDragging');
if (!tableCode.slice(dragBody.open, dragBody.close + 1).includes('_hasUserScrolledHorizontally = YES')) {
  fail('manual table drags must be remembered across streamed table updates');
}
if (!tableSource.includes('for (NSArray<TableCellData *> *row in _rows)') ||
    !tableSource.includes('for (NSArray<TableCellData *> *cellDataRow in _rows)')) {
  fail('copy and accessibility sources must retain original logical table order');
}

const nativeFiles = {
  codeHeader: 'ios/views/ENRMCodeBlockContainerView.h',
  codeView: 'ios/views/ENRMCodeBlockContainerView.m',
  codeLanguage: 'ios/utils/ENRMCodeLanguage.m',
  syntaxBridge: 'ios/code/ENRMSyntaxHighlighterBridge.swift',
  previewBridge: 'ios/code/ENRMCodePreviewController.swift',
  fullscreenBridge: 'ios/code/ENRMCodeFullscreenController.swift',
  gestureGate: 'ios/code/ENRMCodeGestureGate.swift',
  segments: 'ios/utils/SegmentRenderer.m',
  mathView: 'ios/views/ENRMMathContainerView.m',
  bidi: 'ios/utils/ParagraphStyleUtils.m',
};
const native = Object.fromEntries(Object.entries(nativeFiles).map(([key, file]) => {
  const location = path.join(packageRoot, file);
  if (!fs.existsSync(location)) fail(`missing native renderer file ${file}`);
  return [key, fs.readFileSync(location, 'utf8')];
}));
for (const [key, text] of Object.entries(native)) {
  const masked = codeOnly(text);
  let depth = 0;
  for (const c of masked) { if (c === '{') depth++; else if (c === '}') depth--; if (depth < 0) fail(`${key} has an unmatched brace`); }
  if (depth !== 0) fail(`${key} has unclosed method/block scope`);
}
const viewCode = codeOnly(native.codeView);
const codeImplementation = oneMatch(viewCode, /@implementation\s+ENRMCodeBlockContainerView\b/g, 'code-block implementation');
if (!native.codeHeader.includes('@property (nonatomic, copy) NSString *menuCopyLabel;') || /@property\s+\([^\n]*\)\s+NSString\s+\*copyLabel\b/u.test(native.codeHeader)) fail('code-block menu label must avoid the Objective-C copy method family');
for (const name of ['applyCodeNode', 'measureHeight', 'layoutSubviews', 'copyCode', 'requestSyntaxColorsForLanguage', 'dealloc']) {
  const signature = oneMatch(viewCode, new RegExp(`^[ \\t]*-\\s*\\([^\\n]+\\)${name}(?::[^\\n;]*)?[ \\t]*$`, 'gm'), `code ${name}`);
  const body = methodBody(viewCode, signature, `code ${name}`);
  if (depthAt(viewCode, viewCode.indexOf('{', codeImplementation.index), body.start) !== 0) fail(`code ${name} is nested in another method`);
}
for (const required of ['node.attributes[@"language"]', 'ENRMRawCodeContent(node)', 'copyStringToPasteboard(_rawCode)', 'NSLineBreakByClipping', '_codeView.scrollEnabled = NO', 'usedRectForTextContainer', 'UISemanticContentAttributeForceLeftToRight', 'MAX(44, headerHeight)', 'accessibilityLabel']) {
  if (!native.codeView.includes(required)) fail(`code block lacks ${required}`);
}
if (!native.segments.includes('MarkdownNodeTypeCodeBlock') || !native.segments.includes('codeSegmentWithNode:segment') || !source.includes('handlerWithKind:ENRMSegmentKindCode')) fail('code AST segment registration is missing');
if (!source.includes('[(ENRMCodeBlockContainerView *)segment measureHeight:width]')) fail('code must use the existing intrinsic segment layout');
const touchStart = source.indexOf('touchEventEmitterAtPoint:');
const touchSource = source.slice(touchStart);
for (const cls of ['TableContainerView', 'ENRMMathContainerView', 'ENRMCodeBlockContainerView']) if (!touchSource.includes(`[${'segment'} isKindOfClass:[${cls} class]]`)) fail(`native touch ownership missing for ${cls}`);
for (const required of ['_scrollView.scrollEnabled = overflows', 'UISemanticContentAttributeForceLeftToRight', 'alwaysBounceVertical = NO', 'alignedOriginXForWidth']) if (!native.mathView.includes(required)) fail(`math overflow contract missing ${required}`);
if (!native.bidi.includes('NSWritingDirectionAttributeName') || !native.bidi.includes('NSAttachmentAttributeName') || !native.bidi.includes('NSLinkAttributeName') || !native.bidi.includes('CodeAttributeName')) fail('inline bidi must preserve parsed code/link/math regions');
const parser = fs.readFileSync(path.join(packageRoot, 'cpp/parser/MD4CParser.cpp'), 'utf8');
for (const required of ['MAX(14, font.pointSize)', 'MAX(44, ceil(_language.font.lineHeight + 16))', 'configurationWithPointSize:18', 'kCACornerCurveContinuous']) if (!native.codeView.includes(required)) fail(`code header visual/accessible geometry missing ${required}`);
const syntax = native.syntaxBridge;
for (const required of ['import Highlighter', 'qos: .utility', 'pending[clientID] = job', 'old.request.cancel()', 'maximumPendingClients = 128', 'maximumSourceUTF16 = 32768', 'maximumCacheEntries = 64', 'maximumCacheCost = 2 * 1024 * 1024', 'SHA256.hash', 'supported.contains(job.language)', 'highlighted.string.utf8.elementsEqual(job.source.utf8)', 'doFastRender: true', 'DispatchQueue.main.async']) if (!syntax.includes(required)) fail(`syntax service lacks ${required}`);
if (/highlightAuto|doFastRender: false|asyncAfter|Timer/u.test(syntax)) fail('syntax must use explicit metadata and background work without timer/render loops');
const colorCallback = native.codeView.slice(native.codeView.indexOf('completion:^(NSAttributedString *colors)'), native.codeView.indexOf('- (void)dealloc'));
if (!colorCallback.includes('view->_highlightRevision != revision') || !colorCallback.includes('![colors.string isEqualToString:source]') || !colorCallback.includes('addAttribute:NSForegroundColorAttributeName')) fail('async syntax color application must reject stale/changed source');
if (/setNeedsLayout|requestHeightUpdate|NSFontAttributeName|NSParagraphStyleAttributeName|attributedText\s*=|_rawCode\s*=/u.test(colorCallback)) fail('syntax colors must not own glyph/source/layout geometry');
const podspec = fs.readFileSync(path.join(packageRoot, 'ReactNativeEnrichedMarkdown.podspec'), 'utf8');
for (const required of ["https://github.com/smittytone/HighlighterSwift.git", "kind: 'revision', revision: 'fe7aae9c9b31d3b296fd3d2dd575e1a207bb29e0'", "products: ['Highlighter']", 'PythagorasCodeSyntaxNotices', 'ENRICHED_MARKDOWN_SYNTAX=1', 'ENRICHED_MARKDOWN_MATH=0']) if (!podspec.includes(required)) fail(`reproducible syntax integration lacks ${required}`);
if (!native.codeLanguage.includes('NSString *ENRMCodeHighlightLanguage') || !native.codeLanguage.includes('containsObject:normalized]) return nil')) fail('plain/unknown language must have an explicit safe syntax path');
if (!parser.includes('codeDetail->lang') || !parser.includes('node->setAttribute(ATTR_LANGUAGE, lang)')) fail('code language must originate from MD4C, not content guesses');

const preview = native.previewBridge;
for (const required of ['UIGlassEffect(style: .regular)', 'UISegmentedControl', '#available(iOS 26.0, *)', 'UIBlurEffect(style: .systemThinMaterial)', 'websiteDataStore = .nonPersistent()', 'allowsContentJavaScript = false', 'web.loadHTMLString(document, baseURL: nil)', 'navigationAction.targetFrame?.isMainFrame == true', 'decisionHandler(allowed ? .allow : .cancel, preferences)', "default-src 'none'", "script-src 'none'", "form-action 'none'", 'securityLevel: .strict, source: .bundledDefault', 'onLinkActivated: { _ in }', 'addChild(host)', 'host.didMove(toParent: self)', 'removeAllScriptMessageHandlers()', 'host.rootView = AnyView(EmptyView())', 'host.removeFromParent()']) if (!preview.includes(required)) fail(`preview policy/lifecycle lacks ${required}`);
if (/\.cdn\(|print\(|NSLog|Timer|asyncAfter|scrollTo/u.test(preview)) fail('previews must remain offline, quiet, bounded and without scroll/timer ownership');
for (const required of ['_language.textColor = self.config.paragraphColor', 'ENRMCodePreviewLanguage(node.attributes[@"language"])', 'if (!_previewing || !_previewLanguage || !self.window) return', '[self reactViewController]', '[parent addChildViewController:_previewController]', 'didMoveToParentViewController:parent', 'if (!newWindow) [self disposePreviewController]', 'self.onIntrinsicPresentationChanged()', 'MAX(260, MIN(330, round(width * 0.85)))', 'ENRMCodeCopySymbolName = @"square.on.square"', 'return _previewing ? cap : MIN(_bodyHeight, cap)', '[self headerHeight] + [self visibleBodyHeightForWidth:width]', '_horizontalScroll.frame = CGRectMake(0, 0, width, visibleBodyHeight)', '_horizontalScroll.contentSize = CGSizeMake(contentWidth, _bodyHeight)', 'contentWidth > width + 0.5 || verticalOverflow', '_bodyContainer.clipsToBounds = YES', '_copyButton.imageView.transform = CGAffineTransformMakeTranslation(1, 0)', 'CGFloat copySlot = 52', '_sourceGestureGate.enabled = !_previewing && verticalOverflow']) if (!native.codeView.includes(required)) fail(`native preview presentation lacks ${required}`);
if (/setBackgroundImage|setDividerImage|selectedSegmentTintColor/u.test(preview)) fail('native segmented selection must not be erased/replaced');
for (const required of ['minScale: 0.7, maxScale: 3.5', 'controller: mermaidController', 'if fitOnNextRender', 'fitOnNextRender = false', 'mermaidController.zoomToFit()', 'new MutationObserver(rendered)', 'contentWorld: .defaultClient', 'message.body as? String == "rendered"', 'upstream.webView?(webView, decidePolicyFor: navigationAction, decisionHandler: decisionHandler)', 'tap.require(toFail: gate)']) if (!preview.includes(required)) fail(`Mermaid interaction/status lacks ${required}`);
const tapScope = preview.slice(preview.indexOf('if !fullscreen {'), preview.indexOf('@objc public func prepareForPresentation'));
for (const required of ['UITapGestureRecognizer(target: self, action: #selector(openFullscreen))', 'tap.numberOfTouchesRequired = 1', 'tap.cancelsTouchesInView = false', 'tap.delegate = self', 'view.addGestureRecognizer(tap)', 'if kind == "mermaid"', 'let gate = ENRMCodeGestureGate(viewport: view)', 'tap.require(toFail: gate)']) if (!tapScope.includes(required)) fail(`inline native tap arbitration lacks ${required}`);
if ((preview.match(/UITapGestureRecognizer\(target:/gu) ?? []).length !== 1 || preview.includes(['allowable', 'Movement'].join(''))) fail('fullscreen activation must use one inline standard tap recognizer without an unsupported movement property');
if (!native.gestureGate.includes('movementThreshold: CGFloat = 8') || !native.gestureGate.includes('if state == .possible && touched.count > 1 { state = .began }') || !/squareRoot\(\) >= movementThreshold \{\s*state = \.began/u.test(native.gestureGate)) fail('Mermaid gate must own meaningful movement and multi-touch recognition');
for (const required of ['cancelsTouchesInView = false', 'shouldBeRequiredToFailBy', 'isAncestorScrollPan(otherGestureRecognizer)', 'otherView.isDescendant(of: viewport)', 'state == .possible ? .failed : .ended']) if (!native.gestureGate.includes(required)) fail(`native viewport arbitration lacks ${required}`);
for (const required of ['modalPresentationStyle = .fullScreen', 'items: ["Code", "Preview"]', 'content.fullscreen = true', 'ENRMCodePreviewController(kind: kind)', 'content.update(source: source.string', 'text.isScrollEnabled = false', 'text.textContainer.widthTracksTextView = false', 'text.isSelectable = true', 'ENRMSyntaxHighlighterBridge.requestColors(forSource: raw', 'preview?.dispose()', 'preview?.removeFromParent()']) if (!native.fullscreenBridge.includes(required)) fail(`native fullscreen viewer lacks ${required}`);
if (/scrollTo|contentOffset\s*=|setTimeout|asyncAfter/u.test(native.fullscreenBridge)) fail('fullscreen cannot write transcript offsets or own timed geometry');
if (!source.includes('self.clipsToBounds = YES') || !native.codeView.includes('_previewController.view.frame = _bodyContainer.bounds')) fail('native code paint must stay within its published visible bounds');
const presentationSignature = oneMatch(code, /^[ \t]*-\s*\(void\)codeBlockPresentationDidChange[ \t]*$/gm, 'presentation height invalidation');
const presentationBody = methodBody(code, presentationSignature, 'presentation height invalidation');
const presentationCode = code.slice(presentationBody.open, presentationBody.close + 1);
for (const required of ['_renderRevision++', '_pendingHeightValidation = YES', '[self validateHeightForCurrentWidth:self.bounds.size.width]']) if (!presentationCode.includes(required)) fail(`presentation height must use existing validation: ${required}`);
if (/requestHeightUpdate|scrollTo/u.test(presentationCode)) fail('preview cannot bypass reviewed height validation or own transcript scrolling');
if (!source.includes('[currentOwner codeBlockPresentationDidChange]')) fail('code preview lacks a weak-owner height callback');
for (const required of ["https://github.com/braddschick/MermaidKit.git", "kind: 'revision', revision: 'a6a5c15f3c91ff4061780c235a44716a988dc475'", "products: ['MermaidKit']", 'PythagorasCodePreviewNotices', 'ENRICHED_MARKDOWN_PREVIEW=1']) if (!podspec.includes(required)) fail(`reproducible preview integration lacks ${required}`);

console.log([
  'Verified react-native-enriched-markdown@0.7.4 native height and RTL table patch structure.',
  `  class declaration: line ${lineAt(source, declaration.index)} inside the class extension`,
  `  applyRenderedSegments: lines ${lineAt(source, applyBody.start)}-${lineAt(source, applyBody.close)}`,
  `  validateHeightForCurrentWidth: lines ${lineAt(source, validateBody.start)}-${lineAt(source, validateBody.close)}`,
  `  layoutSubviews: lines ${lineAt(source, layoutBody.start)}-${lineAt(source, layoutBody.close)}`,
  '  method scopes and brace depth are valid; RTL visual columns, leading position, user-scroll preservation, and logical copy order are verified.',
  '  AST-backed code headers/copy/horizontal layout, wide-math native touch ownership, and attributed inline bidi protections are verified.',
  '  Pinned grammar service, bounded background coalescing/cache, exact source guards and color-only native application are verified.',
  '  Lazy HTML/Mermaid previews, strict offline policies, controller teardown and reviewed intrinsic-height invalidation are verified.',
  '  Capped two-axis source, stable native selection/surfaces, scoped gesture priority, render-driven fit and fullScreen snapshots are verified.',
].join('\n'));
