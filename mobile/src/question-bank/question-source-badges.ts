import type {
  PublicQuestionSourceSummary,
  QuestionSourceKind,
} from '@/question-bank/question-bank-api';

export interface QuestionSourceBadge {
  label: string;
  sourceKind: QuestionSourceKind;
}

const QUESTION_SOURCE_BADGE_ORDER: readonly QuestionSourceKind[] = [
  'ministerial',
  'discussion-question',
  'educational-tv',
  'end-of-chapter',
  'book-question',
  'book-exercise',
  'enrichment',
];

const QUESTION_SOURCE_LABELS: Partial<Record<QuestionSourceKind, string>> = {
  'discussion-question': 'أسئلة المناقشة',
  'educational-tv': 'أسئلة التلفزيون التربوي',
  'end-of-chapter': 'أسئلة الفصل',
  'book-question': 'أسئلة الكتاب',
  'book-exercise': 'تمارين الكتاب',
  enrichment: 'إثرائي',
};

export function getQuestionSourceBadges(
  sourceSummary: readonly PublicQuestionSourceSummary[]
): QuestionSourceBadge[] {
  const countsBySource = new Map<QuestionSourceKind, number>();

  for (const summary of sourceSummary) {
    if (!Number.isFinite(summary.count) || summary.count <= 0) continue;
    countsBySource.set(
      summary.sourceKind,
      (countsBySource.get(summary.sourceKind) ?? 0) + summary.count
    );
  }

  const badges: QuestionSourceBadge[] = [];

  for (const sourceKind of QUESTION_SOURCE_BADGE_ORDER) {
    const count = countsBySource.get(sourceKind);
    if (count === undefined || count <= 0) continue;

    if (sourceKind === 'ministerial') {
      badges.push({
        sourceKind,
        label: count === 1 ? 'وزاري 1' : `وزاري ${count} مرات`,
      });
      continue;
    }

    const label = QUESTION_SOURCE_LABELS[sourceKind];
    if (label) badges.push({ sourceKind, label });
  }

  return badges;
}
