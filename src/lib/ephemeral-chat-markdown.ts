/**
 * Normalizes the alternate math delimiters frequently emitted by Models while
 * leaving Markdown code spans and fenced code blocks byte-for-byte unchanged.
 */
export function normalizeEphemeralMathDelimiters(markdown: string): string {
  let output = "";
  let index = 0;
  let fencedMarker: "`" | "~" | null = null;
  let fencedLength = 0;

  while (index < markdown.length) {
    if (fencedMarker) {
      const closing = isLineStart(markdown, index)
        ? readFence(markdown, index, fencedMarker, fencedLength)
        : null;
      if (closing) {
        output += closing.text;
        index = closing.end;
        fencedMarker = null;
        fencedLength = 0;
        continue;
      }
      output += markdown[index];
      index += 1;
      continue;
    }

    if (isLineStart(markdown, index)) {
      const fence = readFence(markdown, index);
      if (fence) {
        output += fence.text;
        index = fence.end;
        fencedMarker = fence.marker;
        fencedLength = fence.length;
        continue;
      }
    }

    if (markdown[index] === "`") {
      const runLength = countRun(markdown, index, "`");
      const marker = "`".repeat(runLength);
      const closingIndex = markdown.indexOf(marker, index + runLength);
      if (closingIndex < 0) {
        output += markdown.slice(index);
        break;
      }
      const end = closingIndex + runLength;
      output += markdown.slice(index, end);
      index = end;
      continue;
    }

    const nativeDollarMath = readNativeDollarMath(markdown, index);
    if (nativeDollarMath) {
      output += nativeDollarMath.replacement;
      index = nativeDollarMath.end;
      continue;
    }

    const escaped = readEscapedMath(markdown, index);
    if (escaped) {
      output += escaped.replacement;
      index = escaped.end;
      continue;
    }

    const unescaped = readUnescapedMath(markdown, index);
    if (unescaped) {
      output += unescaped.replacement;
      index = unescaped.end;
      continue;
    }

    output += markdown[index];
    index += 1;
  }

  return output;
}

function readEscapedMath(
  markdown: string,
  start: number,
): { replacement: string; end: number } | null {
  const pairs = [
    { open: "\\(", close: "\\)", display: false },
    { open: "\\[", close: "\\]", display: true },
  ] as const;
  for (const pair of pairs) {
    if (!markdown.startsWith(pair.open, start)) continue;
    if (!isUnescapedDelimiter(markdown, start)) continue;
    const close = findUnescapedSequence(markdown, start + pair.open.length, pair.close);
    if (close < 0) return null;
    const content = markdown.slice(start + pair.open.length, close);
    const end = close + pair.close.length;
    if (hasUnescapedDollar(content)) {
      return { replacement: markdown.slice(start, end), end };
    }
    if (!looksLikeMath(content)) return null;
    const trimmed = content.trim();
    return {
      replacement: pair.display ? `$$\n${trimmed}\n$$` : `$${trimmed}$`,
      end,
    };
  }
  return null;
}

function readNativeDollarMath(
  markdown: string,
  start: number,
): { replacement: string; end: number } | null {
  if (markdown[start] !== "$" || !isUnescapedDelimiter(markdown, start)) return null;
  const delimiterLength = markdown.startsWith("$$", start) ? 2 : 1;
  const close = findUnescapedSequence(
    markdown,
    start + delimiterLength,
    "$".repeat(delimiterLength),
  );
  if (close < 0) {
    return { replacement: markdown.slice(start), end: markdown.length };
  }
  const end = close + delimiterLength;
  return { replacement: markdown.slice(start, end), end };
}

function readUnescapedMath(
  markdown: string,
  start: number,
): { replacement: string; end: number } | null {
  const open = markdown[start];
  if (open !== "(" && open !== "[") return null;
  if (!isUnescapedMathOpening(markdown, start)) return null;
  const close = open === "(" ? ")" : "]";
  const closingIndex = findBalancedClosing(markdown, start, open, close);
  if (closingIndex < 0) return null;
  const content = markdown.slice(start + 1, closingIndex);
  const end = closingIndex + 1;
  if (hasUnescapedDollar(content)) {
    return { replacement: markdown.slice(start, end), end };
  }
  if (!looksLikeMath(content)) return null;
  const trimmed = content.trim();
  return {
    replacement: open === "[" ? `$$\n${trimmed}\n$$` : `$${trimmed}$`,
    end,
  };
}

function findBalancedClosing(
  markdown: string,
  start: number,
  open: string,
  close: string,
): number {
  if (!isUnescapedMathOpening(markdown, start)) return -1;
  let depth = 0;
  for (let index = start; index < markdown.length; index += 1) {
    if (markdown[index] === "\\") {
      index += 1;
      continue;
    }
    if (markdown[index] === open) depth += 1;
    if (markdown[index] === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findUnescapedSequence(
  markdown: string,
  start: number,
  sequence: string,
): number {
  let index = markdown.indexOf(sequence, start);
  while (index >= 0) {
    if (isUnescapedDelimiter(markdown, index)) return index;
    index = markdown.indexOf(sequence, index + sequence.length);
  }
  return -1;
}

function isUnescapedDelimiter(markdown: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && markdown[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 0;
}

function isUnescapedMathOpening(markdown: string, index: number): boolean {
  return markdown[index - 1] !== "\\";
}

function hasUnescapedDollar(content: string): boolean {
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "$" && isUnescapedDelimiter(content, index)) return true;
  }
  return false;
}

function looksLikeMath(content: string): boolean {
  return /\\[A-Za-z]+|[=^_]|\d\s*[+\-*/]\s*\d|\\begin\s*\{/u.test(content);
}

export interface EphemeralMarkdownNode {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: EphemeralMarkdownNode[];
}

/**
 * Converts rehype-katex parse-error nodes into neutral source fallbacks.
 * The node children are deliberately retained so malformed Model output stays
 * visible without exposing KaTeX's parser message or its red inline style.
 */
export function rehypeEphemeralMathFallback() {
  return (tree: EphemeralMarkdownNode): void => {
    neutralizeEphemeralMathFallbacks(tree);
  };
}

export function neutralizeEphemeralMathFallbacks(
  tree: EphemeralMarkdownNode,
): void {
  for (const child of tree.children ?? []) {
    if (child.type === "element" && child.tagName === "span") {
      const classNames = readClassNames(child.properties?.className);
      if (classNames.includes("katex-error")) {
        const properties = { ...(child.properties ?? {}) };
        delete properties.title;
        delete properties.style;
        properties.className = [
          ...classNames.filter((className) => className !== "katex-error"),
          "ephemeral-math-fallback",
        ];
        child.properties = properties;
      }
    }
    neutralizeEphemeralMathFallbacks(child);
  }
}

function readClassNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return typeof value === "string" ? value.split(/\s+/u).filter(Boolean) : [];
}

function isLineStart(markdown: string, index: number): boolean {
  return index === 0 || markdown[index - 1] === "\n";
}

function readFence(
  markdown: string,
  start: number,
  expectedMarker?: "`" | "~",
  expectedLength?: number,
): { marker: "`" | "~"; length: number; text: string; end: number } | null {
  let index = start;
  let spaces = 0;
  while (spaces < 3 && markdown[index] === " ") {
    index += 1;
    spaces += 1;
  }
  const marker = markdown[index];
  if (marker !== "`" && marker !== "~") return null;
  const length = countRun(markdown, index, marker);
  if (length < 3) return null;
  if (expectedMarker && (marker !== expectedMarker || length < (expectedLength ?? 3))) {
    return null;
  }
  const newline = markdown.indexOf("\n", index + length);
  const end = newline < 0 ? markdown.length : newline + 1;
  return { marker, length, text: markdown.slice(start, end), end };
}

function countRun(markdown: string, start: number, value: string): number {
  let length = 0;
  while (markdown[start + length] === value) length += 1;
  return length;
}
