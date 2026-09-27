import type MarkdownIt from 'markdown-it';
import type { MarkdownItPlugin } from '@ronradtke/react-native-markdown-display';

import {
  findMathClosingDelimiter,
  mathOpeningAt,
  parseMathDelimiterAt,
} from './math-delimiters';

type MathTokenMeta = {
  display: boolean;
  raw: string;
};

export const agent1MathMarkdownPlugin: MarkdownItPlugin = (markdownIt: MarkdownIt) => {
  markdownIt.inline.ruler.before('escape', 'agent1_math_inline', (state, silent) => {
    const parsed = parseMathDelimiterAt(state.src, state.pos);
    if (!parsed || parsed.display) return false;

    if (!silent) {
      const token = state.push('agent1_math_inline', '', 0);
      token.content = parsed.content;
      token.meta = { display: false, raw: parsed.raw } satisfies MathTokenMeta;
    }

    state.pos = parsed.end;
    return true;
  });

  markdownIt.block.ruler.before(
    'fence',
    'agent1_math_block',
    (state, startLine, endLine, silent) => {
      const lineStart = state.bMarks[startLine] + state.tShift[startLine];
      const delimiter = mathOpeningAt(state.src, lineStart);
      if (!delimiter?.display || (delimiter.open !== '$$' && delimiter.open !== '\\[')) {
        return false;
      }

      const contentStart = lineStart + delimiter.open.length;
      const close = findMathClosingDelimiter(state.src, delimiter.close, contentStart);
      if (close < 0) return false;

      const closeEnd = close + delimiter.close.length;
      let closingLine = startLine;
      while (closingLine < endLine && state.eMarks[closingLine] < closeEnd) {
        closingLine += 1;
      }
      if (closingLine >= endLine) return false;

      for (let line = startLine + 1; line < closingLine; line += 1) {
        const content = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
        if (/^(?:`{3,}|~{3,})/u.test(content)) return false;
      }

      const trailingContent = state.src.slice(closeEnd, state.eMarks[closingLine]);
      if (trailingContent.trim().length > 0) return false;
      if (silent) return true;

      const raw = state.src.slice(lineStart, closeEnd);
      const token = state.push('agent1_math_block', '', 0);
      token.block = true;
      token.content = state.src.slice(contentStart, close).trim();
      token.markup = delimiter.open;
      token.meta = { display: true, raw } satisfies MathTokenMeta;
      token.map = [startLine, closingLine + 1];
      state.line = closingLine + 1;
      return true;
    },
    { alt: ['paragraph', 'reference', 'blockquote', 'list'] },
  );
};

export function isSafeAgent1Link(url: string): boolean {
  const normalized = url.trim();
  return /^https?:\/\//iu.test(normalized) && !/[\u0000-\u0020]/u.test(normalized);
}
