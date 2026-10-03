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
const applyTable = oneMatch(
  tableCode,
  /^[ \t]*-\s*\(void\)\s*applyTableNode:\s*\(MarkdownASTNode\s*\*\)\s*tableNode[ \t]*$/gm,
  'table source-direction implementation',
);
const applyTableBody = methodBody(tableCode, applyTable, 'applyTableNode');
const applyTableCode = tableCode.slice(applyTableBody.open, applyTableBody.close + 1);
if (!/_resolvedTableLayoutDirection\s*=\s*_resolvedLayoutDirection/u.test(applyTableCode) ||
    !/_writingDirectionMode\s*==\s*ENRMWritingDirectionModeFirstStrong[\s\S]*?ENRMFirstStrongDirection\(\[self\s+extractPlainTextFromNode:tableNode\]\)/u.test(applyTableCode) ||
    !/sourceDirection\s*!=\s*NSWritingDirectionNatural[\s\S]*?_resolvedTableLayoutDirection\s*=\s*sourceDirection/u.test(applyTableCode)) {
  fail('first-strong table direction must come from logical table source text, with the existing direction as neutral fallback');
}
if (!/layoutDirection:_resolvedTableLayoutDirection/u.test(applyTableCode)) {
  fail('table cells must receive the direction resolved from their source table');
}
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
if (!/BOOL\s+isRightToLeft\s*=\s*_resolvedTableLayoutDirection\s*==\s*NSWritingDirectionRightToLeft/u.test(renderGridCode)) {
  fail('visual RTL table order must use source-resolved table direction, not outer Yoga direction');
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
if (!/BOOL\s+isRightToLeft\s*=\s*_resolvedTableLayoutDirection\s*==\s*NSWritingDirectionRightToLeft/u.test(tableLayoutCode) ||
    !/gridOriginX\s*=\s*isRightToLeft\s*&&\s*_totalTableWidth\s*<\s*self\.bounds\.size\.width/u.test(tableLayoutCode) ||
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

console.log([
  'Verified react-native-enriched-markdown@0.7.4 native height and RTL table patch structure.',
  `  class declaration: line ${lineAt(source, declaration.index)} inside the class extension`,
  `  applyRenderedSegments: lines ${lineAt(source, applyBody.start)}-${lineAt(source, applyBody.close)}`,
  `  validateHeightForCurrentWidth: lines ${lineAt(source, validateBody.start)}-${lineAt(source, validateBody.close)}`,
  `  layoutSubviews: lines ${lineAt(source, layoutBody.start)}-${lineAt(source, layoutBody.close)}`,
  '  method scopes and brace depth are valid; table first-strong direction comes from logical source, RTL visual columns and leading position agree, user-scroll preservation and logical copy order are verified.',
].join('\n'));
