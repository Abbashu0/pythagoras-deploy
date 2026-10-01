import {
  findMathClosingDelimiter,
  isEscapedMarkdownDelimiter,
  isCurrencyLiteralContent,
  maskMarkdownCode,
  mathOpeningAt,
  parseMathDelimiterAt,
} from './math-delimiters';

type UnicodeRange = readonly [start: number, end: number];

const ARABIC_SCRIPT_LETTER_OR_MARK_RANGES: readonly UnicodeRange[] = [
  [0x0610, 0x061a],
  [0x0620, 0x063f],
  [0x0640, 0x064a],
  [0x064b, 0x065f],
  [0x066e, 0x066f],
  [0x0670, 0x0670],
  [0x0671, 0x06d3],
  [0x06d5, 0x06d5],
  [0x06d6, 0x06dc],
  [0x06df, 0x06e4],
  [0x06e5, 0x06e6],
  [0x06e7, 0x06e8],
  [0x06ea, 0x06ed],
  [0x06ee, 0x06ef],
  [0x06fa, 0x06fc],
  [0x06ff, 0x06ff],
  [0x0750, 0x077f],
  [0x0870, 0x0887],
  [0x0889, 0x088f],
  [0x0897, 0x089f],
  [0x08a0, 0x08c9],
  [0x08ca, 0x08e1],
  [0x08e3, 0x08ff],
  [0xfb50, 0xfbb1],
  [0xfbd3, 0xfd3d],
  [0xfd50, 0xfd8f],
  [0xfd92, 0xfdc7],
  [0xfdf0, 0xfdfb],
  [0xfe70, 0xfe74],
  [0xfe76, 0xfefc],
  [0x10ec2, 0x10ec7],
  [0x10efa, 0x10eff],
];

/**
 * Build presentation-only Markdown for react-native-enriched-markdown.
 * Original assistant content is never mutated or replaced in chat state.
 */
export function prepareEnrichedMarkdownInput(source: string): string {
  return normalizeAlternateMathDelimiters(
    stripMarkdownImages(fallbackArabicMathSpans(source)),
  );
}

/**
 * Prefer the library's single-native-TextView path for ordinary responses.
 * Its segmented GitHub renderer is needed only for GFM tables/extensions and
 * block math; inline math is supported by both flavors.
 */
export function resolveEnrichedMarkdownFlavor(
  markdown: string,
): 'commonmark' | 'github' {
  const codeMasked = maskMarkdownCode(markdown);
  if (containsDisplayMath(codeMasked) || containsGfmBlock(codeMasked)) {
    return 'github';
  }
  return 'commonmark';
}

function containsDisplayMath(markdown: string): boolean {
  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] !== '$') continue;
    const opening = mathOpeningAt(markdown, index);
    if (opening?.dollar && opening.display) return true;
  }
  return false;
}

function containsGfmBlock(markdown: string): boolean {
  if (/(?:^|\n)[ \t]{0,3}[-*+][ \t]+\[[ xX]\][ \t]+/u.test(markdown)) {
    return true;
  }
  if (/~~[^~\n].*?~~/su.test(markdown)) return true;

  const lines = markdown.split(/\r?\n/u);
  return lines.some(
    (line, index) => line.includes('|') && isGfmTableSeparator(lines[index + 1] ?? ''),
  );
}

function isGfmTableSeparator(line: string): boolean {
  const cells = line.trim().replace(/^\|/u, '').replace(/\|$/u, '').split('|');
  return cells.length > 0 && cells.every((cell) => /^[ \t]*:?-{3,}:?[ \t]*$/u.test(cell));
}

/**
 * Arabic letters and vocalization marks are not shaped reliably inside RaTeX.
 * Detect only letters/marks (not Arabic punctuation, digits, or math symbols).
 */
export function containsArabicScriptLetterOrMark(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && isInUnicodeRanges(codePoint)) {
      return true;
    }
  }

  return false;
}

/**
 * Replace only closed math spans containing Arabic letters/marks with native
 * code presentation. The complete original span, including its delimiters, is
 * preserved; code regions are skipped using the existing Markdown masker.
 */
export function fallbackArabicMathSpans(source: string): string {
  const codeMasked = maskMarkdownCode(source);
  let output = '';
  let index = 0;

  while (index < source.length) {
    const dollarOpening =
      codeMasked[index] === '$' ? mathOpeningAt(codeMasked, index) : null;

    if (dollarOpening?.dollar) {
      const close = findMathClosingDelimiter(
        codeMasked,
        dollarOpening.close,
        index + dollarOpening.open.length,
      );

      if (close >= 0) {
        const end = close + dollarOpening.close.length;
        const originalSpan = source.slice(index, end);
        const content = source.slice(index + dollarOpening.open.length, close);

        if (
          dollarOpening.open === '$' &&
          isCurrencyLiteralContent(content)
        ) {
          output += originalSpan;
        } else if (containsArabicScriptLetterOrMark(content)) {
          output += presentUnsupportedMathAsCode(originalSpan, dollarOpening.display);
        } else {
          output += originalSpan;
        }

        index = end;
        continue;
      }
    }

    const alternateOpening =
      codeMasked.startsWith('\\(', index) || codeMasked.startsWith('\\[', index);
    const parsed = alternateOpening ? parseMathDelimiterAt(codeMasked, index) : null;

    if (parsed) {
      const originalSpan = source.slice(index, parsed.end);
      const content = source.slice(index + 2, parsed.end - 2);
      output += containsArabicScriptLetterOrMark(content)
        ? presentUnsupportedMathAsCode(originalSpan, parsed.display)
        : originalSpan;
      index = parsed.end;
      continue;
    }

    output += source[index];
    index += 1;
  }

  return output;
}

function presentUnsupportedMathAsCode(source: string, display: boolean): string {
  if (display || /[\r\n]/u.test(source)) return toFencedCodeBlock(source);
  return toInlineCodeSpan(source);
}

function toInlineCodeSpan(source: string): string {
  const delimiter = '`'.repeat(longestBacktickRun(source) + 1);
  const needsPadding = source.startsWith(' ') || source.endsWith(' ');
  const padding = needsPadding ? ' ' : '';
  return delimiter + padding + source + padding + delimiter;
}

function toFencedCodeBlock(source: string): string {
  const delimiter = '`'.repeat(Math.max(3, longestBacktickRun(source) + 1));
  const lineBreak = /[\r\n]$/u.test(source) ? '' : '\n';
  return delimiter + '\n' + source + lineBreak + delimiter;
}

function longestBacktickRun(source: string): number {
  return (source.match(/`+/gu) ?? []).reduce(
    (longest, run) => Math.max(longest, run.length),
    0,
  );
}

function isInUnicodeRanges(codePoint: number): boolean {
  let low = 0;
  let high = ARABIC_SCRIPT_LETTER_OR_MARK_RANGES.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const [start, end] = ARABIC_SCRIPT_LETTER_OR_MARK_RANGES[middle];
    if (codePoint < start) high = middle;
    else if (codePoint > end) low = middle + 1;
    else return true;
  }

  return false;
}

/**
 * Convert only the alternate LaTeX delimiters supported by Agent 1.
 * Existing dollar math, currency, escaped delimiters, and code are preserved.
 */
export function normalizeAlternateMathDelimiters(source: string): string {
  const codeMasked = maskMarkdownCode(source);
  let output = '';
  let index = 0;

  while (index < source.length) {
    const dollarOpening =
      codeMasked[index] === '$' ? mathOpeningAt(codeMasked, index) : null;

    if (dollarOpening?.dollar) {
      const close = findMathClosingDelimiter(
        codeMasked,
        dollarOpening.close,
        index + dollarOpening.open.length,
      );
      if (close >= 0) {
        const end = close + dollarOpening.close.length;
        const content = source.slice(index + dollarOpening.open.length, close);
        if (dollarOpening.open === '$' && isCurrencyLiteralContent(content)) {
          output += '\\$' + content + '\\$';
        } else {
          output += source.slice(index, end);
        }
        index = end;
        continue;
      }
    }

    const opening = codeMasked.startsWith('\\(', index) || codeMasked.startsWith('\\[', index);
    const parsed = opening ? parseMathDelimiterAt(codeMasked, index) : null;

    if (!parsed) {
      output += source[index];
      index += 1;
      continue;
    }

    const rawContent = source.slice(index + 2, parsed.end - 2);
    output += parsed.display ? '$$' + rawContent + '$$' : '$' + rawContent + '$';
    index = parsed.end;
  }

  return output;
}

/**
 * The native renderer has no image-disable prop. Replace Markdown image nodes
 * with their alt text in the presentation copy so no remote image is fetched.
 * Code spans/fences are left byte-for-byte unchanged.
 */
export function stripMarkdownImages(source: string): string {
  return stripMarkdownImagesAtDepth(source, 0);
}

function stripMarkdownImagesAtDepth(source: string, depth: number): string {
  if (depth >= 32) {
    // Refuse to expose a pathological nested image opener to the native parser.
    return source.replace(/!\[/gu, '\\[');
  }

  const codeMasked = maskMarkdownCode(source);
  let output = '';
  let index = 0;

  while (index < source.length) {
    if (
      codeMasked[index] !== '!' ||
      codeMasked[index + 1] !== '[' ||
      isEscapedMarkdownDelimiter(source, index)
    ) {
      output += source[index];
      index += 1;
      continue;
    }

    const altEnd = findMatchingBracket(source, index + 1, '[', ']');
    if (altEnd < 0) {
      // A malformed image opener must not be interpreted as an image.
      index += 1;
      continue;
    }

    output += stripMarkdownImagesAtDepth(source.slice(index + 2, altEnd), depth + 1);
    const following = altEnd + 1;
    const suffix = source[following];

    if (suffix === '(' || suffix === '[') {
      const closing = suffix === '(' ? ')' : ']';
      const suffixEnd = findMatchingBracket(source, following, suffix, closing);
      index = suffixEnd >= 0 ? suffixEnd + 1 : following;
    } else {
      // Also neutralize shortcut-reference image syntax.
      index = following;
    }
  }

  return output;
}

function findMatchingBracket(
  source: string,
  openingIndex: number,
  opening: '[' | '(',
  closing: ']' | ')',
): number {
  let depth = 0;

  for (let index = openingIndex; index < source.length; index += 1) {
    if (isEscapedMarkdownDelimiter(source, index)) continue;
    if (source[index] === opening) depth += 1;
    else if (source[index] === closing) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}
