import type { QuestionSourceKind } from "@/server/questions";

export const QUESTION_SOURCE_KIND_LABELS: Record<QuestionSourceKind, string> = {
  ministerial: "وزاري",
  "discussion-question": "أسئلة المناقشة",
  "educational-tv": "التلفزيون التربوي",
  "end-of-chapter": "أسئلة نهاية الفصل",
  "book-question": "أسئلة الكتاب",
  "book-exercise": "تمارين الكتاب",
  enrichment: "إثرائي",
  other: "أخرى",
};

export function questionSourceKindLabel(kind: QuestionSourceKind): string {
  return QUESTION_SOURCE_KIND_LABELS[kind];
}
