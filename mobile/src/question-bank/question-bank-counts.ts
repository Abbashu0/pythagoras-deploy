import type { PublicMaterialQuestionBankNode } from '@/question-bank/question-bank-api';

export const QUESTION_BANK_COUNT_COLUMN_WIDTH = 42;
export const QUESTION_BANK_TOPIC_LABEL_COLUMN_WIDTH = 150;

export type QuestionCountUpdate = {
  nodeKey: string;
  total: number;
};

export function getTopicsNeedingCount(
  topics: readonly PublicMaterialQuestionBankNode[],
  counts: ReadonlyMap<string, number>
) {
  return topics.filter((topic) => topic.available && !counts.has(topic.nodeKey));
}

export function getTopicQuestionCount(
  counts: ReadonlyMap<string, number>,
  nodeKey: string
): number | undefined {
  const count = counts.get(nodeKey);
  return typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : undefined;
}

export function mergeQuestionCountCache(
  current: ReadonlyMap<string, number>,
  updates: readonly QuestionCountUpdate[]
) {
  const next = new Map(current);
  for (const update of updates) {
    if (Number.isInteger(update.total) && update.total >= 0) {
      next.set(update.nodeKey, update.total);
    }
  }
  return next;
}

export function isCurrentQuestionCountGeneration(
  activeGeneration: number,
  responseGeneration: number
) {
  return activeGeneration === responseGeneration;
}

export function formatQuestionCountForDisplay(count: number) {
  return `\u2066${count}\u2069`;
}
