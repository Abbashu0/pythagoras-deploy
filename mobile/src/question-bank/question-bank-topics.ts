import type {
  PublicMaterialQuestionBankLayout,
  PublicMaterialQuestionBankNode,
} from '@/question-bank/question-bank-api';

export const ARABIC_SUBJECT_KEY = 'arabic';
export const ARABIC_GRAMMAR_NODE_KEY = 'arabic-grammar';
export const DEFAULT_GRAMMAR_TOPIC_NODE_KEY = 'arabic-grammar-istifham';

export function getGrammarTopicNodes(
  layout: PublicMaterialQuestionBankLayout
): PublicMaterialQuestionBankNode[] {
  const grammarGroup = layout.nodes.find(
    (node) => node.nodeType === 'GROUP' && node.nodeKey === ARABIC_GRAMMAR_NODE_KEY
  );

  if (!grammarGroup) {
    throw new Error('The Arabic grammar Question Bank group is missing.');
  }

  const topics = layout.nodes
    .filter((node) => node.nodeType === 'BANK' && node.parentId === grammarGroup.id)
    .sort((left, right) => left.displayOrder - right.displayOrder || left.id.localeCompare(right.id));

  if (!topics.some((node) => node.nodeKey === DEFAULT_GRAMMAR_TOPIC_NODE_KEY)) {
    throw new Error('The published Istifham Question Bank is missing.');
  }

  return topics;
}

export function getDefaultGrammarTopicNode(
  topics: readonly PublicMaterialQuestionBankNode[]
): PublicMaterialQuestionBankNode {
  const defaultTopic = topics.find((node) => node.nodeKey === DEFAULT_GRAMMAR_TOPIC_NODE_KEY);
  if (!defaultTopic) {
    throw new Error('The published Istifham Question Bank is missing.');
  }
  return defaultTopic;
}
