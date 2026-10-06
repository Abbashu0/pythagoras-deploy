import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { CHAT_BOTTOM_FADE_LOCATIONS, CHAT_TOP_FADE_LOCATIONS, chatBackgroundWithAlpha, chatBottomFadeHeight, chatEdgeFadeColors } from "../mobile/src/ai/chat-edge-fade";

test("fade colors preserve the real palette RGB at transparent ends in both themes", () => {
  // Root tests must not pull the Mobile project's @/ alias graph into root tsc.
  // Read its actual token literals, rather than duplicating those colors here.
  const text = readFileSync(new URL("../mobile/src/theme.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("theme.ts", text, ts.ScriptTarget.Latest, true);
  const backgrounds: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'background' && ts.isStringLiteral(node.initializer)) backgrounds.push(node.initializer.text);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.equal(backgrounds.length, 2);
  for (const background of backgrounds) {
    const colors = chatEdgeFadeColors(background);
    const transparent = chatBackgroundWithAlpha(background, 0);
    const opaque = chatBackgroundWithAlpha(background, 1);
    assert.equal(colors.top.at(-1), transparent);
    assert.equal(colors.top[0], opaque);
    assert.equal(colors.bottom[0], transparent);
    assert.equal(colors.bottom.at(-1), opaque);
    assert.equal(colors.top.every(color => color.startsWith(transparent.slice(0, transparent.lastIndexOf(',')))), true);
  }
  assert.throws(() => chatBackgroundWithAlpha('not-a-palette-color', 0.5));
});
test("fade stops have transparent boundaries and strictly increasing positions without a clipping plateau", () => {
  for (const locations of [CHAT_TOP_FADE_LOCATIONS, CHAT_BOTTOM_FADE_LOCATIONS]) {
    assert.equal(locations[0], 0); assert.equal(locations.at(-1), 1);
    for (let i = 1; i < locations.length; i++) assert.ok(locations[i] > locations[i - 1]);
  }
});
test("bottom fade starts the same gap above the measured Composer throughout native keyboard movement", () => {
  const viewport = 900, keyboard = 310, safeArea = 34, gap = 24;
  for (const hostHeight of [104, 160, 220]) {
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      const fadeHeight = chatBottomFadeHeight(hostHeight + safeArea, safeArea, progress, gap);
      const fadeTop = viewport - keyboard * progress - fadeHeight;
      const composerTop = viewport - hostHeight - keyboard * progress - safeArea * (1 - progress);
      assert.equal(composerTop - fadeTop, gap);
    }
  }
  assert.equal(chatBottomFadeHeight(138, 34, 0, 24), 162);
  assert.equal(chatBottomFadeHeight(138, 34, 1, 24), 128);
});
