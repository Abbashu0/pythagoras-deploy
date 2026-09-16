import assert from "node:assert/strict";
import test from "node:test";
import katex from "katex";

import {
  neutralizeEphemeralMathFallbacks,
  normalizeEphemeralMathDelimiters,
  type EphemeralMarkdownNode,
} from "../src/lib/ephemeral-chat-markdown";

test("normalizes parenthesized and bracketed math outside Markdown code", () => {
  assert.equal(
    normalizeEphemeralMathDelimiters("(x^2 + y^2 = z^2)"),
    "$x^2 + y^2 = z^2$",
  );
  const bracketed = String.raw`[
\operatorname{tr}(A^{-1})
=========================
-\frac{1319806}{19879167}
]`;
  assert.equal(
    normalizeEphemeralMathDelimiters(bracketed),
    String.raw`$$
\operatorname{tr}(A^{-1})
=========================
-\frac{1319806}{19879167}
$$`,
  );
});

test("preserves native dollar delimiters and code spans/fences", () => {
  assert.equal(
    normalizeEphemeralMathDelimiters("$x^2$\n\n$$\\det(A)$$"),
    "$x^2$\n\n$$\\det(A)$$",
  );
  const fenced = "```python\nlatex = r\"\\frac{1}{2}\"\n```";
  assert.equal(normalizeEphemeralMathDelimiters(fenced), fenced);
  assert.equal(
    normalizeEphemeralMathDelimiters(String.raw`\(\frac{1}{2}\)`),
    String.raw`$\frac{1}{2}$`,
  );
  const escapedBackslashes = String.raw`\\(x^2\\)`;
  assert.equal(normalizeEphemeralMathDelimiters(escapedBackslashes), escapedBackslashes);
  const inlineCode = "`\\(\\frac{1}{2}\\)`";
  assert.equal(normalizeEphemeralMathDelimiters(inlineCode), inlineCode);
});

test("normalizes mixed Arabic/English math and leaves incomplete math safe", () => {
  assert.equal(
    normalizeEphemeralMathDelimiters(String.raw`The answer is (\frac{1}{2}).`),
    String.raw`The answer is $\frac{1}{2}$.`,
  );
  assert.equal(
    normalizeEphemeralMathDelimiters(String.raw`النتيجة هي (\frac{1}{2}).`),
    String.raw`النتيجة هي $\frac{1}{2}$.`,
  );
  assert.equal(normalizeEphemeralMathDelimiters("(x^2"), "(x^2");
});

test("normalizes a matrix display without changing its TeX body", () => {
  const source = String.raw`[
A = \begin{pmatrix}
1 & 2 \\
3 & 4
\end{pmatrix}
]`;
  const normalized = normalizeEphemeralMathDelimiters(source);
  assert.equal(normalized.startsWith("$$\n"), true);
  assert.equal(normalized.endsWith("\n$$"), true);
  assert.match(normalized, /\\begin\{pmatrix\}/u);
});

test("does not create nested dollar delimiters or repair malformed Model math", () => {
  const malformedFixtures = [
    String.raw`\boxed{\\,p$\lambda$=\lambda^4...`,
    String.raw`\operatorname{tr}$A^{-1}$=4`,
    "frac{20}{5}",
  ];

  for (const fixture of malformedFixtures) {
    assert.equal(normalizeEphemeralMathDelimiters(fixture), fixture);
  }

  const mixedAlternate = String.raw`\[\boxed{\\,p$\lambda$=\lambda^4...\]`;
  assert.equal(normalizeEphemeralMathDelimiters(mixedAlternate), mixedAlternate);

  const existingDollarMath = String.raw`$f(x^2)=x^4$`;
  assert.equal(normalizeEphemeralMathDelimiters(existingDollarMath), existingDollarMath);
});

test("valid equations and matrices remain KaTeX-renderable", () => {
  const validBodies = [
    String.raw`\det(A)=5`,
    String.raw`\lambda=\frac{5+\sqrt5}{2}`,
    String.raw`A^{-1}=\frac15\begin{pmatrix}4&-3&2&-1\\-3&6&-4&2\\2&-4&6&-3\\-1&2&-3&4\end{pmatrix}`,
  ];

  for (const body of validBodies) {
    const html = katex.renderToString(body, {
      displayMode: true,
      throwOnError: true,
    });
    assert.doesNotMatch(html, /katex-error/u);
  }
});

test("KaTeX parse errors become neutral source fallbacks without poisoning siblings", () => {
  const malformed = String.raw`\boxed{\frac{1}{2}`;
  const katexHtml = katex.renderToString(malformed, {
    displayMode: true,
    throwOnError: false,
  });
  assert.match(katexHtml, /katex-error/u);

  const tree: EphemeralMarkdownNode = {
    type: "root",
    children: [
      { type: "element", tagName: "span", properties: { className: ["katex"] }, children: [] },
      {
        type: "element",
        tagName: "span",
        properties: {
          className: ["katex-error"],
          title: "ParseError: hidden from the operator",
          style: "color:#cc0000",
        },
        children: [{ type: "text", value: malformed }],
      },
      { type: "element", tagName: "span", properties: { className: ["katex"] }, children: [] },
    ],
  };

  neutralizeEphemeralMathFallbacks(tree);
  const errorNode = tree.children?.[1];
  assert.equal(errorNode?.type, "element");
  assert.deepEqual(errorNode?.properties?.className, ["ephemeral-math-fallback"]);
  assert.equal(errorNode?.properties?.title, undefined);
  assert.equal(errorNode?.properties?.style, undefined);
  assert.equal(errorNode?.children?.[0]?.value, malformed);
  assert.deepEqual(tree.children?.[0]?.properties?.className, ["katex"]);
  assert.deepEqual(tree.children?.[2]?.properties?.className, ["katex"]);
});
