import { and, asc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { ContentDatabase } from "../../content/database";
import {
  aiRetrievalChunks,
  aiRetrievalProjectionRevisions,
  aiRetrievalProjectionSets,
  type AIRetrievalChunkRow,
  type AIRetrievalProjectionRevisionRow,
  type AIRetrievalProjectionSetRow,
} from "../../content/schema";
import type { AIKnowledgeDocumentProvenance, AIKnowledgeTrustTier } from "../knowledge/contracts";
import type {
  AIRetrievalChunk,
  AIRetrievalOriginInput,
  AIRetrievalProjectionRepository,
  AIRetrievalProjectionRevision,
  AIRetrievalProjectionSet,
  AIRetrievalSourceCursor,
  AIRetrievalBatchResult,
} from "./contracts";
import { AIRetrievalError } from "./errors";
import { normalizeRetrievalText } from "./normalization";

export class SQLiteAIRetrievalProjectionRepository implements AIRetrievalProjectionRepository {
  constructor(private readonly database: ContentDatabase) {}

  getOrCreateSet(input: AIRetrievalOriginInput & { strategyKey: string; normalizerKey: string; now: number }): AIRetrievalProjectionSet {
    const existing = this.getSet(input);
    if (existing) return existing;
    try {
      this.database.db.insert(aiRetrievalProjectionSets).values({
        id: uuidv7(),
        subjectKey: input.subjectKey,
        originKind: input.originKind,
        originId: input.originId,
        strategyKey: input.strategyKey,
        normalizerKey: input.normalizerKey,
        createdAt: input.now,
        updatedAt: input.now,
      }).run();
    } catch (error) {
      const raced = this.getSet(input);
      if (raced) return raced;
      throw new AIRetrievalError("AI_RETRIEVAL_PROJECTION_CONFLICT", "The retrieval projection identity could not be created.", {}, { cause: error });
    }
    const created = this.getSet(input);
    if (!created) throw new AIRetrievalError("AI_RETRIEVAL_PROJECTION_CONFLICT", "The retrieval projection identity could not be reloaded.");
    return created;
  }

  getSet(input: AIRetrievalOriginInput & { strategyKey: string; normalizerKey: string }): AIRetrievalProjectionSet | null {
    const row = this.database.db.select().from(aiRetrievalProjectionSets).where(and(
      eq(aiRetrievalProjectionSets.subjectKey, input.subjectKey),
      eq(aiRetrievalProjectionSets.originKind, input.originKind),
      eq(aiRetrievalProjectionSets.originId, input.originId),
      eq(aiRetrievalProjectionSets.strategyKey, input.strategyKey),
      eq(aiRetrievalProjectionSets.normalizerKey, input.normalizerKey),
    )).get();
    return row ? setFromRow(row) : null;
  }

  getSetById(id: string): AIRetrievalProjectionSet | null {
    const row = this.database.db.select().from(aiRetrievalProjectionSets).where(eq(aiRetrievalProjectionSets.id, id)).get();
    return row ? setFromRow(row) : null;
  }

  getCurrentRevision(projectionSetId: string): AIRetrievalProjectionRevision | null {
    const row = this.database.db.select().from(aiRetrievalProjectionRevisions).where(and(
      eq(aiRetrievalProjectionRevisions.projectionSetId, projectionSetId),
      eq(aiRetrievalProjectionRevisions.isCurrent, true),
    )).get();
    return row ? revisionFromRow(row) : null;
  }

  getRevision(id: string): AIRetrievalProjectionRevision | null {
    const row = this.database.db.select().from(aiRetrievalProjectionRevisions).where(eq(aiRetrievalProjectionRevisions.id, id)).get();
    return row ? revisionFromRow(row) : null;
  }

  listRevisions(projectionSetId: string): AIRetrievalProjectionRevision[] {
    return this.database.db.select().from(aiRetrievalProjectionRevisions)
      .where(eq(aiRetrievalProjectionRevisions.projectionSetId, projectionSetId))
      .orderBy(asc(aiRetrievalProjectionRevisions.revision))
      .all().map(revisionFromRow);
  }

  createRevision(input: { projectionSetId: string; revision: number; inputFingerprint: string; strategyKey: string; strategyRevision: number; normalizerKey: string; normalizerRevision: number; now: number }): AIRetrievalProjectionRevision {
    const id = uuidv7();
    try {
      this.database.db.insert(aiRetrievalProjectionRevisions).values({
        id,
        projectionSetId: input.projectionSetId,
        revision: input.revision,
        inputFingerprint: input.inputFingerprint,
        strategyKey: input.strategyKey,
        strategyRevision: input.strategyRevision,
        normalizerKey: input.normalizerKey,
        normalizerRevision: input.normalizerRevision,
        status: "BUILDING",
        isCurrent: false,
        sourceCursor: { kind: "START" },
        batchCount: 0,
        chunkCount: 0,
        startedAt: input.now,
        updatedAt: input.now,
        readyAt: null,
        failedAt: null,
        safeErrorCode: null,
      }).run();
    } catch (error) {
      throw new AIRetrievalError("AI_RETRIEVAL_PROJECTION_CONFLICT", "The retrieval projection revision could not be created.", {}, { cause: error });
    }
    const revision = this.getRevision(id);
    if (!revision) throw new AIRetrievalError("AI_RETRIEVAL_PROJECTION_CONFLICT", "The retrieval projection revision could not be reloaded.");
    return revision;
  }

  persistBatch(input: { revisionId: string; chunks: AIRetrievalChunk[]; cursor: AIRetrievalSourceCursor; batchCount: number; chunkCount: number; processedItems: number; now: number }): AIRetrievalBatchResult {
    const operation = (): AIRetrievalBatchResult => {
      const revision = this.getRevision(input.revisionId);
      if (!revision || revision.status !== "BUILDING") throw new AIRetrievalError("AI_RETRIEVAL_PROJECTION_CONFLICT", "The retrieval projection revision is not buildable.");
      let insertedChunks = 0;
      for (const chunk of input.chunks) if (this.insertChunkAndFts(chunk)) insertedChunks += 1;
      const actualChunkCount = this.countChunks(input.revisionId);
      const updated = this.database.db.update(aiRetrievalProjectionRevisions).set({
        sourceCursor: input.cursor,
        batchCount: input.batchCount,
        chunkCount: actualChunkCount,
        updatedAt: input.now,
      }).where(and(eq(aiRetrievalProjectionRevisions.id, input.revisionId), eq(aiRetrievalProjectionRevisions.status, "BUILDING"))).returning().get();
      if (!updated) throw new AIRetrievalError("AI_RETRIEVAL_PROJECTION_CONFLICT", "The retrieval projection revision changed during batch persistence.");
      return {
        projectionRevisionId: input.revisionId,
        processedItems: input.processedItems,
        insertedChunks,
        done: input.cursor.kind === "DONE",
        cursor: input.cursor,
      };
    };
    try {
      return this.runAtomic(operation);
    } catch (error) {
      if (error instanceof AIRetrievalError) throw error;
      throw new AIRetrievalError("AI_RETRIEVAL_PROJECTION_FAILED", "A retrieval projection batch could not be persisted.", {}, { cause: error });
    }
  }

  markFailed(revisionId: string, safeErrorCode: string, now: number): void {
    const operation = (): void => {
      this.database.db.update(aiRetrievalProjectionRevisions).set({
        status: "FAILED",
        isCurrent: false,
        failedAt: now,
        updatedAt: now,
        safeErrorCode,
      }).where(and(eq(aiRetrievalProjectionRevisions.id, revisionId), eq(aiRetrievalProjectionRevisions.status, "BUILDING"))).run();
    };
    this.runAtomic(operation);
  }

  finalizeReady(revisionId: string, now: number): AIRetrievalProjectionRevision {
    const operation = (): AIRetrievalProjectionRevision => {
      const revision = this.getRevision(revisionId);
      if (!revision || revision.status !== "BUILDING" || revision.sourceCursor?.kind !== "DONE") throw new AIRetrievalError("AI_RETRIEVAL_PROJECTION_CONFLICT", "The retrieval projection revision is not ready to activate.");
      this.database.db.update(aiRetrievalProjectionRevisions).set({ isCurrent: false }).where(and(
        eq(aiRetrievalProjectionRevisions.projectionSetId, revision.projectionSetId),
        eq(aiRetrievalProjectionRevisions.isCurrent, true),
      )).run();
      const updated = this.database.db.update(aiRetrievalProjectionRevisions).set({
        status: "READY",
        isCurrent: true,
        readyAt: now,
        updatedAt: now,
        safeErrorCode: null,
      }).where(and(eq(aiRetrievalProjectionRevisions.id, revisionId), eq(aiRetrievalProjectionRevisions.status, "BUILDING"), eq(aiRetrievalProjectionRevisions.isCurrent, false))).returning().get();
      if (!updated) throw new AIRetrievalError("AI_RETRIEVAL_PROJECTION_CONFLICT", "The retrieval projection revision could not be activated.");
      return revisionFromRow(updated);
    };
    try {
      return this.runAtomic(operation);
    } catch (error) {
      if (error instanceof AIRetrievalError) throw error;
      throw new AIRetrievalError("AI_RETRIEVAL_PROJECTION_FAILED", "The retrieval projection revision could not be activated.", {}, { cause: error });
    }
  }

  countChunks(revisionId: string): number {
    const row = this.database.client.prepare("select count(*) as count from ai_retrieval_chunks where projection_revision_id = ?").get(revisionId) as { count: number };
    return Number(row.count);
  }

  listChunks(revisionId: string): AIRetrievalChunk[] {
    return this.database.db.select().from(aiRetrievalChunks)
      .where(eq(aiRetrievalChunks.projectionRevisionId, revisionId))
      .orderBy(asc(aiRetrievalChunks.chunkOrdinal))
      .all().map(chunkFromRow);
  }

  private insertChunkAndFts(chunk: AIRetrievalChunk): boolean {
    const inserted = this.database.client.prepare(`
      insert or ignore into ai_retrieval_chunks (
        chunk_id, projection_revision_id, subject_key, origin_kind, origin_id,
        origin_revision, origin_content_revision, source_id, source_revision,
        source_type, trust_tier, artifact_sha256, source_item_id, source_item_order,
        question_id, question_revision, variant_id, variant_revision, chunk_ordinal,
        text, text_hash, language, provenance, origin_metadata, strategy_key,
        strategy_revision, normalizer_key, normalizer_revision, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      chunk.chunkId,
      chunk.projectionRevisionId,
      chunk.subjectKey,
      chunk.originKind,
      chunk.originId,
      chunk.originRevision,
      chunk.originContentRevision,
      chunk.sourceId,
      chunk.sourceRevision,
      chunk.sourceType,
      chunk.trustTier,
      chunk.artifactSha256,
      chunk.sourceItemId,
      chunk.sourceItemOrder,
      chunk.questionId,
      chunk.questionRevision,
      chunk.variantId,
      chunk.variantRevision,
      chunk.chunkOrdinal,
      chunk.text,
      chunk.textHash,
      chunk.language,
      chunk.provenance === null ? null : JSON.stringify(chunk.provenance),
      JSON.stringify(chunk.originMetadata),
      chunk.strategyKey,
      chunk.strategyRevision,
      chunk.normalizerKey,
      chunk.normalizerRevision,
      chunk.createdAt,
    );
    if (inserted.changes === 0) {
      const existing = this.database.client.prepare("select text_hash from ai_retrieval_chunks where projection_revision_id = ? and chunk_id = ?").get(chunk.projectionRevisionId, chunk.chunkId) as { text_hash: string } | undefined;
      if (!existing || existing.text_hash !== chunk.textHash) throw new AIRetrievalError("AI_RETRIEVAL_PROJECTION_FAILED", "A deterministic retrieval chunk identity has conflicting content.");
    }
    const ftsExists = this.database.client.prepare("select 1 as present from ai_retrieval_fts where projection_revision_id = ? and chunk_id = ? limit 1").get(chunk.projectionRevisionId, chunk.chunkId);
    if (!ftsExists) this.database.client.prepare("insert into ai_retrieval_fts (chunk_id, projection_revision_id, subject_key, search_text) values (?, ?, ?, ?)").run(chunk.chunkId, chunk.projectionRevisionId, chunk.subjectKey, normalizeRetrievalText(chunk.text, chunk.language));
    return inserted.changes > 0;
  }

  private runAtomic<T>(operation: () => T): T {
    if (this.database.client.inTransaction) return operation();
    return this.database.client.transaction(operation).immediate();
  }
}

function setFromRow(row: AIRetrievalProjectionSetRow): AIRetrievalProjectionSet {
  return { id: row.id, subjectKey: row.subjectKey, originKind: row.originKind, originId: row.originId, strategyKey: row.strategyKey, normalizerKey: row.normalizerKey, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

function revisionFromRow(row: AIRetrievalProjectionRevisionRow): AIRetrievalProjectionRevision {
  return {
    id: row.id,
    projectionSetId: row.projectionSetId,
    revision: row.revision,
    inputFingerprint: row.inputFingerprint,
    strategyKey: row.strategyKey,
    strategyRevision: row.strategyRevision,
    normalizerKey: row.normalizerKey,
    normalizerRevision: row.normalizerRevision,
    status: row.status,
    isCurrent: row.isCurrent,
    sourceCursor: row.sourceCursor as AIRetrievalSourceCursor | null,
    batchCount: row.batchCount,
    chunkCount: row.chunkCount,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    readyAt: row.readyAt,
    failedAt: row.failedAt,
    safeErrorCode: row.safeErrorCode,
  };
}

function chunkFromRow(row: AIRetrievalChunkRow): AIRetrievalChunk {
  return {
    chunkId: row.chunkId,
    projectionRevisionId: row.projectionRevisionId,
    subjectKey: row.subjectKey,
    originKind: row.originKind,
    originId: row.originId,
    originRevision: row.originRevision,
    originContentRevision: row.originContentRevision,
    sourceId: row.sourceId,
    sourceRevision: row.sourceRevision,
    sourceType: row.sourceType,
    trustTier: row.trustTier,
    artifactSha256: row.artifactSha256,
    sourceItemId: row.sourceItemId,
    sourceItemOrder: row.sourceItemOrder,
    questionId: row.questionId,
    questionRevision: row.questionRevision,
    variantId: row.variantId,
    variantRevision: row.variantRevision,
    chunkOrdinal: row.chunkOrdinal,
    text: row.text,
    textHash: row.textHash,
    language: row.language,
    provenance: row.provenance as AIKnowledgeDocumentProvenance | null,
    originMetadata: row.originMetadata as Record<string, unknown>,
    strategyKey: row.strategyKey,
    strategyRevision: row.strategyRevision,
    normalizerKey: row.normalizerKey,
    normalizerRevision: row.normalizerRevision,
    createdAt: row.createdAt,
  };
}
