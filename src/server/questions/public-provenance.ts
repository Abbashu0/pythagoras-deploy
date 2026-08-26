import type { ContentDatabase } from "../content";
import type { QuestionSourceKind } from "./contracts";

export interface PublicQuestionSourceSummary {
  sourceKind: QuestionSourceKind;
  count: number;
}

/** Load compact source-kind counts for a bounded set of Questions in one query. */
export function loadPublicQuestionSourceSummaries(
  database: ContentDatabase,
  questionIds: string[],
): Map<string, PublicQuestionSourceSummary[]> {
  const summaries = new Map<string, PublicQuestionSourceSummary[]>();
  if (!questionIds.length) return summaries;
  const placeholders = questionIds.map(() => "?").join(",");
  const rows = database.client.prepare(`
    select v.question_id, o.source_kind, count(*) as occurrence_count
    from question_variants v
    join question_occurrences o on o.variant_id = v.id
    where v.question_id in (${placeholders})
    group by v.question_id, o.source_kind
    order by v.question_id, o.source_kind
  `).all(...questionIds) as Array<{ question_id: string; source_kind: QuestionSourceKind; occurrence_count: number }>;
  for (const row of rows) {
    summaries.set(row.question_id, [
      ...(summaries.get(row.question_id) ?? []),
      { sourceKind: row.source_kind, count: Number(row.occurrence_count) },
    ]);
  }
  return summaries;
}
