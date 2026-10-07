import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {
  ACTION_BUTTON_DIAMETER, ACTION_BUTTON_HIT_TARGET, COMPOSER_BOTTOM_PADDING,
  COMPOSER_COMPACT_CORNER_RADIUS, COMPOSER_COMPACT_HEIGHT, COMPOSER_COMPACT_HORIZONTAL_INSET,
  COMPOSER_EXPANDED_CORNER_RADIUS, COMPOSER_EXPANDED_HORIZONTAL_INSET, COMPOSER_EXPANDED_MIN_HEIGHT,
  getChatComposerPresentation, getChatComposerVisualOverflow, isChatComposerDraftSendable,
} from '../mobile/src/ai/chat-composer-presentation';

const parent = readFileSync('mobile/src/ai/chat-composer.ios.tsx', 'utf8');
const controls = readFileSync('mobile/src/ai/chat-composer-controls.ios.tsx', 'utf8');

test('only exactly empty, unfocused inline drafting is compact', () => {
  for (const [focused, draftLength, sheetPresented, mode] of [
    [false, 0, false, 'compact'], [true, 0, false, 'expanded'],
    [false, 1, false, 'expanded'], [true, 1, false, 'expanded'],
    [false, 0, true, 'expanded'], [true, 30, true, 'expanded'],
  ] as const) {
    assert.equal(getChatComposerPresentation({ focused, draftLength, sheetPresented, visualOverflow: false }).mode, mode);
  }
});

test('spaces are a retained expanded draft but remain unsendable', () => {
  for (const draft of [' ', '   ', '\n\t ', '\u2003']) {
    assert.equal(getChatComposerPresentation({ focused: false, draftLength: draft.length, sheetPresented: false, visualOverflow: false }).mode, 'expanded');
    assert.equal(isChatComposerDraftSendable(draft), false);
  }
  assert.equal(isChatComposerDraftSendable('  مرحبا\n'), true);
});

test('empty Send clear remains expanded while focused, then empty blur restores compact', () => {
  assert.equal(getChatComposerPresentation({ focused: true, draftLength: 0, sheetPresented: false, visualOverflow: false }).mode, 'expanded');
  assert.equal(getChatComposerPresentation({ focused: false, draftLength: 0, sheetPresented: false, visualOverflow: false }).mode, 'compact');
});

test('sheet presentation and both dismissal cases use the same drafting policy', () => {
  assert.deepEqual(getChatComposerPresentation({ focused: false, draftLength: 500, sheetPresented: true, visualOverflow: true }), { mode: 'expanded', showExpand: false });
  assert.equal(getChatComposerPresentation({ focused: false, draftLength: 500, sheetPresented: false, visualOverflow: true }).mode, 'expanded');
  assert.deepEqual(getChatComposerPresentation({ focused: false, draftLength: 0, sheetPresented: false, visualOverflow: true }), { mode: 'compact', showExpand: false });
});

test('native five-line capacity handles short, wrapped and multiline typography without JS text-height estimates', () => {
  for (const fiveLines of [100, 115, 161, 205]) {
    for (const natural of [0, fiveLines / 5, fiveLines * 0.8, fiveLines]) {
      assert.equal(getChatComposerVisualOverflow({ width: 372, height: natural }, { width: 372, height: fiveLines }), false);
    }
    assert.equal(getChatComposerVisualOverflow({ width: 372, height: fiveLines * 1.2 }, { width: 372, height: fiveLines }), true);
  }
  for (const visualOverflow of [false, true]) {
    assert.equal(getChatComposerPresentation({ focused: true, draftLength: 900, sheetPresented: false, visualOverflow }).showExpand, visualOverflow);
  }
});

test('incomplete/mismatched native width pairs do not publish an overflow guess', () => {
  assert.equal(getChatComposerVisualOverflow(null, { width: 372, height: 115 }), null);
  assert.equal(getChatComposerVisualOverflow({ width: 372, height: 138 }, null), null);
  assert.equal(getChatComposerVisualOverflow({ width: 300, height: 138 }, { width: 372, height: 115 }), null);
  assert.equal(getChatComposerVisualOverflow({ width: 372, height: NaN }, { width: 372, height: 115 }), null);
  assert.equal(getChatComposerVisualOverflow({ width: 0, height: 138 }, { width: 0, height: 115 }), null);
});

// Execute the real callbacks extracted from the component, not a duplicate send
// implementation. Native writes deliberately stay pending until the UI applies them.
function actualCallback(source: string, name: string, context: Record<string, unknown>) {
  const tree = ts.createSourceFile('Composer.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(callback && ts.isArrowFunction(callback), name);
  const script = ts.transpileModule(`(${callback.getText(tree)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(script, context) as (...args: unknown[]) => unknown;
}

function sendFixture(draft: string, sheetPresented: boolean, accepted = true, throws = false) {
  const requests: string[] = [], nativeWrites: string[] = [];
  let nativeDraft = draft, sheetCloses = 0;
  const draftRef = { current: 'stale JS mirror' }, sendPendingRef = { current: false };
  const ref = () => ({ current: null });
  const parentContext = {
    draftRef, activeTurnId: null, onSend: (text: string) => { requests.push(text); if (throws) throw new Error('submission failed'); return accepted ? 'turn-1' : null; },
    pendingUserCollapseRef: ref(), userPresentationReadingRef: { current: false },
    beginChatSendTiming: () => {}, anchorTargetOffsetRef: ref(), lastRequestedOffsetRef: ref(),
    lastActiveAssistantLayoutRef: ref(), lastFollowedAssistantBottomRef: ref(), geometryRef: ref(),
    setScrollState: () => {}, beginChatTranscriptTurn: () => ({}), scrollStateRef: { current: {} },
    turns: [], reportGeometryDiagnostic: () => {}, message: { set: (value: string) => nativeWrites.push(value) },
    setHasSendableText: () => {},
  };
  const onTextChange = actualCallback(parent, 'handleTextChange', parentContext);
  const onSend = actualCallback(parent, 'handleSend', parentContext);
  const submit = actualCallback(controls, 'submitDraft', {
    sendPendingRef, sendDisabled: false, message: { get: () => nativeDraft },
    isChatComposerDraftSendable, onTextChange, onSend, sheetPresented,
    closeEditor: () => { sheetCloses++; },
  });
  const syncNativeDraft = actualCallback(controls, 'syncNativeDraft', {
    mountedRef: { current: true }, sendPendingRef, setDraftSnapshot: () => {}, setVisualOverflow: () => {},
  });
  return {
    submit, requests, nativeWrites, draftRef, getSheetCloses: () => sheetCloses,
    applyNativeClear: () => { nativeDraft = ''; syncNativeDraft(''); },
  };
}

for (const sheetPresented of [false, true]) {
  test(`${sheetPresented ? 'sheet' : 'inline'} Send preserves exact Unicode/whitespace and clears one shared draft exactly once`, () => {
    const draft = '  مرحبا 👋\nArabic + API\n\t ';
    const fixture = sendFixture(draft, sheetPresented);
    fixture.submit();
    assert.deepEqual(fixture.requests, [draft]);
    assert.deepEqual(fixture.nativeWrites, ['']);
    assert.equal(fixture.draftRef.current, '');
    // The native ObservableState write is asynchronous: it still reads old text.
    fixture.submit();
    assert.deepEqual(fixture.requests, [draft]);
    fixture.applyNativeClear();
    fixture.submit(); // stale enabled button after clear still cannot resubmit
    assert.deepEqual(fixture.requests, [draft]);
    assert.deepEqual(fixture.nativeWrites, ['']);
    assert.equal(fixture.getSheetCloses(), sheetPresented ? 1 : 0);
  });
}

test('rejected Send preserves the source and leaves the sheet available for editing', () => {
  const fixture = sendFixture('مرحبا\n  ', true, false);
  fixture.submit();
  assert.deepEqual(fixture.nativeWrites, []);
  assert.equal(fixture.draftRef.current, 'مرحبا\n  ');
  assert.equal(fixture.getSheetCloses(), 0);
  fixture.submit();
  assert.equal(fixture.requests.length, 2); // rejected attempt does not lock future retries
});

test('a throwing Send callback cannot leave drafting permanently locked', () => {
  const fixture = sendFixture('مرحبا', true, true, true);
  assert.throws(() => fixture.submit(), /submission failed/u);
  assert.throws(() => fixture.submit(), /submission failed/u);
  assert.equal(fixture.requests.length, 2);
  assert.deepEqual(fixture.nativeWrites, []);
  assert.equal(fixture.getSheetCloses(), 0);
});

test('the compact/expanded geometry and five-line inline cap are explicit', () => {
  assert.deepEqual([COMPOSER_COMPACT_HEIGHT, COMPOSER_COMPACT_HORIZONTAL_INSET, COMPOSER_COMPACT_CORNER_RADIUS], [48, 38, 24]);
  assert.deepEqual([COMPOSER_EXPANDED_MIN_HEIGHT, COMPOSER_EXPANDED_HORIZONTAL_INSET, COMPOSER_EXPANDED_CORNER_RADIUS], [94, 16, 28]);
  assert.deepEqual([ACTION_BUTTON_DIAMETER, ACTION_BUTTON_HIT_TARGET, COMPOSER_BOTTOM_PADDING], [36, 44, 10]);
  assert.ok(controls.includes('lineLimit({ min: 1, max: 5 })'));
  assert.ok(controls.includes('lineLimit(5, { reservesSpace: true })'));
  assert.ok(controls.includes('frame({ height: 0 }), hidden(), accessibilityHidden()'));
  assert.equal(/split\(['"]\\n|setTimeout|setInterval|Keyboard\.addListener|scrollTo|measureInWindow/u.test(controls), false);
});

test('one stable inline field follows real focus and both fields bind the same native draft', () => {
  const tree = ts.createSourceFile('Controls.tsx', controls, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fields: ts.JsxOpeningElement[] = [];
  const visit = (node: ts.Node) => { if (ts.isJsxOpeningElement(node) && node.tagName.getText(tree) === 'TextField') fields.push(node); ts.forEachChild(node, visit); };
  visit(tree);
  assert.equal(fields.length, 2);
  for (const field of fields) {
    assert.equal(field.attributes.properties.some(attr => ts.isJsxAttribute(attr) && attr.name.getText(tree) === 'key'), false);
    const binding = field.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.getText(tree) === 'text');
    assert.ok(binding && binding.getText(tree) === 'text={message}');
  }
  assert.ok(controls.includes('onFocusChange={setFocused}'));
  assert.ok(controls.includes('message.onChange = (text: string)'));
  assert.ok(controls.includes('message.onChange = null'));
  assert.equal(/useNativeState\(['"]/u.test(controls), false);
  assert.ok(controls.includes('Animation.linear({ duration: 0 })'));
});

test('sheet and inline geometry keep their separate lifetimes within the existing measured-height owner', () => {
  for (const snippet of ["from '@expo/ui/community/bottom-sheet'", "const SHEET_SNAP_POINTS = ['100%']", 'enableDynamicSizing={false}', 'enablePanDownToClose={true}', 'handleComponent={null}', 'onDismiss={editorDismissed}', 'backgroundStyle={{ backgroundColor: palette.background }}']) assert.ok(controls.includes(snippet), snippet);
  assert.equal(controls.match(/onComposerHeightChange\(height\)/gu)?.length, 1);
  assert.ok(parent.includes('onComposerHeightChange={handleComposerHeightChange}'));
  for (const snippet of ['composerHostHeightRef.current = nextHeight', 'composerHeightRef.current = nextHeight + insets.bottom', 'composerScrollInset.set(composerHeightRef.current)', 'KeyboardChatScrollView', 'KeyboardStickyView']) assert.ok(parent.includes(snippet), snippet);
  assert.equal(/Keyboard\.addListener/u.test(parent), false);
});
