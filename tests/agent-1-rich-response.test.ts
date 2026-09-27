import assert from 'node:assert/strict';
import test from 'node:test';
import MarkdownIt from '../mobile/node_modules/markdown-it';
import type { ASTNode } from '../mobile/node_modules/@ronradtke/react-native-markdown-display';
import { sealIncompleteMarkdown } from '../mobile/node_modules/@ronradtke/react-native-markdown-display/dist/lib/view/util/sealIncompleteMarkdown';
import { AGENT_1_MATH_CORPUS } from './fixtures/agent-1-math-corpus';
import { hideUnclosedMathSuffix, parseMathDelimiterAt } from '../mobile/src/ai/rich-response/math-delimiters';
import { agent1MathMarkdownPlugin, isSafeAgent1Link } from '../mobile/src/ai/rich-response/math-markdown-plugin';
import { getInlineMathAttachmentMetrics, renderTexToSvg } from '../mobile/src/ai/rich-response/mathjax-svg';
import {
  type DirectionTextNode,
  firstStrongTextDirection,
  resolveDirectionalLayoutDirection,
  resolveDirectionalListFlow,
  resolveDirectionalTextStyle,
  textFromDirectionNodes,
} from '../mobile/src/ai/rich-response/text-direction';
import { stabilizeNodeKey } from '../mobile/src/ai/rich-response/stable-markdown-keys';

function makeParser() {
  return new MarkdownIt({ html: false, linkify: false }).use(agent1MathMarkdownPlugin);
}

test('fixture corpus renders all 55 requested TeX categories to local SVG', () => {
  assert.equal(AGENT_1_MATH_CORPUS.length, 55);
  for (const fixture of AGENT_1_MATH_CORPUS) {
    const result = renderTexToSvg(fixture.tex, false);
    assert.ok(result, `${fixture.category} should render`);
    assert.match(result.svg, /<svg\b/u, `${fixture.category} should return SVG`);
    assert.ok(result.widthEx > 0 && result.heightEx > 0, `${fixture.category} dimensions should be valid`);
  }

  const display = renderTexToSvg(String.raw`\boxed{\begin{aligned}x+y&=2\\x-y&=0\end{aligned}}`, true);
  assert.ok(display, 'display-mode aligned equations should render');
  assert.match(display.svg, /<svg\b/u);
});

test('malformed and oversized TeX fail safely for plain-text fallback', () => {
  assert.equal(renderTexToSvg(String.raw`\notARealCommand{x}`, false), null);
  assert.equal(renderTexToSvg('x'.repeat(8_001), false), null);
});

test('inline SVG attachment metrics reserve MathJax baseline depth', () => {
  const formulas = ['F(x)', 'f(x)', 'x^3', 'x_i^2', String.raw`\frac{x^3}{f(x)}`];
  const results = formulas.map((formula) => renderTexToSvg(formula, false));
  assert.ok(results.every((result) => result !== null));
  assert.ok(results.some((result) => result?.verticalAlignEx !== 0));

  for (const result of results) {
    assert.ok(result);
    const metrics = getInlineMathAttachmentMetrics(result, 18);
    const pointsPerEx = 9;
    const verticalAlign = result.verticalAlignEx * pointsPerEx;
    const expectedSvgHeight = Math.ceil(result.heightEx * pointsPerEx);
    const expectedAttachmentHeight = expectedSvgHeight + Math.ceil(Math.max(0, -verticalAlign));
    assert.equal(metrics.width, Math.ceil(result.widthEx * pointsPerEx));
    assert.equal(metrics.svgHeight, expectedSvgHeight);
    assert.equal(metrics.attachmentHeight, expectedAttachmentHeight);
    assert.equal(metrics.translateY, expectedAttachmentHeight - expectedSvgHeight - verticalAlign);
    assert.ok(
      Math.abs(metrics.translateY + metrics.svgHeight - metrics.attachmentHeight + verticalAlign) < 1e-9,
      'the SVG baseline offset must preserve MathJax vertical-align relative to the native attachment baseline',
    );
    if (verticalAlign < 0) assert.ok(metrics.attachmentHeight > metrics.svgHeight);
  }
});

test('math parser supports inline and multiline display delimiters without changing source', () => {
  const inline = parseMathDelimiterAt('Solve $x^2=4$ now', 6);
  assert.equal(inline?.content, 'x^2=4');
  assert.equal(inline?.raw, '$x^2=4$');
  assert.equal(inline?.display, false);

  const parser = makeParser();
  const tokens = parser.parse('Before\n\n$$\nx=2\n$$\n\nAfter', {});
  const mathBlock = tokens.find((token) => token.type === 'agent1_math_block');
  assert.equal(mathBlock?.content, 'x=2');
  assert.equal(mathBlock?.block, true);

  const unclosedBeforeFence = parser.parse('$$\nx\n```ts\nconst y = 1\n$$\n```', {});
  assert.equal(unclosedBeforeFence.some((token) => token.type === 'agent1_math_block'), false);
});

test('streaming hides only an unfinished TeX suffix and leaves currency/code alone', () => {
  assert.equal(hideUnclosedMathSuffix('Answer $x +'), 'Answer ');
  assert.equal(hideUnclosedMathSuffix('Cost is $20 and `$x` is code'), 'Cost is $20 and `$x` is code');
  assert.equal(hideUnclosedMathSuffix('Use `price $20` in code'), 'Use `price $20` in code');
  assert.equal(hideUnclosedMathSuffix('Price is $20 USD'), 'Price is $20 USD');
  assert.equal(parseMathDelimiterAt('The literal is $20$', 15), null);
  assert.equal(parseMathDelimiterAt('Spend $20 and $30 today', 6), null);
});

test('streaming Markdown reparses incomplete emphasis, fences, tables, and math safely', () => {
  const parser = makeParser();
  const early = parser.parse('A **par', {});
  const later = parser.parse('A **paragraph**', {});
  assert.ok(early.length > 0 && later.length > 0);
  assert.ok(
    later.some((token) => token.type === 'inline' && token.children?.some((child) => child.type === 'strong_open')),
  );

  const openFence = sealIncompleteMarkdown('```ts\nconst x = 1');
  assert.match(openFence, /```ts\nconst x = 1\n```$/u);
  assert.ok(parser.parse(openFence, {}).some((token) => token.type === 'fence'));
  assert.equal(hideUnclosedMathSuffix('Result: \\(x +'), 'Result: ');

  const table = parser.parse('| A | B |\n| - | - |\n| 1 | 2 |', {});
  assert.ok(table.some((token) => token.type === 'table_open'));
});

test('markdown math plugin ignores escaped markers and markdown code regions', () => {
  const parser = makeParser();
  const escaped = parser.parse(String.raw`Keep \$x$ literal`, {});
  assert.equal(escaped.some((token) => token.type === 'agent1_math_inline'), false);

  const code = parser.parse('`$x$`\n\n```tex\n$y$\n```', {});
  assert.equal(code.some((token) => token.type === 'agent1_math_inline'), false);
  assert.equal(code.some((token) => token.type === 'agent1_math_block'), false);
});

test('raw HTML is not emitted as executable Markdown tokens', () => {
  const tokens = makeParser().parse('<script>alert(1)</script>', {});
  assert.equal(tokens.some((token) => token.type === 'html_block'), false);
  const inline = tokens.find((token) => token.type === 'inline');
  assert.equal(inline?.children?.some((token) => token.type === 'html_inline'), false);
});

test('links allow only safe HTTP and HTTPS targets', () => {
  assert.equal(isSafeAgent1Link('https://example.com/path?q=1'), true);
  assert.equal(isSafeAgent1Link('http://example.com'), true);
  assert.equal(isSafeAgent1Link('javascript:alert(1)'), false);
  assert.equal(isSafeAgent1Link('data:text/html,hello'), false);
  assert.equal(isSafeAgent1Link('file:///etc/passwd'), false);
  assert.equal(isSafeAgent1Link('//example.com'), false);

  const parser = new MarkdownIt({ html: false, linkify: false });
  parser.validateLink = isSafeAgent1Link;
  parser.use(agent1MathMarkdownPlugin);
  const inline = parser.parse('[unsafe](javascript:alert(1)) [safe](https://example.com)', {}).find((token) => token.type === 'inline');
  assert.equal(inline?.children?.filter((token) => token.type === 'link_open').length, 1);
  assert.equal(inline?.children?.find((token) => token.type === 'link_open')?.attrs?.[0]?.[1], 'https://example.com');
});

test('paragraph direction follows the first strong Arabic or Latin letter without editing content', () => {
  assert.equal(firstStrongTextDirection('مرحبا 123 API'), 'rtl');
  assert.equal(firstStrongTextDirection('... 25 Hello مرحبا'), 'ltr');
  assert.equal(firstStrongTextDirection('إذا كانت F(x) دالة ومشتقتها f(x)، فإن:'), 'rtl');
  assert.equal(firstStrongTextDirection('API يعمل الآن'), 'ltr');
  assert.equal(firstStrongTextDirection('API response is جاهز'), 'ltr');
  assert.equal(firstStrongTextDirection('123 + 456'), 'auto');
});

test('direction resolves to actual native Text base direction and alignment', () => {
  assert.deepEqual(resolveDirectionalTextStyle('rtl'), { writingDirection: 'rtl', textAlign: 'right' });
  assert.deepEqual(resolveDirectionalTextStyle('ltr'), { writingDirection: 'ltr', textAlign: 'left' });
  assert.deepEqual(resolveDirectionalTextStyle('auto'), { writingDirection: 'auto', textAlign: 'auto' });
  assert.equal(resolveDirectionalLayoutDirection('rtl'), 'rtl');
  assert.equal(resolveDirectionalLayoutDirection('ltr'), 'ltr');
  assert.equal(resolveDirectionalLayoutDirection('auto'), 'inherit');
  assert.deepEqual(resolveDirectionalListFlow('rtl'), {
    direction: 'rtl',
    flexDirection: 'row',
    justifyContent: 'flex-start',
  });
  assert.deepEqual(resolveDirectionalListFlow('ltr'), {
    direction: 'ltr',
    flexDirection: 'row',
    justifyContent: 'flex-start',
  });
});

test('inline math is excluded while Arabic prose establishes paragraph direction', () => {
  const inlineContent = {
    type: 'inline',
    children: [
      { type: 'textgroup', children: [{ type: 'text', content: 'إذا كانت ' }] },
      { type: 'agent1_math_inline', content: 'F(x)' },
      { type: 'textgroup', children: [{ type: 'text', content: ' دالة ومشتقتها ' }] },
      { type: 'agent1_math_inline', content: 'f(x)' },
    ],
  } as const;
  const proseForDirection = textFromDirectionNodes(inlineContent);
  assert.equal(proseForDirection, 'إذا كانت  دالة ومشتقتها ');
  assert.equal(firstStrongTextDirection(proseForDirection), 'rtl');
});

test('mixed inline Markdown regressions stay in prose runs with block first-strong direction', () => {
  const fixtures = [
    { markdown: 'إذا كانت عندك دالة $F(x)$، فإن مشتقتها $f(x)$.', direction: 'rtl', mathCount: 2 },
    { markdown: 'لأن مشتقته $x^3$.', direction: 'rtl', mathCount: 1 },
    { markdown: 'إذا كانت $F(x)$ دالة، فإن:\n$F\'(x)=f(x)$', direction: 'rtl', mathCount: 2 },
    { markdown: '**المشتقة** لـ $F(x)$ هي $f(x)$.', direction: 'rtl', mathCount: 2 },
    { markdown: 'راجع [هذا المصدر](https://example.com) للمزيد.', direction: 'rtl', mathCount: 0 },
    { markdown: '- حساب المساحة تحت المنحنى $x^3$.', direction: 'rtl', mathCount: 1 },
    { markdown: 'If $F(x)$ is smooth, then $f(x)$ is its derivative.', direction: 'ltr', mathCount: 2 },
    { markdown: '$x^3$', direction: 'auto', mathCount: 1 },
  ] as const;

  const parser = makeParser();
  for (const fixture of fixtures) {
    const tokens = parser.parse(fixture.markdown, {});
    const inlineTokens = tokens.filter((token) => token.type === 'inline');
    const mathCount = inlineTokens.reduce(
      (count, token) => count + (token.children?.filter((child) => child.type === 'agent1_math_inline').length ?? 0),
      0,
    );
    const directionSource = inlineTokens
      .map((token) => textFromDirectionNodes(tokenToDirectionNode(token)))
      .join(' ');

    assert.equal(mathCount, fixture.mathCount, fixture.markdown);
    assert.equal(firstStrongTextDirection(directionSource), fixture.direction, fixture.markdown);
    assert.equal(tokens.some((token) => token.type === 'agent1_math_block'), false, fixture.markdown);
  }
});

test('streaming Markdown node keys remain stable when later blocks are appended', () => {
  const node = (type: string, key: string, children: ASTNode[] = []): ASTNode => ({
    type,
    sourceType: type,
    sourceInfo: null,
    sourceMeta: null,
    block: true,
    key,
    content: '',
    markup: '',
    tokenIndex: 0,
    index: 0,
    attributes: {},
    children,
  });
  const first = stabilizeNodeKey(node('paragraph', 'volatile'), 'turn-1', [0]);
  const reparsedFirst = stabilizeNodeKey(node('paragraph', 'different-volatile'), 'turn-1', [0]);
  const second = stabilizeNodeKey(node('paragraph', 'new'), 'turn-1', [1]);
  assert.equal(first.key, reparsedFirst.key);
  assert.notEqual(first.key, second.key);
});

function tokenToDirectionNode(token: {
  type: string;
  content: string;
  children?: readonly { type: string; content: string; children?: readonly unknown[] }[] | null;
}): DirectionTextNode {
  return {
    type: token.type,
    content: token.content,
    children: token.children?.map((child) => tokenToDirectionNode(child as Parameters<typeof tokenToDirectionNode>[0])),
  };
}
