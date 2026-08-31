/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ARABIC_QUESTION_BANK_SECTION_ORDER,
  DEFAULT_GRAMMAR_TOPIC_NODE_KEY,
  getActiveArabicQuestionBank,
  getArabicQuestionBankStructure,
  getDefaultGrammarTopicNode,
  getGrammarTopicNodes,
  selectArabicQuestionBankSection,
} from '@/question-bank/question-bank-topics';
import {
  getTopicQuestionCount,
  getTopicsNeedingCount,
  isCurrentQuestionCountGeneration,
  mergeQuestionCountCache,
} from '@/question-bank/question-bank-counts';
import type {
  PublicMaterialQuestionBankLayout,
  PublicMaterialQuestionBankNode,
} from '@/question-bank/question-bank-api';

function layoutFixture(
  overrides: Partial<PublicMaterialQuestionBankNode>[] = []
): PublicMaterialQuestionBankLayout {
  const grammarGroupId = 'grammar-group';
  const literatureBank = {
    id: 'literature-bank',
    nodeKey: 'arabic-literature',
    label: 'Literature',
    nodeType: 'BANK' as const,
    parentId: null,
    displayOrder: 1,
    groupPresentation: null,
    available: false,
  };
  const topics = Array.from({ length: 9 }, (_, index) => ({
    id: `topic-${index + 1}`,
    nodeKey: index === 0 ? DEFAULT_GRAMMAR_TOPIC_NODE_KEY : `topic-${index + 1}`,
    label: `topic ${index + 1}`,
    nodeType: 'BANK' as const,
    parentId: grammarGroupId,
    displayOrder: index + 1,
    groupPresentation: null,
    available: index === 0,
  }));

  return {
    material: { id: 'arabic', subjectKey: 'arabic', label: 'Arabic' },
    rootPresentation: 'DIRECT',
    nodes: [
      literatureBank,
      {
        id: grammarGroupId,
        nodeKey: 'arabic-grammar',
        label: 'Grammar',
        nodeType: 'GROUP',
        parentId: null,
        displayOrder: 1,
        groupPresentation: 'SWITCHER',
        available: true,
      },
      ...topics.map((topic, index) => ({ ...topic, ...overrides[index] })),
    ],
  };
}

test('Mobile derives the nine grammar topics from the public layout in display order', () => {
  const topics = getGrammarTopicNodes(layoutFixture());

  assert.equal(topics.length, 9);
  assert.deepEqual(
    topics.map((topic) => topic.displayOrder),
    [1, 2, 3, 4, 5, 6, 7, 8, 9]
  );
  assert.equal(getDefaultGrammarTopicNode(topics).nodeKey, DEFAULT_GRAMMAR_TOPIC_NODE_KEY);
  assert.equal(topics.filter((topic) => topic.available).length, 1);
});

test('Mobile keeps unavailable grammar banks selectable without changing their layout records', () => {
  const topics = getGrammarTopicNodes(layoutFixture());
  const unavailable = topics.find((topic) => !topic.available);

  if (!unavailable) throw new Error('Expected an unavailable grammar topic.');
  assert.equal(unavailable.nodeKey, 'topic-2');
  assert.equal(unavailable.available, false);
});

test('Mobile rejects a layout without the grammar group or Istifham default', () => {
  const missingGroup = layoutFixture().nodes.filter((node) => node.nodeKey !== 'arabic-grammar');
  assert.throws(
    () => getGrammarTopicNodes({ ...layoutFixture(), nodes: missingGroup }),
    /grammar Question Bank group is missing/
  );

  const withoutDefault = layoutFixture([{ nodeKey: 'different-default' }]);
  assert.throws(() => getGrammarTopicNodes(withoutDefault), /Istifham Question Bank is missing/);
});

test('Question count cache plans only unknown available banks and preserves zero', () => {
  const topics = getGrammarTopicNodes(layoutFixture());
  const counts = mergeQuestionCountCache(new Map(), [
    { nodeKey: DEFAULT_GRAMMAR_TOPIC_NODE_KEY, total: 0 },
  ]);

  assert.equal(getTopicQuestionCount(counts, DEFAULT_GRAMMAR_TOPIC_NODE_KEY), 0);
  assert.equal(getTopicQuestionCount(counts, 'topic-2'), undefined);
  assert.equal(
    getTopicsNeedingCount(topics, counts).every((topic) => topic.available),
    true
  );
  assert.equal(
    getTopicsNeedingCount(topics, counts).some(
      (topic) => topic.nodeKey === DEFAULT_GRAMMAR_TOPIC_NODE_KEY
    ),
    false
  );
});

test('Arabic Question Bank derives its root sections and preserves Product section order', () => {
  const structure = getArabicQuestionBankStructure(layoutFixture());

  assert.equal(structure.grammarGroup.nodeKey, 'arabic-grammar');
  assert.equal(structure.grammarGroup.nodeType, 'GROUP');
  assert.equal(structure.literatureBank.nodeKey, 'arabic-literature');
  assert.equal(structure.literatureBank.nodeType, 'BANK');
  assert.deepEqual(ARABIC_QUESTION_BANK_SECTION_ORDER, ['grammar', 'literature']);
});

test('Arabic section switching changes the active bank and restores the last Grammar topic', () => {
  const structure = getArabicQuestionBankStructure(layoutFixture());
  const rememberedTopic = structure.grammarTopics[1];
  const initialSelection = {
    activeSection: 'grammar' as const,
    selectedGrammarTopicNodeKey: rememberedTopic.nodeKey,
  };

  assert.equal(
    getActiveArabicQuestionBank(structure, 'grammar', rememberedTopic.nodeKey).nodeKey,
    rememberedTopic.nodeKey
  );
  const literatureSelection = selectArabicQuestionBankSection(
    structure,
    initialSelection,
    'literature'
  );
  assert.equal(literatureSelection.activeSection, 'literature');
  assert.equal(literatureSelection.selectedGrammarTopicNodeKey, rememberedTopic.nodeKey);
  assert.equal(
    getActiveArabicQuestionBank(structure, 'literature', rememberedTopic.nodeKey).nodeKey,
    'arabic-literature'
  );
  const grammarSelection = selectArabicQuestionBankSection(
    structure,
    literatureSelection,
    'grammar'
  );
  assert.equal(grammarSelection.activeSection, 'grammar');
  assert.equal(grammarSelection.selectedGrammarTopicNodeKey, rememberedTopic.nodeKey);
  assert.equal(
    getActiveArabicQuestionBank(structure, 'grammar', rememberedTopic.nodeKey).nodeKey,
    'topic-2'
  );
  assert.equal(
    getActiveArabicQuestionBank(structure, 'grammar', 'missing-topic').nodeKey,
    DEFAULT_GRAMMAR_TOPIC_NODE_KEY
  );
  assert.equal(structure.literatureBank.available, false);
});

test('Question count cache keeps valid values and rejects stale generations', () => {
  const current = new Map([
    [DEFAULT_GRAMMAR_TOPIC_NODE_KEY, 12],
    ['topic-2', 34],
  ]);
  const merged = mergeQuestionCountCache(current, [{ nodeKey: 'topic-3', total: 0 }]);

  assert.equal(merged.get(DEFAULT_GRAMMAR_TOPIC_NODE_KEY), 12);
  assert.equal(merged.get('topic-2'), 34);
  assert.equal(merged.get('topic-3'), 0);
  assert.equal(isCurrentQuestionCountGeneration(4, 4), true);
  assert.equal(isCurrentQuestionCountGeneration(4, 3), false);
});

test('Question count remains independent from a search result total', () => {
  const counts = mergeQuestionCountCache(new Map(), [{ nodeKey: 'topic-2', total: 34 }]);
  const searchTotal = 3;

  assert.equal(getTopicQuestionCount(counts, 'topic-2'), 34);
  assert.notEqual(searchTotal, getTopicQuestionCount(counts, 'topic-2'));
});
