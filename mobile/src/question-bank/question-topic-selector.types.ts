import type { ResolvedColorScheme } from '@/preferences/preferences-provider';
import type {
  ArabicQuestionBankSection,
} from '@/question-bank/question-bank-topics';
import type { PublicMaterialQuestionBankNode } from '@/question-bank/question-bank-api';

export interface QuestionTopicSelectorProps {
  activeSection: ArabicQuestionBankSection;
  colorScheme: ResolvedColorScheme;
  grammarGroup: PublicMaterialQuestionBankNode;
  literatureBank: PublicMaterialQuestionBankNode;
  maxWidth: number;
  onSelect: (nodeKey: string) => void;
  onSectionSelect: (section: ArabicQuestionBankSection) => void;
  questionCounts: ReadonlyMap<string, number>;
  selectedTopic: PublicMaterialQuestionBankNode | null;
  secondaryTextColor: string;
  tintColor: string;
  textColor: string;
  topics: readonly PublicMaterialQuestionBankNode[];
}
