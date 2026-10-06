import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describeChatTurnGeometry, chatGeometryDiagnosticKey } from "../mobile/src/ai/chat-layout-diagnostics";
import { agent1ReadingLineHeights } from "../mobile/src/ai/assistant-reading-rhythm";

test("overlap probe distinguishes actual RN row boundary from 26pt internal content gap", () => {
  const geometry = describeChatTurnGeometry({ turnId: "active", user: { y: 200, height: 50 }, assistant: { y: 250, height: 1000 } }, 26);
  assert.equal(geometry.assistantRowStartMinusUserBottom, 0);
  assert.equal(geometry.assistantStartMinusUserBottom, 26);
  assert.equal(geometry.assistantContentY, 276);
  assert.equal(geometry.overlapInvariantViolated, false);
  assert.equal(describeChatTurnGeometry({ turnId: "active", user: { y: 200, height: 50 }, assistant: { y: 230, height: 1000 } }, 26).overlapInvariantViolated, true);
});
test("probe retains unknown geometry until both rows measure and deduplicates subpixel noise", () => {
  assert.equal(describeChatTurnGeometry({ turnId: "active", user: null, assistant: null }, 26).assistantStartMinusUserBottom, null);
  assert.equal(chatGeometryDiagnosticKey({ y: 10.1, turnId: "active" }), chatGeometryDiagnosticKey({ y: 10.2, turnId: "active" }));
  assert.notEqual(chatGeometryDiagnosticKey({ y: 10.1 }), chatGeometryDiagnosticKey({ y: 11 }));
});

test("RN gap alone cannot certify visual spacing when a SwiftUI user surface is taller", () => {
  const mismatch = describeChatTurnGeometry({ turnId: "t", user: { y: 100, height: 20 }, nativeUserHeight: 50,
    assistant: { y: 120, height: 100 } }, 26);
  assert.equal(mismatch.assistantStartMinusUserBottom, 26);
  assert.equal(mismatch.userRNMinusNativeHeight, -30);
  assert.equal(mismatch.assistantStartMinusUserVisualBottom, -4);
  assert.equal(mismatch.userHostHeightMismatch, true);
  assert.equal(mismatch.visualGapInvariantViolated, true);
  const reconciled = describeChatTurnGeometry({ turnId: "t", user: { y: 100, height: 50 }, nativeUserHeight: 50,
    assistant: { y: 150, height: 100 } }, 26);
  assert.equal(reconciled.userRNMinusNativeHeight, 0);
  assert.equal(reconciled.assistantStartMinusUserVisualBottom, 26);
  assert.equal(reconciled.visualGapInvariantViolated, false);
  assert.equal(reconciled.userHostHeightMismatch, false);
});

test("unknown native user height is not reported as a measured visual gap", () => {
  const unknown = describeChatTurnGeometry({ turnId: "t", user: { y: 100, height: 50 }, assistant: { y: 150, height: 100 } }, 26);
  assert.equal(unknown.userNativeHostHeight, null);
  assert.equal(unknown.assistantStartMinusUserVisualBottom, null);
});

test("user Host measurement is always wired and RN/SwiftUI do not both own safe areas", () => {
  const text = readFileSync(new URL("../mobile/src/ai/chat-composer.ios.tsx", import.meta.url), "utf8");
  const start = text.indexOf("const ChatUserMessageRow =");
  const end = text.indexOf("const ChatAssistantMessageRow =", start);
  const source = text.slice(start, end);
  const tree = ts.createSourceFile("UserRow.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const elements: ts.JsxOpeningElement[] = [];
  const visit = (node: ts.Node) => { if (ts.isJsxOpeningElement(node)) elements.push(node); ts.forEachChild(node, visit); };
  visit(tree);
  const host = elements.find(node => node.tagName.getText(tree) === "Host");
  assert.ok(host);
  const attrs = host.attributes.properties.filter(ts.isJsxAttribute);
  const measure = attrs.find(item => item.name.getText(tree) === "onLayoutContent");
  assert.ok(measure?.initializer && ts.isJsxExpression(measure.initializer));
  assert.equal(measure.initializer.expression?.getText(tree), "handleHostLayout");
  const safeArea = attrs.find(item => item.name.getText(tree) === "ignoreSafeArea");
  assert.ok(safeArea?.initializer && ts.isStringLiteral(safeArea.initializer));
  assert.equal(safeArea.initializer.text, "all");
  assert.equal(source.match(/minHeight: nativeHeight \?\? undefined/g)?.length, 2);
  assert.equal(source.includes("setTimeout"), false);
  assert.equal(source.includes("measureInWindow"), false);
});
test("Arabic paragraph/list line heights scale with app font size before native Dynamic Type", () => {
  const standard = agent1ReadingLineHeights(17);
  assert.equal(standard.paragraph, 25.16);
  assert.equal(standard.list, 26.01);
  for (const size of [14, 17, 20, 26, 34]) {
    const rhythm = agent1ReadingLineHeights(size);
    assert.equal(rhythm.paragraph / size, 1.48);
    assert.ok(Math.abs(rhythm.list / size - 1.53) < 0.000001);
  }
});

test("native scroll/inset tracking retains two architecture writers and one explicit collapse correction", () => {
  const source = readFileSync(new URL("../mobile/src/ai/chat-composer.ios.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("chat-composer.ios.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let scrollView: ts.JsxOpeningElement | undefined;
  let offsetWrites = 0;
  let endWrites = 0;
  const offsetOwners: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(tree) === "KeyboardChatScrollView") scrollView = node;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      if (node.expression.name.text === "scrollTo") {
        offsetWrites++;
        let owner: ts.Node | undefined = node.parent;
        while (owner && !ts.isVariableDeclaration(owner)) owner = owner.parent;
        assert.ok(owner && ts.isVariableDeclaration(owner));
        offsetOwners.push(owner.name.getText(tree));
      }
      if (node.expression.name.text === "scrollToEnd") endWrites++;
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(scrollView);
  const attrs = scrollView.attributes.properties.filter(ts.isJsxAttribute);
  for (const [name, handler] of [["onScroll", "handleScroll"], ["onContentInsetChange", "handleContentInsetChange"]]) {
    const attr = attrs.find(item => item.name.getText(tree) === name);
    assert.ok(attr?.initializer && ts.isJsxExpression(attr.initializer));
    assert.equal(attr.initializer.expression?.getText(tree), handler);
  }
  assert.equal(attrs.some(item => item.name.getText(tree) === "maintainVisibleContentPosition"), false);
  assert.equal(offsetWrites, 3);
  assert.deepEqual(offsetOwners.sort(), ['completeUserCollapse', 'followMeasuredAssistantGrowth', 'tryPositionPendingAnchor']);
  assert.equal(endWrites, 0);
});
