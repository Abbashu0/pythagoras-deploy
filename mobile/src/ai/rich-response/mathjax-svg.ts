import { mathjax } from 'mathjax-full/js/mathjax.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { mhchemParser } from 'mhchemparser/esm/mhchemParser.js';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import 'mathjax-full/js/input/tex/amscd/AmsCdConfiguration.js';
import 'mathjax-full/js/input/tex/cases/CasesConfiguration.js';
import 'mathjax-full/js/input/tex/enclose/EncloseConfiguration.js';
import 'mathjax-full/js/input/tex/extpfeil/ExtpfeilConfiguration.js';
import 'mathjax-full/js/input/tex/gensymb/GensymbConfiguration.js';
import 'mathjax-full/js/input/tex/mathtools/MathtoolsConfiguration.js';
import 'mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js';
import 'mathjax-full/js/input/tex/physics/PhysicsConfiguration.js';
import 'mathjax-full/js/input/tex/unicode/UnicodeConfiguration.js';
import 'mathjax-full/js/input/tex/upgreek/UpgreekConfiguration.js';

export interface MathSvgResult {
  svg: string;
  widthEx: number;
  heightEx: number;
  verticalAlignEx: number;
}

const MAX_TEX_LENGTH = 8_000;
const MAX_SVG_LENGTH = 512_000;
const MAX_CACHE_ENTRIES = 72;
const MAX_CACHE_CHARS = 1_500_000;
const TEX_PACKAGES = [
  'base',
  'ams',
  'amscd',
  'cases',
  'enclose',
  'extpfeil',
  'gensymb',
  'mathtools',
  'newcommand',
  'physics',
  'unicode',
  'upgreek',
];

let mathDocument: ReturnType<typeof createMathDocument> | null = null;
const svgCache = new Map<string, MathSvgResult>();
let svgCacheChars = 0;

export function renderTexToSvg(texSource: string, display: boolean): MathSvgResult | null {
  const tex = texSource.trim();
  if (!tex || tex.length > MAX_TEX_LENGTH) return null;
  const expandedTex = expandChemistryCommands(tex);
  if (expandedTex === null) return null;

  const key = `${display ? 'display' : 'inline'}:${tex}`;
  const cached = svgCache.get(key);
  if (cached) {
    svgCache.delete(key);
    svgCache.set(key, cached);
    return cached;
  }

  try {
    const engine = (mathDocument ??= createMathDocument());
    engine.tex.reset();
    const node = engine.document.convert(expandedTex, { display });
    if (engine.tex.parseOptions.error) return null;

    const serialized = engine.adaptor.outerHTML(node);
    const svgTag = /<svg\b[^>]*>[\s\S]*?<\/svg>/iu.exec(serialized)?.[0];
    if (!svgTag || svgTag.length > MAX_SVG_LENGTH || !isSafeGeneratedSvg(svgTag)) return null;

    const widthEx = getSvgDimension(svgTag, 'width');
    const heightEx = getSvgDimension(svgTag, 'height');
    if (
      widthEx === null ||
      heightEx === null ||
      widthEx <= 0 ||
      heightEx <= 0 ||
      widthEx > 10_000 ||
      heightEx > 2_000
    ) {
      return null;
    }

    const verticalAlignEx = getVerticalAlign(svgTag);
    const result = {
      svg: normalizeSvg(svgTag),
      widthEx,
      heightEx,
      verticalAlignEx,
    };
    rememberSvg(key, result);
    return result;
  } catch {
    return null;
  }
}

function expandChemistryCommands(source: string): string | null {
  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const commandIndex = source.indexOf('\\ce{', cursor);
    if (commandIndex < 0) break;
    if (isEscapedTeXCommand(source, commandIndex)) {
      cursor = commandIndex + 1;
      continue;
    }

    const openBrace = commandIndex + 3;
    let depth = 1;
    let closeBrace = openBrace + 1;
    while (closeBrace < source.length && depth > 0) {
      const character = source[closeBrace];
      if (character === '\\') {
        closeBrace += 2;
        continue;
      }
      if (character === '{') depth += 1;
      if (character === '}') depth -= 1;
      if (depth > 0) closeBrace += 1;
    }
    if (depth !== 0) return null;

    const chemistry = source.slice(openBrace + 1, closeBrace);
    if (!chemistry || chemistry.length > MAX_TEX_LENGTH) return null;
    try {
      chunks.push(source.slice(cursor, commandIndex), `{${mhchemParser.toTex(chemistry, 'ce')}}`);
    } catch {
      return null;
    }
    cursor = closeBrace + 1;
  }

  if (chunks.length === 0) return source;
  chunks.push(source.slice(cursor));
  const expanded = chunks.join('');
  return expanded.length <= MAX_TEX_LENGTH * 2 ? expanded : null;
}

function isEscapedTeXCommand(source: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

export function clearMathSvgCacheForTests(): void {
  svgCache.clear();
  svgCacheChars = 0;
  mathDocument = null;
}

function createMathDocument() {
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);

  const tex = new TeX({
    packages: TEX_PACKAGES,
    maxBuffer: MAX_TEX_LENGTH,
    maxMacros: 500,
    formatError: (_jax: unknown, error: unknown) => {
      throw error;
    },
  });
  const output = new SVG({ fontCache: 'none' });
  const document = mathjax.document('', { InputJax: tex, OutputJax: output });

  return { adaptor, document, tex };
}

function getSvgDimension(svg: string, name: 'width' | 'height'): number | null {
  const match = new RegExp(`\\b${name}="([0-9]+(?:\\.[0-9]+)?)ex"`, 'u').exec(svg);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function getVerticalAlign(svg: string): number {
  const match = /vertical-align:\s*(-?[0-9]+(?:\.[0-9]+)?)ex/iu.exec(svg);
  if (!match) return 0;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : 0;
}

function normalizeSvg(svg: string): string {
  return svg
    .replace(/\sstyle="[^"]*"/giu, '')
    .replace(/\s(?:role|focusable)="[^"]*"/giu, '');
}

function isSafeGeneratedSvg(svg: string): boolean {
  return (
    !/<\s*(?:script|foreignObject|image|iframe)\b/iu.test(svg) &&
    !/\son[a-z]+\s*=/iu.test(svg) &&
    !/(?:href|xlink:href)="(?!#)/iu.test(svg)
  );
}

function rememberSvg(key: string, value: MathSvgResult): void {
  const size = value.svg.length;
  if (size > MAX_CACHE_CHARS) return;

  svgCache.set(key, value);
  svgCacheChars += size;
  while (svgCache.size > MAX_CACHE_ENTRIES || svgCacheChars > MAX_CACHE_CHARS) {
    const oldestKey = svgCache.keys().next().value;
    if (!oldestKey) break;
    const oldest = svgCache.get(oldestKey);
    if (oldest) svgCacheChars -= oldest.svg.length;
    svgCache.delete(oldestKey);
  }
}
