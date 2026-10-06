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
  codeView: 'ios/views/ENRMCodeBlockContainerView.m',
  codeLanguage: 'ios/utils/ENRMCodeLanguage.m',
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
for (const name of ['applyCodeNode', 'measureHeight', 'layoutSubviews', 'copyCode']) {
  const signature = oneMatch(viewCode, new RegExp(`^[ \\t]*-\\s*\\([^\\n]+\\)${name}(?::[^\\n]*)?[ \\t]*$`, 'gm'), `code ${name}`);
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
if (!parser.includes('codeDetail->lang') || !parser.includes('node->setAttribute(ATTR_LANGUAGE, lang)')) fail('code language must originate from MD4C, not content guesses');

console.log([
  'Verified react-native-enriched-markdown@0.7.4 native height and RTL table patch structure.',
  `  class declaration: line ${lineAt(source, declaration.index)} inside the class extension`,
  `  applyRenderedSegments: lines ${lineAt(source, applyBody.start)}-${lineAt(source, applyBody.close)}`,
  `  validateHeightForCurrentWidth: lines ${lineAt(source, validateBody.start)}-${lineAt(source, validateBody.close)}`,
  `  layoutSubviews: lines ${lineAt(source, layoutBody.start)}-${lineAt(source, layoutBody.close)}`,
  '  method scopes and brace depth are valid; RTL visual columns, leading position, user-scroll preservation, and logical copy order are verified.',
  '  AST-backed code headers/copy/horizontal layout, wide-math native touch ownership, and attributed inline bidi protections are verified.',
].join('\n'));
