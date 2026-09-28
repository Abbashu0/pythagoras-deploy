import {
  findMathClosingDelimiter,
  isEscapedMarkdownDelimiter,
  isCurrencyLiteralContent,
  maskMarkdownCode,
  mathOpeningAt,
  parseMathDelimiterAt,
} from './math-delimiters';

/**
 * Build presentation-only Markdown for react-native-enriched-markdown.
 * Original assistant content is never mutated or replaced in chat state.
 */
export function prepareEnrichedMarkdownInput(source: string): string {
  return normalizeAlternateMathDelimiters(stripMarkdownImages(source));
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
