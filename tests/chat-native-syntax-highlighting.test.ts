import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import test from 'node:test';

const root = path.join(process.cwd(), 'mobile/node_modules/react-native-enriched-markdown');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const bridge = read('ios/code/ENRMSyntaxHighlighterBridge.swift');
const view = read('ios/views/ENRMCodeBlockContainerView.m');
const languages = read('ios/utils/ENRMCodeLanguage.m');
const grammarSource = languages.slice(languages.indexOf('grammars = @{'), languages.indexOf('return grammars[normalized]'));
const grammarPairs = [...grammarSource.matchAll(/@"([^"\n]+)": @"([^"\n]+)"/gu)].map(match => [match[1], match[2]]);
const aliases = Object.fromEntries(grammarPairs);
const paletteMap = (mode: string) => [...bridge.slice(bridge.indexOf(`let ${mode}:`), bridge.indexOf('\n  ]', bridge.indexOf(`let ${mode}:`)) + 4).matchAll(/0x([\dA-F]{6}): 0x([\dA-F]{6})/gu)].map(match => ['#' + match[1], '#' + match[2]]);
const paletteSource = fs.readFileSync(path.join(process.cwd(), 'mobile/src/theme.ts'), 'utf8');
function paletteToken(mode: string, token: string) {
  const start = paletteSource.indexOf(`${mode}: {`);
  const section = paletteSource.slice(start, paletteSource.indexOf('},', start));
  return section.match(new RegExp(`${token}: '(#[0-9A-Fa-f]{6})'`, 'u'))![1];
}

test('syntax dependency is an exact audited SPM revision with reproducible sources and binary license notices', () => {
  const spec = read('ReactNativeEnrichedMarkdown.podspec');
  for (const required of ["https://github.com/smittytone/HighlighterSwift.git", "kind: 'revision', revision: 'fe7aae9c9b31d3b296fd3d2dd575e1a207bb29e0'", "products: ['Highlighter']", "PythagorasCodeSyntaxNotices", 'ios/**/*.{h,m,mm,cpp,swift}', 'ENRICHED_MARKDOWN_SYNTAX=1', 'ENRICHED_MARKDOWN_MATH=0', "products: ['RaTeX']"]) assert.ok(spec.includes(required), required);
  assert.ok(bridge.includes('import Highlighter'));
  assert.ok(read('ios/code/PythagorasSyntax-LICENSE.txt').includes('BSD 3-Clause'));
});

test('metadata aliases are separate from display labels; plaintext and unknown grammar remain safe', () => {
  assert.equal(new Set(grammarPairs.map(([key]) => key)).size, grammarPairs.length, 'no duplicate metadata keys');
  for (const [source, grammar] of [['js', 'javascript'], ['tsx', 'typescript'], ['react', 'javascript'], ['swiftui', 'swift'], ['sqlite', 'sql'], ['plist', 'xml'], ['toml', 'ini'], ['.env', 'ini'], ['cmd', 'dos'], ['objc', 'objectivec'], ['jsonc', 'json']]) assert.equal(aliases[source], grammar);
  assert.ok(languages.includes('controlCharacterSet'));
  assert.ok(languages.includes('NSStringEnumerationByComposedCharacterSequences'));
  assert.ok(languages.includes('return grammars[normalized] ?: normalized'));
  assert.ok(languages.includes('containsObject:normalized]) return nil'));
  assert.ok(bridge.includes('supported.contains(job.language) else { return nil }'));
  assert.ok(bridge.includes('engine.highlight(job.source, as: job.language, doFastRender: true)'));
  assert.equal(/highlightAuto|doFastRender: false/u.test(bridge), false);
});

test('native highlight completion cannot replace newer source or modify typography, geometry or copy', () => {
  const body = view.slice(view.indexOf('completion:^(NSAttributedString *colors)'), view.indexOf('- (void)dealloc'));
  const guard = body.indexOf('view->_highlightRevision != revision');
  const mutation = body.indexOf('textStorage beginEditing');
  assert.ok(guard >= 0 && guard < mutation);
  assert.ok(body.includes('![view->_rawCode isEqualToString:source]'));
  assert.ok(body.includes('![colors.string isEqualToString:source]'));
  assert.ok(body.includes('addAttribute:NSForegroundColorAttributeName'));
  assert.equal(/setNeedsLayout|requestHeightUpdate|NSFontAttributeName|NSParagraphStyleAttributeName|attributedText\s*=|_rawCode\s*=/u.test(body), false);
  assert.ok(bridge.includes('highlighted.string.utf8.elementsEqual(job.source.utf8)'));
  assert.ok(view.includes('copyStringToPasteboard(_rawCode)'));
  assert.ok(view.indexOf('_codeView.attributedText =') < view.indexOf('[self requestSyntaxColorsForLanguage:node.attributes'));
  assert.ok(view.includes('[_highlightRequest cancel]'));
});

test('grammar work is serial, coalesces pending clients and has explicit memory limits', () => {
  for (const required of ['qos: .utility', 'pending[clientID] = job', 'old.request.cancel()', 'maximumPendingClients = 128', 'maximumSourceUTF16 = 32768', 'maximumCacheEntries = 64', 'maximumCacheCost = 2 * 1024 * 1024', 'SHA256.hash', 'cacheCost + cost > maximumCacheCost', 'DispatchQueue.main.async', 'job.request.isCancelled']) assert.ok(bridge.includes(required), required);
  assert.ok(view.includes('_rawCode.length > 32768'));
  assert.equal(/asyncAfter|Timer|setTimeout|requestAnimationFrame/u.test(bridge), false);
});

function luminance(hex: string) {
  const rgb = hex.slice(1).match(/../gu)!.map(value => parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a: string, b: string) { const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (light + 0.05) / (dark + 0.05); }
test('Pythagoras syntax and default text colors meet 4.5:1 against both code surfaces', () => {
  for (const mode of ['dark', 'light'] as const) {
    const colors = paletteMap(mode);
    assert.equal(colors.length, 8);
    for (const [, target] of colors) assert.ok(contrast(target, paletteToken(mode, 'surfaceElevated')) >= 4.5, `${mode} ${target}`);
    assert.ok(contrast(paletteToken(mode, 'textSecondary'), paletteToken(mode, 'surfaceElevated')) >= 4.5);
  }
  const renderer = fs.readFileSync(path.join(process.cwd(), 'mobile/src/ai/assistant-enriched-markdown.ios.tsx'), 'utf8');
  const card = renderer.slice(renderer.indexOf('codeBlock: {'), renderer.indexOf('thematicBreak: {'));
  for (const required of ['color: palette.textSecondary', 'backgroundColor: palette.surfaceElevated', 'borderWidth: 0', 'borderRadius: 18']) assert.ok(card.includes(required));
  assert.ok(view.includes('kCACornerCurveContinuous'));
});

// Runtime is native JavaScriptCore. This optional integration uses the exact pinned
// dependency's JS grammar bundle as a test oracle, never as Mobile runtime code.
const auditRoot = process.env.PYTHAGORAS_HIGHLIGHTER_AUDIT_ROOT;
test('pinned Highlight.js grammar output preserves Unicode, tabs, CRLF and source entities for real languages', { skip: !auditRoot && 'Set PYTHAGORAS_HIGHLIGHTER_AUDIT_ROOT to the audited 3.1.0 source checkout.' }, () => {
  assert.ok(auditRoot);
  const manifest = fs.readFileSync(path.join(auditRoot, 'README.md'), 'utf8');
  assert.ok(manifest.includes('HighlighterSwift 3.1.0'));
  const sandbox = vm.createContext({ console: { log() {}, warn() {}, error() {} } });
  const engineSource = fs.readFileSync(path.join(auditRoot, 'Sources/Assets/highlight.min.js'));
  assert.equal(createHash('sha256').update(engineSource).digest('hex'), '160ed3581c2386b9271d19bd1dfbbf9319c0d8a8c9506aa3587b2f36d6669033');
  vm.runInContext(engineSource.toString('utf8'), sandbox, { timeout: 5000 });
  const engine = sandbox.hljs;
  assert.equal(engine.versionString, '11.11.1');
  assert.equal(engine.listLanguages().length, 192);
  for (const mode of ['dark', 'light']) {
    const theme = fs.readFileSync(path.join(auditRoot, `Sources/Assets/styles/atom-one-${mode}.css`), 'utf8').toUpperCase();
    for (const [source] of paletteMap(mode)) assert.ok(theme.includes(source), `${mode} maps an actual upstream token color ${source}`);
  }
  const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#x27;': "'", '&#39;': "'" };
  const decode = (html: string) => html.replace(/<\/?span\b[^>]*>/gu, '').replace(/&(?:amp|lt|gt|quot|apos|#x27|#39);/gu, entity => entities[entity]);
  const cases = [
    ['python', '# مرحبا 👋\r\ndef add(x):\r\n\treturn x + 42\r\n'],
    ['javascript', 'const text = "<&amp;>"; // comment\nconst ok = true;\n'],
    ['typescript', 'interface Student { name: string; }\nconst limit: number = 42;\n'],
    ['json', '{ "message": "مرحبا 👋", "enabled": true, "count": 42 }\n'],
    ['xml', '<section title="A &amp; B"><b>مرحبا</b></section>\n'],
    ['bash', '# comment\necho "مرحبا"\n'],
    ['swift', 'import SwiftUI\nlet title = "مرحبا"\nlet count = 42\n'],
    ['ini', '# comment\nMODE=development\nRETRIES=3\n'],
  ];
  for (const [language, source] of cases) {
    const rendered = engine.highlight(source, { language, ignoreIllegals: true }).value;
    assert.equal(decode(rendered), source, language);
    assert.ok(rendered.includes('class="hljs-'), language);
  }
  for (const [alias, grammar] of grammarPairs) assert.ok(engine.getLanguage(grammar), `${alias} → ${grammar}`);
  for (const unknown of ['custom-dsl', 'mermaid', 'prisma', 'solidity']) assert.equal(engine.getLanguage(unknown), undefined);
  const tagged = engine.highlight(cases[1][1], { language: 'javascript', ignoreIllegals: true }).value;
  for (const token of ['hljs-keyword', 'hljs-string', 'hljs-comment', 'hljs-literal']) assert.ok(tagged.includes(token), token);
});
