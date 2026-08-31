/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  PublicQuestionDetail,
  PublicQuestionOccurrence,
  PublicRichDocument,
} from '@/question-bank/question-bank-api';
import {
  countMinisterialOccurrences,
  getAggregateQuestionOccurrences,
  getOrderedQuestionVariants,
  getPrimaryQuestionVariant,
  getQuestionVariantLabel,
  QUESTION_VARIANTS_SECTION_TITLE,
  shouldRenderQuestionVariants,
} from '@/question-bank/question-reader-model';

const document = (text: string): PublicRichDocument => ({
  type: 'doc',
  version: 1,
  blocks: [{ id: text, type: 'paragraph', spans: [{ text }] }],
});

const occurrence = (
  id: string,
  sourceKind: PublicQuestionOccurrence['sourceKind'],
  year: number
): PublicQuestionOccurrence => ({
  id,
  displayOrder: 1,
  sourceKind,
  year,
  roundCode: null,
  session: null,
  sourceName: null,
  notes: null,
  rawLabel: id,
  branches: [],
  qualifiers: [],
});

function multiVariantDetail(): PublicQuestionDetail {
  return {
    questionId: 'question-1',
    canonicalOrder: 1,
    primaryVariantId: 'variant-b',
    variants: [
      {
        id: 'variant-a',
        displayOrder: 1,
        content: document('Variant A'),
        occurrences: [
          occurrence('discussion-2024', 'discussion-question', 2024),
          occurrence('ministerial-2024', 'ministerial', 2024),
        ],
      },
      {
        id: 'variant-b',
        displayOrder: 2,
        content: document('Variant B'),
        occurrences: [
          occurrence('ministerial-2025', 'ministerial', 2025),
          occurrence('ministerial-2023', 'ministerial', 2023),
        ],
      },
    ],
    sharedAnswer: document('Shared answer'),
    taxonomy: [],
  };
}

test('Reader uses primaryVariantId, keeps all variants ordered, and scopes provenance per variant', () => {
  const detail = multiVariantDetail();
  const primary = getPrimaryQuestionVariant(detail);
  const variants = getOrderedQuestionVariants(detail);
  const aggregate = getAggregateQuestionOccurrences(detail);

  assert.equal(primary?.id, 'variant-b');
  assert.equal(primary?.content.blocks[0].type, 'paragraph');
  assert.deepEqual(
    variants.map((variant) => variant.id),
    ['variant-a', 'variant-b']
  );
  assert.deepEqual(
    variants.map((_, index) => getQuestionVariantLabel(index)),
    ['الصيغة 1', 'الصيغة 2']
  );
  assert.equal(shouldRenderQuestionVariants(variants), true);
  assert.deepEqual(
    variants[0].occurrences.map((item) => item.id),
    ['discussion-2024', 'ministerial-2024']
  );
  assert.deepEqual(
    variants[1].occurrences.map((item) => item.id),
    ['ministerial-2025', 'ministerial-2023']
  );
  assert.deepEqual(
    aggregate.map((item) => item.id),
    ['discussion-2024', 'ministerial-2024', 'ministerial-2025', 'ministerial-2023']
  );
  assert.equal(countMinisterialOccurrences(aggregate), 3);
  assert.equal(QUESTION_VARIANTS_SECTION_TITLE, 'جميع الصيغ لهذا السؤال');
  assert.equal(detail.sharedAnswer?.blocks[0].type, 'paragraph');
});

test('Reader omits the variants section for a single Variant', () => {
  const detail = multiVariantDetail();
  const singleVariant = { ...detail, variants: [detail.variants[0]] };
  const variants = getOrderedQuestionVariants(singleVariant);

  assert.equal(variants.length, 1);
  assert.equal(shouldRenderQuestionVariants(variants), false);
});

test('Reader ministerial count excludes non-ministerial occurrences', () => {
  const detail = multiVariantDetail();
  const aggregate = getAggregateQuestionOccurrences(detail);

  assert.equal(aggregate.length, 4);
  assert.equal(countMinisterialOccurrences(aggregate), 3);
  assert.equal(countMinisterialOccurrences([aggregate[0]]), 0);
});
