import type {
  PublicQuestionDetail,
  PublicQuestionOccurrence,
  PublicQuestionVariant,
} from '@/question-bank/question-bank-api';

export const QUESTION_VARIANTS_SECTION_TITLE = 'جميع الصيغ لهذا السؤال';

export function getPrimaryQuestionVariant(
  detail: PublicQuestionDetail | null
): PublicQuestionVariant | null {
  return detail?.variants.find((variant) => variant.id === detail.primaryVariantId) ?? null;
}

export function getOrderedQuestionVariants(
  detail: PublicQuestionDetail | null
): PublicQuestionVariant[] {
  return detail
    ? [...detail.variants].sort(
        (left, right) => left.displayOrder - right.displayOrder || left.id.localeCompare(right.id)
      )
    : [];
}

export function getAggregateQuestionOccurrences(
  detail: PublicQuestionDetail | null
): PublicQuestionOccurrence[] {
  if (!detail) return [];

  const seen = new Set<string>();
  return getOrderedQuestionVariants(detail)
    .flatMap((variant) => variant.occurrences)
    .filter((occurrence) => {
      if (seen.has(occurrence.id)) return false;
      seen.add(occurrence.id);
      return true;
    });
}

export function countMinisterialOccurrences(
  occurrences: readonly PublicQuestionOccurrence[]
): number {
  return occurrences.filter((occurrence) => occurrence.sourceKind === 'ministerial').length;
}

export function shouldRenderQuestionVariants(
  variants: readonly PublicQuestionVariant[]
): boolean {
  return variants.length > 1;
}

export function getQuestionVariantLabel(displayIndex: number): string {
  return `الصيغة ${displayIndex + 1}`;
}
