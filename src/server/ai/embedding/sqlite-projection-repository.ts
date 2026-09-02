import { and, asc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import type { ContentDatabase } from "../../content/database";
import {
  aiEmbeddingProjectionRevisions,
  aiEmbeddingProjectionSets,
  type AIEmbeddingProjectionRevisionRow,
  type AIEmbeddingProjectionSetRow,
} from "../../content/schema";
import type {
  AIEmbeddingProjectionRepository,
  AIEmbeddingProjectionRevision,
  AIEmbeddingProjectionSet,
  AIEmbeddingProjectionStatus,
  AIEmbeddingSourceCursor,
  AIEmbeddingVectorCodecKey,
} from "./contracts";
import { AIEmbeddingError } from "./errors";

export class SQLiteAIEmbeddingProjectionRepository implements AIEmbeddingProjectionRepository {
  constructor(private readonly database: ContentDatabase) {}

  getOrCreateSet(input: {
    subjectKey: string;
    chunkProjectionSetId: string;
    modelConfigId: string;
    vectorCodecKey: AIEmbeddingVectorCodecKey;
    vectorCodecRevision: number;
    vectorIndexAdapterKey: string;
    now: number;
  }): AIEmbeddingProjectionSet {
    const existing = this.getSet(input);
    if (existing) return existing;
    try {
      this.database.db.insert(aiEmbeddingProjectionSets).values({
        id: uuidv7(),
        subjectKey: input.subjectKey,
        chunkProjectionSetId: input.chunkProjectionSetId,
        modelConfigId: input.modelConfigId,
        vectorCodecKey: input.vectorCodecKey,
        vectorCodecRevision: input.vectorCodecRevision,
        vectorIndexAdapterKey: input.vectorIndexAdapterKey,
        createdAt: input.now,
        updatedAt: input.now,
      }).run();
    } catch (error) {
      const raced = this.getSet(input);
      if (raced) return raced;
      throw new AIEmbeddingError("AI_EMBEDDING_PROJECTION_CONFLICT", "The embedding projection identity could not be created.", {}, { cause: error });
    }
    const created = this.getSet(input);
    if (!created) throw new AIEmbeddingError("AI_EMBEDDING_PROJECTION_CONFLICT", "The embedding projection identity could not be reloaded.");
    return created;
  }

  getSet(input: {
    subjectKey: string;
    chunkProjectionSetId: string;
    modelConfigId: string;
    vectorCodecKey: AIEmbeddingVectorCodecKey;
    vectorCodecRevision: number;
    vectorIndexAdapterKey: string;
  }): AIEmbeddingProjectionSet | null {
    const row = this.database.db.select().from(aiEmbeddingProjectionSets).where(and(
      eq(aiEmbeddingProjectionSets.subjectKey, input.subjectKey),
      eq(aiEmbeddingProjectionSets.chunkProjectionSetId, input.chunkProjectionSetId),
      eq(aiEmbeddingProjectionSets.modelConfigId, input.modelConfigId),
      eq(aiEmbeddingProjectionSets.vectorCodecKey, input.vectorCodecKey),
      eq(aiEmbeddingProjectionSets.vectorCodecRevision, input.vectorCodecRevision),
      eq(aiEmbeddingProjectionSets.vectorIndexAdapterKey, input.vectorIndexAdapterKey),
    )).get();
    return row ? setFromRow(row) : null;
  }

  getSetById(id: string): AIEmbeddingProjectionSet | null {
    const row = this.database.db.select().from(aiEmbeddingProjectionSets).where(eq(aiEmbeddingProjectionSets.id, id)).get();
    return row ? setFromRow(row) : null;
  }

  getCurrentRevision(projectionSetId: string): AIEmbeddingProjectionRevision | null {
    const row = this.database.db.select().from(aiEmbeddingProjectionRevisions).where(and(
      eq(aiEmbeddingProjectionRevisions.embeddingProjectionSetId, projectionSetId),
      eq(aiEmbeddingProjectionRevisions.isCurrent, true),
      eq(aiEmbeddingProjectionRevisions.status, "READY"),
    )).get();
    return row ? revisionFromRow(row) : null;
  }

  getCompatibleBuildingRevision(input: { projectionSetId: string; inputFingerprint: string }): AIEmbeddingProjectionRevision | null {
    const row = this.database.db.select().from(aiEmbeddingProjectionRevisions).where(and(
      eq(aiEmbeddingProjectionRevisions.embeddingProjectionSetId, input.projectionSetId),
      eq(aiEmbeddingProjectionRevisions.inputFingerprint, input.inputFingerprint),
      eq(aiEmbeddingProjectionRevisions.status, "BUILDING"),
    )).get();
    return row ? revisionFromRow(row) : null;
  }

  getRevision(id: string): AIEmbeddingProjectionRevision | null {
    const row = this.database.db.select().from(aiEmbeddingProjectionRevisions).where(eq(aiEmbeddingProjectionRevisions.id, id)).get();
    return row ? revisionFromRow(row) : null;
  }

  listRevisions(projectionSetId: string): AIEmbeddingProjectionRevision[] {
    return this.database.db.select().from(aiEmbeddingProjectionRevisions)
      .where(eq(aiEmbeddingProjectionRevisions.embeddingProjectionSetId, projectionSetId))
      .orderBy(asc(aiEmbeddingProjectionRevisions.revision))
      .all()
      .map(revisionFromRow);
  }

  createRevision(input: {
    id: string;
    embeddingProjectionSetId: string;
    revision: number;
    subjectKey: string;
    chunkProjectionSetId: string;
    chunkProjectionRevisionId: string;
    chunkProjectionInputFingerprint: string;
    chunkCount: number;
    modelConfigId: string;
    modelConfigRevision: number;
    providerConfigId: string;
    providerConfigRevision: number;
    providerModelId: string;
    embeddingAdapterKey: string;
    dimensions: number;
    vectorCodecKey: AIEmbeddingVectorCodecKey;
    vectorCodecRevision: number;
    vectorIndexAdapterKey: string;
    inputFingerprint: string;
    jobId: string;
    costOperationId: string;
    now: number;
  }): AIEmbeddingProjectionRevision {
    try {
      this.database.db.insert(aiEmbeddingProjectionRevisions).values({
        id: input.id,
        embeddingProjectionSetId: input.embeddingProjectionSetId,
        revision: input.revision,
        subjectKey: input.subjectKey,
        chunkProjectionSetId: input.chunkProjectionSetId,
        chunkProjectionRevisionId: input.chunkProjectionRevisionId,
        chunkProjectionInputFingerprint: input.chunkProjectionInputFingerprint,
        chunkCount: input.chunkCount,
        modelConfigId: input.modelConfigId,
        modelConfigRevision: input.modelConfigRevision,
        providerConfigId: input.providerConfigId,
        providerConfigRevision: input.providerConfigRevision,
        providerModelId: input.providerModelId,
        embeddingAdapterKey: input.embeddingAdapterKey,
        dimensions: input.dimensions,
        vectorCodecKey: input.vectorCodecKey,
        vectorCodecRevision: input.vectorCodecRevision,
        vectorIndexAdapterKey: input.vectorIndexAdapterKey,
        inputFingerprint: input.inputFingerprint,
        status: "BUILDING",
        isCurrent: false,
        sourceCursor: { kind: "START" },
        batchCount: 0,
        vectorCount: 0,
        jobId: input.jobId,
        costOperationId: input.costOperationId,
        startedAt: input.now,
        updatedAt: input.now,
        readyAt: null,
        failedAt: null,
        safeErrorCode: null,
      }).run();
    } catch (error) {
      throw new AIEmbeddingError("AI_EMBEDDING_PROJECTION_CONFLICT", "The embedding projection revision could not be created.", {}, { cause: error });
    }
    const created = this.getRevision(input.id);
    if (!created) throw new AIEmbeddingError("AI_EMBEDDING_PROJECTION_CONFLICT", "The embedding projection revision could not be reloaded.");
    return created;
  }

  advanceBatch(input: {
    revisionId: string;
    sourceCursor: AIEmbeddingSourceCursor;
    batchCount: number;
    vectorCount: number;
    now: number;
  }): AIEmbeddingProjectionRevision {
    const operation = (): AIEmbeddingProjectionRevision => {
      const updated = this.database.db.update(aiEmbeddingProjectionRevisions).set({
        sourceCursor: input.sourceCursor,
        batchCount: input.batchCount,
        vectorCount: input.vectorCount,
        updatedAt: input.now,
      }).where(and(
        eq(aiEmbeddingProjectionRevisions.id, input.revisionId),
        eq(aiEmbeddingProjectionRevisions.status, "BUILDING"),
      )).returning().get();
      if (!updated) throw new AIEmbeddingError("AI_EMBEDDING_PROJECTION_CONFLICT", "The embedding projection revision changed during batch persistence.");
      return revisionFromRow(updated);
    };
    try {
      return this.runAtomic(operation);
    } catch (error) {
      if (error instanceof AIEmbeddingError) throw error;
      throw new AIEmbeddingError("AI_EMBEDDING_PROJECTION_FAILED", "The embedding projection batch could not be recorded.", {}, { cause: error });
    }
  }

  markFailed(revisionId: string, safeErrorCode: string, now: number): void {
    const operation = (): void => {
      this.database.db.update(aiEmbeddingProjectionRevisions).set({
        status: "FAILED",
        isCurrent: false,
        failedAt: now,
        updatedAt: now,
        safeErrorCode,
      }).where(and(
        eq(aiEmbeddingProjectionRevisions.id, revisionId),
        eq(aiEmbeddingProjectionRevisions.status, "BUILDING"),
      )).run();
    };
    this.runAtomic(operation);
  }

  finalizeReady(revisionId: string, now: number): AIEmbeddingProjectionRevision {
    const operation = (): AIEmbeddingProjectionRevision => {
      const revision = this.getRevision(revisionId);
      if (!revision || revision.status !== "BUILDING" || revision.sourceCursor?.kind !== "DONE" || revision.vectorCount !== revision.chunkCount) {
        throw new AIEmbeddingError("AI_EMBEDDING_COVERAGE_INVALID", "The embedding projection is not complete enough to activate.");
      }
      this.database.db.update(aiEmbeddingProjectionRevisions).set({ isCurrent: false }).where(and(
        eq(aiEmbeddingProjectionRevisions.embeddingProjectionSetId, revision.embeddingProjectionSetId),
        eq(aiEmbeddingProjectionRevisions.isCurrent, true),
      )).run();
      const updated = this.database.db.update(aiEmbeddingProjectionRevisions).set({
        status: "READY",
        isCurrent: true,
        readyAt: now,
        updatedAt: now,
        safeErrorCode: null,
      }).where(and(
        eq(aiEmbeddingProjectionRevisions.id, revisionId),
        eq(aiEmbeddingProjectionRevisions.status, "BUILDING"),
        eq(aiEmbeddingProjectionRevisions.isCurrent, false),
      )).returning().get();
      if (!updated) throw new AIEmbeddingError("AI_EMBEDDING_PROJECTION_CONFLICT", "The embedding projection revision could not be activated.");
      return revisionFromRow(updated);
    };
    try {
      return this.runAtomic(operation);
    } catch (error) {
      if (error instanceof AIEmbeddingError) throw error;
      throw new AIEmbeddingError("AI_EMBEDDING_PROJECTION_FAILED", "The embedding projection could not be activated.", {}, { cause: error });
    }
  }

  private runAtomic<T>(operation: () => T): T {
    if (this.database.client.inTransaction) return operation();
    return this.database.client.transaction(operation).immediate();
  }
}

function setFromRow(row: AIEmbeddingProjectionSetRow): AIEmbeddingProjectionSet {
  return {
    id: row.id,
    subjectKey: row.subjectKey,
    chunkProjectionSetId: row.chunkProjectionSetId,
    modelConfigId: row.modelConfigId,
    vectorCodecKey: row.vectorCodecKey,
    vectorCodecRevision: row.vectorCodecRevision,
    vectorIndexAdapterKey: row.vectorIndexAdapterKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function revisionFromRow(row: AIEmbeddingProjectionRevisionRow): AIEmbeddingProjectionRevision {
  return {
    id: row.id,
    embeddingProjectionSetId: row.embeddingProjectionSetId,
    revision: row.revision,
    subjectKey: row.subjectKey,
    chunkProjectionSetId: row.chunkProjectionSetId,
    chunkProjectionRevisionId: row.chunkProjectionRevisionId,
    chunkProjectionInputFingerprint: row.chunkProjectionInputFingerprint,
    chunkCount: row.chunkCount,
    modelConfigId: row.modelConfigId,
    modelConfigRevision: row.modelConfigRevision,
    providerConfigId: row.providerConfigId,
    providerConfigRevision: row.providerConfigRevision,
    providerModelId: row.providerModelId,
    embeddingAdapterKey: row.embeddingAdapterKey,
    dimensions: row.dimensions,
    vectorCodecKey: row.vectorCodecKey,
    vectorCodecRevision: row.vectorCodecRevision,
    vectorIndexAdapterKey: row.vectorIndexAdapterKey,
    inputFingerprint: row.inputFingerprint,
    status: row.status as AIEmbeddingProjectionStatus,
    isCurrent: row.isCurrent,
    sourceCursor: row.sourceCursor as AIEmbeddingSourceCursor | null,
    batchCount: row.batchCount,
    vectorCount: row.vectorCount,
    jobId: row.jobId,
    costOperationId: row.costOperationId,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    readyAt: row.readyAt,
    failedAt: row.failedAt,
    safeErrorCode: row.safeErrorCode,
  };
}
