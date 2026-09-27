export type TextDirection = 'auto' | 'ltr' | 'rtl';

const RTL_LETTERS = /[\u05D0-\u05EA\u0621-\u063A\u0641-\u064A\u066E-\u066F\u0671-\u06D3\u06FA-\u06FC\u0710-\u072F\u0780-\u07A5\u0750-\u077F\u08A0-\u08C9\uFB50-\uFDFF\uFE70-\uFEFC]/u;
const LTR_LETTERS = /[A-Za-z\u00C0-\u02AF\u0370-\u052F]/u;

/** Detect only the paragraph's base alignment; never rewrites or reorders text. */
export function firstStrongTextDirection(value: string): TextDirection {
  for (const character of value) {
    if (RTL_LETTERS.test(character)) return 'rtl';
    if (LTR_LETTERS.test(character)) return 'ltr';
  }
  return 'auto';
}

export function textFromDirectionNodes(node: {
  type?: string;
  content?: string;
  children?: readonly { type?: string; content?: string; children?: readonly unknown[] }[];
}): string {
  if (node.type?.startsWith('agent1_math_')) return '';
  if (!node.children?.length) return node.content ?? '';
  return node.children
    .map((child) => textFromDirectionNodes(child as Parameters<typeof textFromDirectionNodes>[0]))
    .join('');
}
