import assert from 'node:assert/strict';
import test from 'node:test';
import { presentUserMessage, USER_MESSAGE_PRESENTATION } from '../mobile/src/ai/user-message-presentation';
import { createAcceptedAgent1ChatTurn, buildAgent1HistoryForNewTurn, buildAgent1HistoryForRegenerate } from '../mobile/src/ai/agent-1-chat-state';
import { LONG_USER_FIXTURE } from '../mobile/src/ai/renderer-quality-fixtures.dev';
import { captureUserMessageCollapseAnchor, recordUserMessageHeight, resolveUserMessageCollapseOffset, userMessageHeightFloor } from '../mobile/src/ai/user-message-layout';
import { readFileSync } from 'node:fs';

test('short and threshold-boundary user content is presented exactly', () => {
  for (const source of ['مرحبا', 'API مع عربي', 'x'.repeat(700), Array(10).fill('سطر').join('\n')]) {
    assert.deepEqual(presentUserMessage(source).text, source); assert.equal(presentUserMessage(source).collapsible, false);
  }
});

test('collapsed and expanded measurements are independent; expansion retains the measured floor', () => {
  const empty = { context: '404:1', collapsed: null, expanded: null };
  const collapsed = recordUserMessageHeight(empty, '404:1', 'collapsed', 265.33);
  assert.equal(userMessageHeightFloor(collapsed, '404:1', 'expanded'), 265.33);
  const expanded = recordUserMessageHeight(collapsed, '404:1', 'expanded', 7320.67);
  assert.equal(expanded.collapsed, 265.33);
  assert.equal(expanded.expanded, 7320.67);
  assert.equal(userMessageHeightFloor(expanded, '404:1', 'collapsed'), 265.33);
  assert.equal(userMessageHeightFloor(expanded, '404:1', 'expanded'), 7320.67);
  assert.equal(recordUserMessageHeight(expanded, '404:1', 'expanded', 0), expanded);
  assert.equal(recordUserMessageHeight(expanded, '404:1', 'expanded', NaN), expanded);
});

test('cached heights are scoped to measured width/font scale and absent collapsed height uses a real floor', () => {
  const onlyExpanded = recordUserMessageHeight({ context: '404:1', collapsed: null, expanded: null }, '404:1', 'expanded', 7320);
  assert.equal(userMessageHeightFloor(onlyExpanded, '404:1', 'collapsed'), 7320);
  assert.equal(userMessageHeightFloor(onlyExpanded, '300:1.5', 'collapsed'), null);
  const changedWidth = recordUserMessageHeight(onlyExpanded, '300:1.5', 'collapsed', 350);
  assert.equal(changedWidth.expanded, null);
  assert.equal(changedWidth.collapsed, 350);
});

test('collapse preserves the measured row-bottom viewport anchor; expansion never creates one', () => {
  const row = { y: 800, height: 7300 };
  assert.equal(captureUserMessageCollapseAnchor('turn', 'expanded', row, 7600, 3), null);
  const anchor = captureUserMessageCollapseAnchor('turn', 'collapsed', row, 7600, 3)!;
  assert.equal(anchor.viewportY, 500);
  const collapsed = { y: 800, height: 265 };
  const target = resolveUserMessageCollapseOffset(anchor, collapsed, 265, { contentHeight: 2000, viewportHeight: 900, insetBottom: 150, contentRevision: 4 });
  assert.equal(target, 565);
  assert.equal(collapsed.y + collapsed.height - target!, anchor.viewportY);
});

test('collapse waits for Host/RN agreement and updated document bounds, and clamps safely', () => {
  const anchor = captureUserMessageCollapseAnchor('turn', 'collapsed', { y: 800, height: 7300 }, 7600, 3)!;
  const bounds = { contentHeight: 2000, viewportHeight: 900, insetBottom: 150, contentRevision: 4 };
  const row = { y: 800, height: 265 };
  assert.equal(resolveUserMessageCollapseOffset(anchor, row, null, bounds), null);
  assert.equal(resolveUserMessageCollapseOffset(anchor, { ...row, height: 7300 }, 265, bounds), null);
  assert.equal(resolveUserMessageCollapseOffset(anchor, row, 265, { ...bounds, contentRevision: 3 }), null);
  assert.equal(resolveUserMessageCollapseOffset(anchor, row, 265, { ...bounds, contentHeight: 400 }), null);
  assert.equal(resolveUserMessageCollapseOffset({ ...anchor, viewportY: -1000 }, row, 265, bounds), 1250);
  assert.equal(resolveUserMessageCollapseOffset({ ...anchor, viewportY: 2000 }, row, 265, bounds), 0);
  assert.equal(resolveUserMessageCollapseOffset(anchor, row, 265, { ...bounds, viewportHeight: NaN }), null);
});

test('presentation interaction keeps identity and follow suspension; collapse correction is consumed once', () => {
  const source = readFileSync(new URL('../mobile/src/ai/chat-composer.ios.tsx', import.meta.url), 'utf8');
  const interaction = source.slice(source.indexOf('const handleUserPresentationChange'), source.indexOf('const followMeasuredAssistantGrowth'));
  assert.ok(interaction.includes('userPresentationReadingRef.current = true'));
  assert.equal(interaction.includes('setScrollState'), false);
  assert.ok(interaction.indexOf('pendingUserCollapseRef.current = null;\n    lastRequestedOffsetRef.current = target') < interaction.indexOf('scrollTo({ y: target, animated: false })'));
  assert.ok(source.includes('if (userPresentationReadingRef.current) return;'));
  assert.ok(source.includes('<Fragment key={row.key}>'));
  assert.equal(source.includes('setNativeHeight(null)'), false);
});
test('long or multiline source gets a bounded real preview and can expand to its exact original', () => {
  for (const source of ['x'.repeat(701), Array(11).fill('سطر').join('\n'), LONG_USER_FIXTURE]) {
    const collapsed = presentUserMessage(source);
    assert.equal(collapsed.collapsed, true); assert.equal(collapsed.collapsible, true);
    assert.ok(collapsed.text.length <= USER_MESSAGE_PRESENTATION.previewCharacters + 1);
    assert.ok(collapsed.text.split('\n').length <= USER_MESSAGE_PRESENTATION.previewLogicalLines);
    assert.equal(presentUserMessage(source, true).text, source);
  }
});
test('preview preserves surrogate pairs, composed Arabic marks, emoji sequences and nearby words', () => {
  const sources = ['ا'.repeat(319) + '😀' + 'ب'.repeat(600), 'ا'.repeat(319) + 'نَ' + 'ب'.repeat(600), 'ا'.repeat(315) + '👨‍👩‍👧‍👦' + 'ب'.repeat(600), ('كلمة واحدة كاملة ').repeat(60)];
  for (const source of sources) {
    const preview = presentUserMessage(source).text.slice(0, -1);
    assert.ok(source.startsWith(preview)); assert.equal(/[\ud800-\udbff]$/u.test(preview), false);
    if (source.includes('نَ')) assert.equal(preview.endsWith('ن'), false);
    if (source.includes('👨')) assert.equal(preview.endsWith('‍'), false);
  }
  const lastWord = presentUserMessage(sources[3]).text.slice(0, -1).split(' ').at(-1);
  assert.ok(['كلمة', 'واحدة', 'كاملة'].includes(lastWord!));
});
test('collapse is transient presentation only; turn, new request and regeneration use the complete source', () => {
  const turn = createAcceptedAgent1ChatTurn('stable-id', LONG_USER_FIXTURE);
  const saved = JSON.stringify(turn);
  const collapsed = presentUserMessage(turn.user.content);
  assert.notEqual(collapsed.text, turn.user.content);
  assert.equal(presentUserMessage(turn.user.content, true).text, LONG_USER_FIXTURE);
  assert.equal(JSON.stringify(turn), saved); assert.equal(turn.id, 'stable-id');
  assert.equal(buildAgent1HistoryForNewTurn([], turn.user)[0].content, LONG_USER_FIXTURE);
  assert.equal(buildAgent1HistoryForRegenerate([turn], turn.id)?.[0].content, LONG_USER_FIXTURE);
});
