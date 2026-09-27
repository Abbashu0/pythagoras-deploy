export interface ParsedMathDelimiter {
  content: string;
  display: boolean;
  end: number;
  raw: string;
}

interface DelimiterSpec {
  open: string;
  close: string;
  display: boolean;
  dollar: boolean;
}

const INLINE_AND_DISPLAY_DELIMITERS: readonly DelimiterSpec[] = [
  { open: "$$", close: "$$", display: true, dollar: true },
  { open: "\\[", close: "\\]", display: true, dollar: false },
  { open: "\\(", close: "\\)", display: false, dollar: false },
  { open: "$", close: "$", display: false, dollar: true },
];

const CURRENCY_WORDS =
  "USD|EUR|GBP|CAD|AUD|IQD|SAR|AED|dollars?|dinars?|and|or";
const CURRENCY_LITERAL = new RegExp(
  `^\\s*\\d[\\d,]*(?:\\.\\d+)?(?:\\s+(?:${CURRENCY_WORDS}))?\\s*$`,
  "iu",
);
const CURRENCY_PREFIX = new RegExp(
  `^\\s*\\d[\\d,]*(?:\\.\\d+)?(?:\\s+(?:${CURRENCY_WORDS}))?(?:\\s|$)`,
  "iu",
);

export function parseMathDelimiterAt(
  source: string,
  start: number,
): ParsedMathDelimiter | null {
  const delimiter = getDelimiterAt(source, start);
  if (!delimiter) return null;

  const close = findUnescapedDelimiter(
    source,
    delimiter.close,
    start + delimiter.open.length,
  );
  if (close < 0) return null;

  const content = source.slice(start + delimiter.open.length, close).trim();
  if (!content || (delimiter.open === "$" && isCurrencyLiteral(content))) return null;

  const end = close + delimiter.close.length;
  return {
    content,
    display: delimiter.display,
    end,
    raw: source.slice(start, end),
  };
}

export function mathOpeningAt(source: string, start: number): DelimiterSpec | null {
  return getDelimiterAt(source, start);
}

export function findMathClosingDelimiter(
  source: string,
  delimiter: string,
  start: number,
): number {
  return findUnescapedDelimiter(source, delimiter, start);
}

export function isEscapedMarkdownDelimiter(source: string, index: number): boolean {
  let backslashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
}

/**
 * Hide only an unfinished TeX suffix while the model is streaming. The source
 * message remains untouched; this presentation-only prefix prevents half of a
 * formula from flashing as ordinary prose between deltas.
 */
export function hideUnclosedMathSuffix(source: string): string {
  const codeMasked = maskMarkdownCode(source);
  let index = 0;

  while (index < codeMasked.length) {
    const delimiter = getDelimiterAt(codeMasked, index);
    if (!delimiter) {
      index += 1;
      continue;
    }

    const close = findUnescapedDelimiter(
      codeMasked,
      delimiter.close,
      index + delimiter.open.length,
    );
    if (close >= 0) {
      const mathContent = codeMasked.slice(index + delimiter.open.length, close);
      if (delimiter.open === "$" && isCurrencyLiteral(mathContent)) {
        index = close + delimiter.close.length;
        continue;
      }
      index = close + delimiter.close.length;
      continue;
    }

    if (delimiter.open === "$" && isCurrencyPrefix(codeMasked.slice(index + 1))) {
      index += 1;
      continue;
    }

    return source.slice(0, index);
  }

  return source;
}

function getDelimiterAt(source: string, start: number): DelimiterSpec | null {
  if (start < 0 || start >= source.length || isEscapedMarkdownDelimiter(source, start)) {
    return null;
  }

  return (
    INLINE_AND_DISPLAY_DELIMITERS.find((delimiter) =>
      source.startsWith(delimiter.open, start),
    ) ?? null
  );
}

function findUnescapedDelimiter(source: string, delimiter: string, start: number): number {
  let cursor = source.indexOf(delimiter, start);
  while (cursor >= 0) {
    if (!isEscapedMarkdownDelimiter(source, cursor)) {
      // A single-dollar opener must not consume half of a `$$...$$` display.
      if (delimiter !== "$" || !source.startsWith("$$", cursor)) return cursor;
    }
    cursor = source.indexOf(delimiter, cursor + delimiter.length);
  }
  return -1;
}

function isCurrencyLiteral(value: string): boolean {
  return CURRENCY_LITERAL.test(value);
}

function isCurrencyPrefix(value: string): boolean {
  return CURRENCY_PREFIX.test(value);
}

function maskMarkdownCode(source: string): string {
  const masked = source.split("");
  const lines = source.split("\n");
  let offset = 0;
  let fenceCharacter: "`" | "~" | null = null;
  let fenceLength = 0;
  let inlineCodeLength = 0;

  for (const line of lines) {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceCharacter) {
      maskRange(masked, offset, offset + line.length);
      if (
        fenceMatch &&
        fenceMatch[1][0] === fenceCharacter &&
        fenceMatch[1].length >= fenceLength &&
        line.slice(fenceMatch[0].length).trim().length === 0
      ) {
        fenceCharacter = null;
        fenceLength = 0;
      }
      offset += line.length + 1;
      continue;
    }

    if (fenceMatch?.[1]) {
      fenceCharacter = fenceMatch[1][0] as "`" | "~";
      fenceLength = fenceMatch[1].length;
      maskRange(masked, offset, offset + line.length);
      offset += line.length + 1;
      continue;
    }

    let cursor = 0;
    while (cursor < line.length) {
      if (inlineCodeLength > 0) {
        const close = findBacktickRun(line, cursor, inlineCodeLength);
        if (close < 0) {
          maskRange(masked, offset + cursor, offset + line.length);
          break;
        }
        maskRange(masked, offset + cursor, offset + close + inlineCodeLength);
        cursor = close + inlineCodeLength;
        inlineCodeLength = 0;
        continue;
      }

      if (line[cursor] !== "`" || isEscapedMarkdownDelimiter(line, cursor)) {
        cursor += 1;
        continue;
      }

      let runLength = 1;
      while (line[cursor + runLength] === "`") runLength += 1;
      const close = findBacktickRun(line, cursor + runLength, runLength);
      if (close < 0) {
        inlineCodeLength = runLength;
        maskRange(masked, offset + cursor, offset + line.length);
        break;
      }

      maskRange(masked, offset + cursor, offset + close + runLength);
      cursor = close + runLength;
    }

    offset += line.length + 1;
  }

  return masked.join("");
}

function findBacktickRun(source: string, start: number, length: number): number {
  let cursor = source.indexOf("`", start);
  while (cursor >= 0) {
    let runLength = 1;
    while (source[cursor + runLength] === "`") runLength += 1;
    if (runLength === length && !isEscapedMarkdownDelimiter(source, cursor)) return cursor;
    cursor = source.indexOf("`", cursor + runLength);
  }
  return -1;
}

function maskRange(target: string[], start: number, end: number): void {
  for (let index = Math.max(0, start); index < Math.min(end, target.length); index += 1) {
    if (target[index] !== "\n" && target[index] !== "\r") target[index] = " ";
  }
}
