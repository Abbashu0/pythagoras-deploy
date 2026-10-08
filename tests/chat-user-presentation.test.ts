import assert from 'node:assert/strict';
import test from 'node:test';
import { presentUserMessage, USER_MESSAGE_PRESENTATION } from '../mobile/src/ai/user-message-presentation';
import { createAcceptedAgent1ChatTurn, buildAgent1HistoryForNewTurn, buildAgent1HistoryForRegenerate } from '../mobile/src/ai/agent-1-chat-state';
import { LONG_USER_FIXTURE } from '../mobile/src/ai/renderer-quality-fixtures.dev';
import { captureUserMessageCollapseAnchor, recordUserMessageHeight, resolveUserMessageCollapseOffset, userMessageHeightFloor } from '../mobile/src/ai/user-message-layout';
import { readFileSync } from 'node:fs';

const EXTREME_USER_FIXTURE = LONG_USER_FIXTURE.repeat(5);

test('short and threshold-boundary user content is presented exactly', () => {
  for (const source of ['مرحبا', 'API مع عربي', 'x'.repeat(700), 'x'.repeat(701), 'x'.repeat(12000), Array(80).fill('سطر').join('\n')]) {
    assert.deepEqual(presentUserMessage(source).text, source); assert.equal(presentUserMessage(source).collapsible, false);
  }
});

test('extreme-message eligibility is 12000/80 while the excerpt remains 640/12/14', () => {
  assert.deepEqual(USER_MESSAGE_PRESENTATION, {
    collapseCharacters: 12000, collapseLogicalLines: 80,
    previewCharacters: 640, previewLogicalLines: 12, previewVisualLines: 14,
  });
  const source = 'x'.repeat(12001);
  const collapsed = presentUserMessage(source);
  assert.equal(collapsed.text, source.slice(0, 640) + '…');
  assert.equal(collapsed.collapsible, true);
  assert.equal(presentUserMessage(source, true).text, source);
  const lines = Array.from({ length: 81 }, (_, i) => `سطر ${i + 1}`).join('\n');
  assert.equal(presentUserMessage(lines).text, lines.split('\n').slice(0, 12).join('\n') + '…');
  assert.equal(presentUserMessage(lines, true).text, lines);
  const owner = readFileSync(new URL('../mobile/src/ai/chat-composer.ios.tsx', import.meta.url), 'utf8');
  assert.ok(owner.includes('lineLimit(USER_MESSAGE_PRESENTATION.previewVisualLines)'));
});

test('ordinary lines remain fully visible; 79/80/81/82-line boundaries retain OR eligibility and exact separators', () => {
  for (const count of [10, 11, 12, 13, 79, 80, 81, 82]) {
    for (const separator of ['\n', '\r\n', '\r']) {
      const source = Array.from({ length: count }, (_, i) => `سطر ${i + 1} 👨‍👩‍👧‍👦`).join(separator);
      const presentation = presentUserMessage(source);
      assert.ok(source.length < 12000); // line eligibility works independently of length
      assert.equal(presentation.collapsible, count > 80);
      assert.equal(presentation.collapsed, count > 80);
      if (count <= 80) assert.equal(presentation.text, source);
      else {
        const prefix = source.split(separator).slice(0, 12).join(separator);
        assert.equal(presentation.text, prefix + '…');
        assert.ok(source.startsWith(prefix));
        assert.ok(prefix.length < source.length);
      }
      assert.equal(presentUserMessage(source, true).text, source);
    }
  }
});

test('11999/12000/12001-character boundary and original Unicode separators remain intact', () => {
  for (const length of [11999, 12000, 12001]) {
    const source = 'x'.repeat(length);
    const presentation = presentUserMessage(source);
    assert.equal(presentation.collapsed, length > 12000);
    assert.equal(presentation.text, length <= 12000 ? source : 'x'.repeat(640) + '…');
    assert.equal(presentation.logicalLines, 1); // character eligibility also works independently
  }
  const source = Array(81).fill('نَ 👨‍👩‍👧‍👦').join('\r\n') + '\r\n';
  const preview = presentUserMessage(source).text.slice(0, -1);
  assert.ok(source.startsWith(preview));
  assert.equal(preview.includes('\r\n'), true);
  assert.equal(preview.endsWith('‍'), false);
  assert.equal(presentUserMessage(source, true).text, source);
});

test('the 3110-character / 26-line development story and ordinary Arabic paragraphs are never excerpted', () => {
  assert.equal(LONG_USER_FIXTURE.length, 3110);
  assert.equal(LONG_USER_FIXTURE.split(/\r\n|\r|\n/u).length, 26);
  const paragraph = 'في صباح هادئ خرج الطالب إلى المكتبة، وقرأ قصةً عن المعرفة والصبر. '.repeat(12);
  for (const source of [LONG_USER_FIXTURE, ...['\n\n', '\r\n\r\n', '\r\r'].map(separator => Array(8).fill(paragraph).join(separator))]) {
    assert.ok(source.length > 700 && source.length <= 12000);
    const presentation = presentUserMessage(source);
    assert.equal(presentation.collapsible, false);
    assert.equal(presentation.collapsed, false);
    assert.equal(presentation.text, source);
    assert.equal(presentUserMessage(source, true).text, source);
  }
});

test('mixed CRLF/CR/LF separators count once each without rewriting the original excerpt', () => {
  for (const count of [80, 81]) {
    const separators = ['\r\n', '\r', '\n'];
    let source = 'سطر 1 👨‍👩‍👧‍👦';
    for (let i = 1; i < count; i++) source += separators[(i - 1) % 3] + `سطر ${i + 1} نَ`;
    const presentation = presentUserMessage(source);
    assert.equal(presentation.logicalLines, count);
    assert.equal(presentation.collapsed, count > 80);
    assert.equal(presentUserMessage(source, true).text, source);
    if (count === 80) assert.equal(presentation.text, source);
    else {
      const prefix = presentation.text.slice(0, -1);
      assert.ok(source.startsWith(prefix));
      assert.equal(prefix.split(/\r\n|\r|\n/u).length, 12);
      assert.ok(prefix.length < source.length);
    }
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
  for (const source of ['x'.repeat(12001), Array(81).fill('سطر').join('\n'), EXTREME_USER_FIXTURE]) {
    const collapsed = presentUserMessage(source);
    assert.equal(collapsed.collapsed, true); assert.equal(collapsed.collapsible, true);
    assert.ok(collapsed.text.length <= USER_MESSAGE_PRESENTATION.previewCharacters + 1);
    assert.ok(collapsed.text.split('\n').length <= USER_MESSAGE_PRESENTATION.previewLogicalLines);
    assert.equal(presentUserMessage(source, true).text, source);
  }
});
test('preview preserves surrogate pairs, composed Arabic marks, emoji sequences and nearby words', () => {
  const sources = ['ا'.repeat(639) + '😀' + 'ب'.repeat(12000), 'ا'.repeat(639) + 'نَ' + 'ب'.repeat(12000), 'ا'.repeat(635) + '👨‍👩‍👧‍👦' + 'ب'.repeat(12000), ('كلمة واحدة كاملة ').repeat(1000)];
  for (const source of sources) {
    const preview = presentUserMessage(source).text.slice(0, -1);
    assert.ok(source.startsWith(preview)); assert.equal(/[\ud800-\udbff]$/u.test(preview), false);
    if (source.includes('نَ')) assert.equal(preview.endsWith('ن'), false);
    if (source.includes('👨')) assert.equal(preview.endsWith('‍'), false);
  }
  const lastWord = presentUserMessage(sources[3]).text.slice(0, -1).split(' ').at(-1);
  assert.ok(['كلمة', 'واحدة', 'كاملة'].includes(lastWord!));
});

test('Hermes fallback preserves Arabic marks, surrogate pairs and ZWJ families at the new excerpt boundary', () => {
  const segmenter = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
  try {
    Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: undefined });
    for (const [prefix, cluster] of [[639, '😀'], [639, 'نَ'], [635, '👨‍👩‍👧‍👦']] as const) {
      const source = 'ا'.repeat(prefix) + cluster + 'ب'.repeat(12000);
      const presentation = presentUserMessage(source);
      assert.equal(presentation.text, 'ا'.repeat(prefix) + '…');
      assert.equal(presentUserMessage(source, true).text, source);
    }
  } finally {
    if (segmenter) Object.defineProperty(Intl, 'Segmenter', segmenter);
    else Reflect.deleteProperty(Intl, 'Segmenter');
  }
});
test('collapse is transient presentation only; turn, new request and regeneration use the complete source', () => {
  const turn = createAcceptedAgent1ChatTurn('stable-id', EXTREME_USER_FIXTURE);
  const saved = JSON.stringify(turn);
  const collapsed = presentUserMessage(turn.user.content);
  assert.notEqual(collapsed.text, turn.user.content);
  assert.equal(presentUserMessage(turn.user.content, true).text, EXTREME_USER_FIXTURE);
  assert.equal(JSON.stringify(turn), saved); assert.equal(turn.id, 'stable-id');
  assert.equal(buildAgent1HistoryForNewTurn([], turn.user)[0].content, EXTREME_USER_FIXTURE);
  assert.equal(buildAgent1HistoryForRegenerate([turn], turn.id)?.[0].content, EXTREME_USER_FIXTURE);
});
