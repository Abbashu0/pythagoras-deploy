import type { ResolvedColorScheme } from '@/preferences/preferences-provider';
import type { PublicMaterialQuestionBankNode } from '@/question-bank/question-bank-api';

export interface QuestionTopicSelectorProps {
  colorScheme: ResolvedColorScheme;
  maxWidth: number;
  onSelect: (nodeKey: string) => void;
  selectedTopic: PublicMaterialQuestionBankNode | null;
  secondaryTextColor: string;
  tintColor: string;
  textColor: string;
  topics: readonly PublicMaterialQuestionBankNode[];
}
