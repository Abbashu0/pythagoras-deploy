import type { ContentDatabase } from "../../content/database";
import type { AIKnowledgeDocumentProvenance, AIKnowledgeTrustTier } from "../knowledge/contracts";
import {
  AI_RETRIEVAL_DEFAULT_QUERY_LIMIT,
  AI_RETRIEVAL_MAX_QUERY_LIMIT,
  type AILexicalCandidate,
  type AILexicalRetrievalAdapter,
  type AILexicalRetrievalQuery,
} from "./contracts";
import { AIRetrievalError } from "./errors";
import { buildSafeRetrievalMatch } from "./normalization";

/** Internal lexical retrieval over the separate M7A FTS5 projection. */
export class SQLiteAILexicalRetrievalAdapter implements AILexicalRetrievalAdapter {
  constructor(private readonly database: ContentDatabase) {}

  search(input: AILexicalRetrievalQuery): AILexicalCandidate[] {
    this.assertSubject(input.subjectKey);
    const parsed = buildSafeRetrievalMatch(input.query);
    const limit = normalizeLimit(input.limit);
    const rows = this.database.client.prepare(`
      select f.chunk_id, f.projection_revision_id,
             c.subject_key, c.origin_kind, c.origin_id,
             c.origin_revision, c.origin_content_revision,
             c.source_id, c.source_revision, c.source_type,
             c.trust_tier, c.source_item_id, c.source_item_order,
             c.question_id, c.question_revision, c.variant_id,
             c.variant_revision, c.text, c.language, c.provenance,
             c.origin_metadata, bm25(ai_retrieval_fts) as lexical_score
      from ai_retrieval_fts as f
      join ai_retrieval_chunks as c
        on c.chunk_id = f.chunk_id
        and c.projection_revision_id = f.projection_revision_id
      join ai_retrieval_projection_revisions as r
        on r.id = c.projection_revision_id
      where ai_retrieval_fts match ?
        and f.subject_key = ?
        and c.subject_key = ?
        and r.status = 'READY'
        and r.is_current = 1
        and (
          c.origin_kind = 'QUESTION_PACKAGE'
          or exists (
            select 1
            from ai_knowledge_sources as ks
            join ai_knowledge_source_revisions as ksr
              on ksr.source_id = ks.id
              and ksr.revision = ks.current_revision
            where ks.id = c.source_id
              and ksr.enabled = 1
              and ksr.rights_status = 'CLEARED'
          )
        )
      order by lexical_score asc, c.chunk_id asc
      limit ?
    `).all(parsed.match, input.subjectKey, input.subjectKey, limit) as Array<Record<string, unknown>>;
    return rows.map((row, index) => ({
      chunkId: String(row.chunk_id),
      projectionRevisionId: String(row.projection_revision_id),
      subjectKey: String(row.subject_key),
      originKind: String(row.origin_kind) as AILexicalCandidate["originKind"],
      originId: String(row.origin_id),
      originRevision: Number(row.origin_revision),
      originContentRevision: Number(row.origin_content_revision),
      sourceId: row.source_id === null ? null : String(row.source_id),
      sourceRevision: row.source_revision === null ? null : Number(row.source_revision),
      sourceType: row.source_type === null ? null : String(row.source_type),
      trustTier: String(row.trust_tier) as AIKnowledgeTrustTier,
      sourceItemId: String(row.source_item_id),
      sourceItemOrder: Number(row.source_item_order),
      questionId: row.question_id === null ? null : String(row.question_id),
      questionRevision: row.question_revision === null ? null : Number(row.question_revision),
      variantId: row.variant_id === null ? null : String(row.variant_id),
      variantRevision: row.variant_revision === null ? null : Number(row.variant_revision),
      text: String(row.text),
      language: String(row.language),
      provenance: parseProvenance(row.provenance),
      originMetadata: parseMetadata(row.origin_metadata),
      rank: index + 1,
    }));
  }

  private assertSubject(subjectKey: string): void {
    const exists = this.database.client.prepare("select subject_key from canonical_materials where subject_key = ?").get(subjectKey);
    if (!exists) throw new AIRetrievalError("AI_RETRIEVAL_SUBJECT_INVALID", "The retrieval subject is not canonical.");
  }
}

export function createSQLiteAILexicalRetrievalAdapter(database: ContentDatabase): AILexicalRetrievalAdapter {
  return new SQLiteAILexicalRetrievalAdapter(database);
}

function normalizeLimit(value?: number): number {
  const limit = value ?? AI_RETRIEVAL_DEFAULT_QUERY_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > AI_RETRIEVAL_MAX_QUERY_LIMIT) throw new AIRetrievalError("AI_RETRIEVAL_QUERY_INVALID", "Retrieval result limit is outside the safe bound.");
  return limit;
}

function parseProvenance(value: unknown): AIKnowledgeDocumentProvenance | null {
  if (value === null || value === undefined) return null;
  try { return (typeof value === "string" ? JSON.parse(value) : value) as AIKnowledgeDocumentProvenance; } catch { return null; }
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}
