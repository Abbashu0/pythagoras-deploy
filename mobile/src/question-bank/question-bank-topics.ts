import type {
  PublicMaterialQuestionBankLayout,
  PublicMaterialQuestionBankNode,
} from '@/question-bank/question-bank-api';

export const ARABIC_SUBJECT_KEY = 'arabic';
export const ARABIC_GRAMMAR_NODE_KEY = 'arabic-grammar';
export const ARABIC_LITERATURE_NODE_KEY = 'arabic-literature';
export const DEFAULT_GRAMMAR_TOPIC_NODE_KEY = 'arabic-grammar-istifham';

export type ArabicQuestionBankSection = 'grammar' | 'literature';
export const ARABIC_QUESTION_BANK_SECTION_ORDER = ['grammar', 'literature'] as const;

export interface ArabicQuestionBankStructure {
  grammarGroup: PublicMaterialQuestionBankNode;
  literatureBank: PublicMaterialQuestionBankNode;
  grammarTopics: PublicMaterialQuestionBankNode[];
}

export interface ArabicQuestionBankSelection {
  activeSection: ArabicQuestionBankSection;
  selectedGrammarTopicNodeKey: string;
}

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

export function getArabicQuestionBankStructure(
  layout: PublicMaterialQuestionBankLayout
): ArabicQuestionBankStructure {
  const grammarGroup = layout.nodes.find(
    (node) => node.nodeType === 'GROUP' && node.nodeKey === ARABIC_GRAMMAR_NODE_KEY
  );

  if (!grammarGroup) {
    throw new Error('The Arabic grammar Question Bank group is missing.');
  }

  const literatureBank = layout.nodes.find(
    (node) =>
      node.nodeType === 'BANK' &&
      node.nodeKey === ARABIC_LITERATURE_NODE_KEY &&
      node.parentId === null
  );

  if (!literatureBank) {
    throw new Error('The Arabic literature Question Bank is missing.');
  }

  return {
    grammarGroup,
    literatureBank,
    grammarTopics: getGrammarTopicNodes(layout),
  };
}

export function getActiveArabicQuestionBank(
  structure: ArabicQuestionBankStructure,
  section: ArabicQuestionBankSection,
  selectedGrammarTopicNodeKey: string
): PublicMaterialQuestionBankNode {
  if (section === 'literature') {
    return structure.literatureBank;
  }

  return (
    structure.grammarTopics.find((topic) => topic.nodeKey === selectedGrammarTopicNodeKey) ??
    getDefaultGrammarTopicNode(structure.grammarTopics)
  );
}

export function selectArabicQuestionBankSection(
  structure: ArabicQuestionBankStructure,
  current: ArabicQuestionBankSelection,
  nextSection: ArabicQuestionBankSection
): ArabicQuestionBankSelection {
  if (nextSection === 'literature') {
    return { ...current, activeSection: nextSection };
  }

  const grammarTopic =
    structure.grammarTopics.find(
      (topic) => topic.nodeKey === current.selectedGrammarTopicNodeKey
    ) ?? getDefaultGrammarTopicNode(structure.grammarTopics);

  return {
    activeSection: nextSection,
    selectedGrammarTopicNodeKey: grammarTopic.nodeKey,
  };
}
