/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_GRAMMAR_TOPIC_NODE_KEY,
  getDefaultGrammarTopicNode,
  getGrammarTopicNodes,
} from '@/question-bank/question-bank-topics';
import type {
  PublicMaterialQuestionBankLayout,
  PublicMaterialQuestionBankNode,
} from '@/question-bank/question-bank-api';

function layoutFixture(
  overrides: Partial<PublicMaterialQuestionBankNode>[] = []
): PublicMaterialQuestionBankLayout {
  const grammarGroupId = 'grammar-group';
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
