/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import type { PublicQuestionSourceSummary } from '@/question-bank/question-bank-api';
import { getQuestionSourceBadges } from '@/question-bank/question-source-badges';

function summary(
  sourceKind: PublicQuestionSourceSummary['sourceKind'],
  count: number
): PublicQuestionSourceSummary {
  return { sourceKind, count };
}

test('Question Card source badges render ministerial-only provenance', () => {
  assert.deepEqual(getQuestionSourceBadges([summary('ministerial', 1)]), [
    { sourceKind: 'ministerial', label: 'وزاري 1' },
  ]);
  assert.deepEqual(getQuestionSourceBadges([summary('ministerial', 3)]), [
    { sourceKind: 'ministerial', label: 'وزاري 3 مرات' },
  ]);
});

test('Question Card source badges render discussion-only provenance', () => {
  assert.deepEqual(getQuestionSourceBadges([summary('discussion-question', 1)]), [
    { sourceKind: 'discussion-question', label: 'أسئلة المناقشة' },
  ]);
});

test('Question Card source badges include canonical sources from multiple Variants', () => {
  assert.deepEqual(
    getQuestionSourceBadges([
      summary('discussion-question', 1),
      summary('ministerial', 1),
    ]),
    [
      { sourceKind: 'ministerial', label: 'وزاري 1' },
      { sourceKind: 'discussion-question', label: 'أسئلة المناقشة' },
    ]
  );
});

test('Categorical sources render once regardless of their occurrence count', () => {
  assert.deepEqual(
    getQuestionSourceBadges([summary('discussion-question', 2)]),
    [{ sourceKind: 'discussion-question', label: 'أسئلة المناقشة' }]
  );
});

test('Question Card source badges support the known Product source labels in a stable order', () => {
  assert.deepEqual(
    getQuestionSourceBadges([
      summary('enrichment', 1),
      summary('book-exercise', 1),
      summary('book-question', 1),
      summary('end-of-chapter', 1),
      summary('educational-tv', 1),
      summary('discussion-question', 1),
      summary('ministerial', 2),
    ]),
    [
      { sourceKind: 'ministerial', label: 'وزاري 2 مرات' },
      { sourceKind: 'discussion-question', label: 'أسئلة المناقشة' },
      { sourceKind: 'educational-tv', label: 'أسئلة التلفزيون التربوي' },
      { sourceKind: 'end-of-chapter', label: 'أسئلة الفصل' },
      { sourceKind: 'book-question', label: 'أسئلة الكتاب' },
      { sourceKind: 'book-exercise', label: 'تمارين الكتاب' },
      { sourceKind: 'enrichment', label: 'إثرائي' },
    ]
  );
});

test('Question Card source badges omit generic, zero, and missing source categories', () => {
  assert.deepEqual(
    getQuestionSourceBadges([
      summary('other', 4),
      summary('ministerial', 0),
      summary('discussion-question', 0),
    ]),
    []
  );
});

test('Duplicate summary entries are combined without duplicating a badge', () => {
  assert.deepEqual(
    getQuestionSourceBadges([
      summary('ministerial', 2),
      summary('ministerial', 3),
      summary('discussion-question', 2),
      summary('discussion-question', 1),
    ]),
    [
      { sourceKind: 'ministerial', label: 'وزاري 5 مرات' },
      { sourceKind: 'discussion-question', label: 'أسئلة المناقشة' },
    ]
  );
});
