import type { ContentDatabase } from "../../content/database";
import {
  AI_RETRIEVAL_DEFAULT_BATCH_SIZE,
  AI_RETRIEVAL_NORMALIZER_KEY,
  AI_RETRIEVAL_NORMALIZER_REVISION,
  AI_RETRIEVAL_STRATEGY_KEY,
  AI_RETRIEVAL_STRATEGY_REVISION,
  type AIRetrievalOriginInput,
  type AIRetrievalProjectionHealth,
  type AIRetrievalProjectionStatusView,
} from "./contracts";
import { AIRetrievalError } from "./errors";
import { AIRetrievalSourceReader } from "./source-reader";
import { SQLiteAIRetrievalProjectionRepository } from "./sqlite-repository";

/** Safe internal health/status reads; it never returns chunk text. */
export class AIRetrievalProjectionHealthService {
  private readonly repository: SQLiteAIRetrievalProjectionRepository;
  private readonly reader: AIRetrievalSourceReader;

  constructor(private readonly database: ContentDatabase) {
    this.repository = new SQLiteAIRetrievalProjectionRepository(database);
    this.reader = new AIRetrievalSourceReader(database);
  }

  getProjectionStatus(input: AIRetrievalOriginInput): AIRetrievalProjectionStatusView {
    const origin = this.reader.loadOrigin(input);
    const set = this.repository.getSet({ ...input, strategyKey: AI_RETRIEVAL_STRATEGY_KEY, normalizerKey: AI_RETRIEVAL_NORMALIZER_KEY });
    const current = set ? this.repository.getCurrentRevision(set.id) : null;
    const latest = set ? this.repository.listRevisions(set.id).at(-1) ?? null : null;
    if (!origin.eligible) return {
      ...input,
      status: "INELIGIBLE",
      projectionSetId: set?.id ?? null,
      projectionRevisionId: current?.id ?? null,
      inputFingerprint: current?.inputFingerprint ?? null,
      currentFingerprint: null,
      chunkCount: current ? this.repository.countChunks(current.id) : 0,
    };
    if (!current && latest?.status === "BUILDING") return { ...input, status: "BUILDING", projectionSetId: set!.id, projectionRevisionId: latest.id, inputFingerprint: latest.inputFingerprint, currentFingerprint: null, chunkCount: this.repository.countChunks(latest.id) };
    if (!current && latest?.status === "FAILED") return { ...input, status: "FAILED", projectionSetId: set!.id, projectionRevisionId: latest.id, inputFingerprint: latest.inputFingerprint, currentFingerprint: null, chunkCount: this.repository.countChunks(latest.id) };
    if (!current) return { ...input, status: "MISSING", projectionSetId: set?.id ?? null, projectionRevisionId: null, inputFingerprint: null, currentFingerprint: null, chunkCount: 0 };
    if (current.status === "BUILDING") return { ...input, status: "BUILDING", projectionSetId: set!.id, projectionRevisionId: current.id, inputFingerprint: current.inputFingerprint, currentFingerprint: null, chunkCount: this.repository.countChunks(current.id) };
    if (current.status === "FAILED") return { ...input, status: "FAILED", projectionSetId: set!.id, projectionRevisionId: current.id, inputFingerprint: current.inputFingerprint, currentFingerprint: null, chunkCount: this.repository.countChunks(current.id) };
    const currentFingerprint = this.reader.computeFingerprint(origin, AI_RETRIEVAL_DEFAULT_BATCH_SIZE, {
      strategyKey: current.strategyKey,
      strategyRevision: current.strategyRevision,
      normalizerKey: current.normalizerKey,
      normalizerRevision: current.normalizerRevision,
    });
    return {
      ...input,
      status: current.inputFingerprint === currentFingerprint ? "READY" : "STALE",
      projectionSetId: set!.id,
      projectionRevisionId: current.id,
      inputFingerprint: current.inputFingerprint,
      currentFingerprint,
      chunkCount: this.repository.countChunks(current.id),
    };
  }

  getHealth(subjectKey: string): AIRetrievalProjectionHealth {
    this.assertSubject(subjectKey);
    let eligibleKnowledgeOrigins = 0;
    let eligibleQuestionOrigins = 0;
    let readyCurrentOrigins = 0;
    let missingOrigins = 0;
    let staleOrigins = 0;
    for (const origin of this.iterateEligibleOrigins(subjectKey, "KNOWLEDGE_PACKAGE")) {
      eligibleKnowledgeOrigins += 1;
      const status = this.getProjectionStatus(origin).status;
      if (status === "READY") readyCurrentOrigins += 1;
      else if (status === "MISSING") missingOrigins += 1;
      else if (status === "STALE") staleOrigins += 1;
    }
    for (const origin of this.iterateEligibleOrigins(subjectKey, "QUESTION_PACKAGE")) {
      eligibleQuestionOrigins += 1;
      const status = this.getProjectionStatus(origin).status;
      if (status === "READY") readyCurrentOrigins += 1;
      else if (status === "MISSING") missingOrigins += 1;
      else if (status === "STALE") staleOrigins += 1;
    }
    const projectionCounts = this.database.client.prepare(`
      select
        sum(case when status = 'BUILDING' then 1 else 0 end) as building_count,
        sum(case when status = 'FAILED' then 1 else 0 end) as failed_count
      from ai_retrieval_projection_revisions r
      join ai_retrieval_projection_sets s on s.id = r.projection_set_id
      where s.subject_key = ?
    `).get(subjectKey) as { building_count: number | null; failed_count: number | null };
    const currentChunkCount = Number((this.database.client.prepare(`
      select count(*) as count
      from ai_retrieval_chunks c
      join ai_retrieval_projection_revisions r on r.id = c.projection_revision_id
      join ai_retrieval_projection_sets s on s.id = r.projection_set_id
      where s.subject_key = ? and r.status = 'READY' and r.is_current = 1
    `).get(subjectKey) as { count: number }).count);
    const currentFtsRowCount = Number((this.database.client.prepare(`
      select count(*) as count
      from ai_retrieval_fts f
      join ai_retrieval_projection_revisions r on r.id = f.projection_revision_id
      join ai_retrieval_projection_sets s on s.id = r.projection_set_id
      where s.subject_key = ? and r.status = 'READY' and r.is_current = 1
    `).get(subjectKey) as { count: number }).count);
    const orphanChunkCount = Number((this.database.client.prepare(`
      select
        (select count(*) from ai_retrieval_chunks c left join ai_retrieval_fts f on f.chunk_id = c.chunk_id and f.projection_revision_id = c.projection_revision_id where f.chunk_id is null)
        + (select count(*) from ai_retrieval_fts f left join ai_retrieval_chunks c on c.chunk_id = f.chunk_id and c.projection_revision_id = f.projection_revision_id where c.chunk_id is null)
        as count
    `).get() as { count: number }).count);
    return {
      subjectKey,
      eligibleKnowledgeOrigins,
      eligibleQuestionOrigins,
      eligibleOrigins: eligibleKnowledgeOrigins + eligibleQuestionOrigins,
      readyCurrentOrigins,
      missingOrigins,
      staleOrigins,
      buildingRevisions: Number(projectionCounts.building_count ?? 0),
      failedRevisions: Number(projectionCounts.failed_count ?? 0),
      currentChunkCount,
      currentFtsRowCount,
      ftsConsistent: currentChunkCount === currentFtsRowCount && orphanChunkCount === 0,
      orphanChunkCount,
    };
  }

  private *iterateEligibleOrigins(subjectKey: string, originKind: "KNOWLEDGE_PACKAGE" | "QUESTION_PACKAGE"): Generator<AIRetrievalOriginInput> {
    const pageSize = 200;
    let cursor = "";
    if (originKind === "KNOWLEDGE_PACKAGE") {
      const statement = this.database.client.prepare(`
        select p.id
        from ai_knowledge_packages p
        join ai_knowledge_package_revisions pr on pr.package_id = p.id and pr.revision = p.current_revision
        join ai_knowledge_sources s on s.id = pr.source_id
        join ai_knowledge_source_revisions sr on sr.source_id = s.id and sr.revision = s.current_revision
        where p.subject_key = ? and sr.enabled = 1 and sr.rights_status = 'CLEARED' and p.id > ?
        order by p.id
        limit ?
      `);
      while (true) {
        const rows = statement.all(subjectKey, cursor, pageSize) as Array<{ id: string }>;
        for (const row of rows) { cursor = row.id; yield { originKind, originId: row.id, subjectKey }; }
        if (rows.length < pageSize) break;
      }
      return;
    }
    const statement = this.database.client.prepare("select id from question_packages where subject_key = ? and id > ? order by id limit ?");
    while (true) {
      const rows = statement.all(subjectKey, cursor, pageSize) as Array<{ id: string }>;
      for (const row of rows) { cursor = row.id; yield { originKind, originId: row.id, subjectKey }; }
      if (rows.length < pageSize) break;
    }
  }

  private assertSubject(subjectKey: string): void {
    const row = this.database.client.prepare("select subject_key from canonical_materials where subject_key = ?").get(subjectKey);
    if (!row) throw new AIRetrievalError("AI_RETRIEVAL_SUBJECT_INVALID", "The retrieval subject is not canonical.");
  }
}

export function createAIRetrievalProjectionHealthService(database: ContentDatabase): AIRetrievalProjectionHealthService {
  return new AIRetrievalProjectionHealthService(database);
}
