import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import type { ContentDatabase } from "../../content/database";
import {
  aiMemoryPolicies,
  aiMemoryPolicyRevisions,
  aiMemories,
  aiMemoryProvenance,
  aiConversations,
  type AIMemoryRow,
} from "../../content/schema";
import type { AIContextMemory, AIMemory, AIMemoryRepository, AIMemoryScope, AIMemoryProvenance } from "./contracts";
import { AI_MEMORY_PURGE_BATCH_SIZE, AIMemoryError } from "./contracts";

const MAX_TIMESTAMP = 8_640_000_000_000_000;
const SHA256 = /^[0-9a-f]{64}$/u;

export class SQLiteAIMemoryRepository implements AIMemoryRepository {
  constructor(private readonly database: ContentDatabase) {}

  getById(input: { principalRef: string; memoryId: string; subjectKey?: string }): AIMemory | null {
    const row = this.database.db.select().from(aiMemories).where(and(
      eq(aiMemories.id, input.memoryId),
      eq(aiMemories.principalRef, input.principalRef),
      input.subjectKey === undefined ? undefined : eq(aiMemories.subjectKey, input.subjectKey),
    )).get();
    return row ? fromRow(row) : null;
  }

  listEligible(input: { principalRef: string; subjectKey: string; at: number; limit: number }): AIContextMemory[] {
    return this.listEligibleByScope({ principalRef: input.principalRef, scope: "SUBJECT", subjectKey: input.subjectKey, at: input.at, limit: input.limit });
  }

  listEligibleByScope(input: { principalRef: string; scope: AIMemoryScope; subjectKey: string | null; at: number; limit: number }): AIContextMemory[] {
    assertScope(input.scope, input.subjectKey);
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new AIMemoryError("AI_MEMORY_INVALID", "The Memory selection limit is invalid.");
    const rows = this.database.db.select({ memory: aiMemories }).from(aiMemories)
      .innerJoin(aiMemoryPolicies, eq(aiMemories.memoryPolicyId, aiMemoryPolicies.id))
      .innerJoin(aiMemoryPolicyRevisions, and(
        eq(aiMemoryPolicyRevisions.memoryPolicyId, aiMemoryPolicies.id),
        eq(aiMemoryPolicyRevisions.revision, aiMemoryPolicies.currentRevision),
      ))
      .innerJoin(aiConversations, eq(aiMemories.sourceConversationId, aiConversations.id))
      .where(and(
        eq(aiMemories.principalRef, input.principalRef),
        eq(aiMemories.scope, input.scope),
        input.subjectKey === null ? isNull(aiMemories.subjectKey) : eq(aiMemories.subjectKey, input.subjectKey),
        eq(aiMemories.status, "ACTIVE"),
        isNull(aiMemories.deletedAt),
        isNull(aiMemories.resolvedAt),
        gt(aiMemories.expiresAt, input.at),
        isNotNull(aiMemories.memoryText),
        or(
          sql`exists (select 1 from ai_memory_provenance evidence where evidence.memory_id = ${aiMemories.id} and evidence.memory_revision = ${aiMemories.revision} and evidence.source_state = 'ACTIVE')`,
          sql`${aiMemories.creationOrigin} = 'EXPLICIT' and exists (select 1 from ai_memory_provenance evidence where evidence.memory_id = ${aiMemories.id} and evidence.memory_revision = ${aiMemories.revision})`,
          sql`${aiMemories.creationOrigin} = 'LEGACY_SUBJECT' and ${aiConversations.status} = 'ACTIVE'`,
        ),
        eq(aiMemoryPolicies.scope, input.scope),
        input.subjectKey === null ? isNull(aiMemoryPolicies.subjectKey) : eq(aiMemoryPolicies.subjectKey, input.subjectKey),
        eq(aiMemoryPolicies.scope, input.scope),
        eq(aiMemoryPolicyRevisions.enabled, true),
      )).orderBy(
        desc(aiMemories.confidenceUnits),
        desc(aiMemories.updatedAt),
        asc(aiMemories.id),
      ).limit(input.limit).all();
    return rows.map((row) => memoryContextFromRow(row.memory));
  }

  listByScope(input: { principalRef: string; scope: AIMemoryScope; subjectKey: string | null; statuses: AIMemory["status"][]; limit?: number }): AIMemory[] {
    assertScope(input.scope, input.subjectKey);
    if (!input.statuses.length) return [];
    const rows = this.database.db.select().from(aiMemories).where(and(
      eq(aiMemories.principalRef, input.principalRef),
      eq(aiMemories.scope, input.scope),
      input.subjectKey === null ? isNull(aiMemories.subjectKey) : eq(aiMemories.subjectKey, input.subjectKey),
      inArray(aiMemories.status, input.statuses),
    )).orderBy(asc(aiMemories.updatedAt), asc(aiMemories.id)).limit(input.limit ?? 100).all();
    return rows.map(fromRow);
  }

  countByScope(input: { principalRef: string; scope: AIMemoryScope; subjectKey: string | null; status: AIMemory["status"] }): number {
    assertScope(input.scope, input.subjectKey);
    const row = this.database.db.select({ value: count() }).from(aiMemories).where(and(
      eq(aiMemories.principalRef, input.principalRef),
      eq(aiMemories.scope, input.scope),
      input.subjectKey === null ? isNull(aiMemories.subjectKey) : eq(aiMemories.subjectKey, input.subjectKey),
      eq(aiMemories.status, input.status),
    )).get();
    return Number(row?.value ?? 0);
  }

  insertMemory(input: Omit<AIMemory, "id"> & { id: string }): AIMemory {
    validateMemoryInput(input);
    try {
      const row = this.database.db.insert(aiMemories).values({
        id: input.id,
        principalRef: input.principalRef,
        scope: input.scope,
        subjectKey: input.subjectKey,
        memoryPolicyId: input.memoryPolicyId,
        memoryPolicyRevision: input.memoryPolicyRevision,
        revision: input.revision,
        status: input.status,
        visibilityScope: input.visibilityScope,
        creationOrigin: input.creationOrigin,
        kind: input.kind,
        sourceConversationId: input.sourceConversationId,
        sourceStartOrdinal: input.sourceStartOrdinal,
        sourceEndOrdinal: input.sourceEndOrdinal,
        memoryText: input.memoryText,
        confidenceUnits: input.confidenceUnits,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
        reviewedAt: input.reviewedAt,
        resolvedAt: input.resolvedAt,
        deletedAt: input.deletedAt,
        expiresAt: input.expiresAt,
        safeReviewCode: input.safeReviewCode,
        contentSha256: input.contentSha256,
      }).returning().get();
      return fromRow(row);
    } catch (error) {
      throw new AIMemoryError("AI_MEMORY_INVALID", "The Memory could not be created safely.", {}, error);
    }
  }

  /** Historical name retained as a safe Subject/PROPOSED compatibility alias. */
  insertCandidate(input: Omit<AIMemory, "id"> & { id: string }): AIMemory {
    return this.insertMemory(input);
  }

  updateCurrent(input: { id: string; principalRef: string; expectedRevision: number; patch: Partial<Pick<AIMemory, "status" | "kind" | "memoryText" | "confidenceUnits" | "expiresAt" | "safeReviewCode" | "reviewedAt" | "resolvedAt" | "deletedAt" | "contentSha256">>; revision: number; updatedAt: number }): AIMemory {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || input.revision !== input.expectedRevision + 1 || !Number.isSafeInteger(input.updatedAt) || input.updatedAt < 0 || input.updatedAt > MAX_TIMESTAMP) throw new AIMemoryError("AI_MEMORY_REVISION_CONFLICT", "The Memory revision update is invalid.");
    try {
      const row = this.database.db.update(aiMemories).set({
        ...input.patch,
        revision: input.revision,
        updatedAt: input.updatedAt,
      }).where(and(eq(aiMemories.id, input.id), eq(aiMemories.principalRef, input.principalRef), eq(aiMemories.revision, input.expectedRevision))).returning().get();
      if (!row) throw new AIMemoryError("AI_MEMORY_REVISION_CONFLICT", "The Memory changed before it could be updated.");
      return fromRow(row);
    } catch (error) {
      if (error instanceof AIMemoryError) throw error;
      throw new AIMemoryError("AI_MEMORY_LIFECYCLE_CONFLICT", "The Memory could not be updated safely.", {}, error);
    }
  }

  review(input: { id: string; principalRef: string; status: "ACTIVE" | "RESOLVED"; reviewedAt: number; safeReviewCode: AIMemory["safeReviewCode"] }): AIMemory {
    const current = this.getById({ principalRef: input.principalRef, memoryId: input.id });
    if (!current || current.status !== "PROPOSED") throw new AIMemoryError("AI_MEMORY_LIFECYCLE_CONFLICT", "The Memory proposal is unavailable for review.");
    if (!Number.isSafeInteger(input.reviewedAt) || input.reviewedAt < current.createdAt || input.reviewedAt > MAX_TIMESTAMP) throw new AIMemoryError("AI_MEMORY_INVALID", "The Memory review timestamp is invalid.");
    const provenance = input.status === "ACTIVE" ? this.listProvenance(current.id, current.revision).filter((row) => row.sourceState === "ACTIVE") : [];
    const operation = (): AIMemory => {
      const patch = input.status === "ACTIVE"
        ? { status: "ACTIVE" as const, safeReviewCode: input.safeReviewCode, resolvedAt: null, deletedAt: null }
        : { status: "RESOLVED" as const, safeReviewCode: input.safeReviewCode, memoryText: null, resolvedAt: input.reviewedAt, deletedAt: null };
      const updated = this.updateCurrent({ id: current.id, principalRef: current.principalRef, expectedRevision: current.revision, revision: current.revision + 1, updatedAt: input.reviewedAt, patch });
      for (const row of provenance) this.insertProvenance({ id: uuidv7(), memoryId: updated.id, memoryRevision: updated.revision, principalRef: updated.principalRef, scope: updated.scope, subjectKey: updated.subjectKey, conversationId: row.conversationId, responseId: row.responseId, requestMessageId: row.requestMessageId, assistantMessageId: row.assistantMessageId, sourceStartOrdinal: row.sourceStartOrdinal, sourceEndOrdinal: row.sourceEndOrdinal, sourceState: "ACTIVE", createdAt: row.createdAt });
      return updated;
    };
    return this.database.client.inTransaction ? operation() : this.database.client.transaction(operation).immediate();
  }

  insertProvenance(input: Omit<AIMemoryProvenance, "id"> & { id: string }): AIMemoryProvenance {
    validateProvenanceInput(input);
    try {
      const row = this.database.db.insert(aiMemoryProvenance).values({
        id: input.id,
        memoryId: input.memoryId,
        memoryRevision: input.memoryRevision,
        principalRef: input.principalRef,
        scope: input.scope,
        subjectKey: input.subjectKey,
        conversationId: input.conversationId,
        responseId: input.responseId,
        requestMessageId: input.requestMessageId,
        assistantMessageId: input.assistantMessageId,
        sourceStartOrdinal: input.sourceStartOrdinal,
        sourceEndOrdinal: input.sourceEndOrdinal,
        sourceState: input.sourceState,
        createdAt: input.createdAt,
      }).returning().get();
      return provenanceFromRow(row);
    } catch (error) {
      throw new AIMemoryError("AI_MEMORY_PROVENANCE_INVALID", "The Memory provenance could not be recorded safely.", {}, error);
    }
  }

  listProvenance(memoryId: string, memoryRevision?: number): AIMemoryProvenance[] {
    return this.database.db.select().from(aiMemoryProvenance).where(and(eq(aiMemoryProvenance.memoryId, memoryId), memoryRevision === undefined ? undefined : eq(aiMemoryProvenance.memoryRevision, memoryRevision))).orderBy(asc(aiMemoryProvenance.createdAt), asc(aiMemoryProvenance.id)).all().map(provenanceFromRow);
  }

  purgeForConversationInTransaction(input: { conversationId: string; principalRef: string; at: number }): number {
    assertTimestamp(input.at);
    const provenanceRows = this.database.db.select().from(aiMemoryProvenance).where(and(eq(aiMemoryProvenance.conversationId, input.conversationId), eq(aiMemoryProvenance.principalRef, input.principalRef), eq(aiMemoryProvenance.sourceState, "ACTIVE"))).all();
    for (const row of provenanceRows) this.database.db.update(aiMemoryProvenance).set({ sourceState: "DELETED" }).where(and(eq(aiMemoryProvenance.id, row.id), eq(aiMemoryProvenance.sourceState, "ACTIVE"))).run();
    const memoryIds = [...new Set(provenanceRows.map((row) => row.memoryId))];
    let count = 0;
    for (const memoryId of memoryIds) {
      const memory = this.getById({ principalRef: input.principalRef, memoryId });
      if (!memory || memory.status !== "ACTIVE" && memory.status !== "PROPOSED") continue;
      if (memory.creationOrigin === "EXPLICIT") continue;
      const policyRevision = this.database.db.select({ minimum: aiMemoryPolicyRevisions.inferredMinDistinctEvidenceTurns }).from(aiMemoryPolicyRevisions).where(and(eq(aiMemoryPolicyRevisions.memoryPolicyId, memory.memoryPolicyId), eq(aiMemoryPolicyRevisions.revision, memory.memoryPolicyRevision))).get();
      const remainingEvidence = this.database.db.select({ value: sql<number>`count(distinct ${aiMemoryProvenance.responseId})` }).from(aiMemoryProvenance).where(and(eq(aiMemoryProvenance.memoryId, memory.id), eq(aiMemoryProvenance.memoryRevision, memory.revision), eq(aiMemoryProvenance.sourceState, "ACTIVE"))).get();
      const minimum = policyRevision?.minimum ?? 2;
      if (Number(remainingEvidence?.value ?? 0) < minimum) {
        const updated = this.database.db.update(aiMemories).set({ status: "RESOLVED", memoryText: null, resolvedAt: input.at, updatedAt: input.at, revision: sql`${aiMemories.revision} + 1`, contentSha256: memory.contentSha256, safeReviewCode: "MEMORY_RESOLVED" }).where(and(eq(aiMemories.id, memory.id), eq(aiMemories.principalRef, input.principalRef), inArray(aiMemories.status, ["ACTIVE", "PROPOSED"]))).run();
        count += updated.changes;
      }
    }
    return count;
  }

  purgeForPrincipalInTransaction(input: { principalRef: string; at: number; limit?: number }): number {
    const limit = input.limit ?? AI_MEMORY_PURGE_BATCH_SIZE;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > AI_MEMORY_PURGE_BATCH_SIZE) throw new AIMemoryError("AI_MEMORY_INVALID", "The Memory principal purge limit is invalid.");
    assertTimestamp(input.at);
    const rows = this.database.db.select({ id: aiMemories.id }).from(aiMemories).where(and(eq(aiMemories.principalRef, input.principalRef), inArray(aiMemories.status, ["PROPOSED", "ACTIVE"]))).orderBy(asc(aiMemories.createdAt), asc(aiMemories.id)).limit(limit).all();
    const rowIds = rows.map((row) => row.id);
    let count = 0;
    for (const row of rows) {
      const result = this.database.db.update(aiMemories).set({ status: "DELETED", memoryText: null, deletedAt: input.at, updatedAt: input.at, revision: sql`${aiMemories.revision} + 1`, safeReviewCode: "PRINCIPAL_PURGED" }).where(and(eq(aiMemories.id, row.id), eq(aiMemories.principalRef, input.principalRef), inArray(aiMemories.status, ["PROPOSED", "ACTIVE"]))).run();
      count += result.changes;
    }
    const provenanceRows = this.database.db.select({ id: aiMemoryProvenance.id }).from(aiMemoryProvenance)
      .innerJoin(aiMemories, eq(aiMemoryProvenance.memoryId, aiMemories.id))
      .leftJoin(aiConversations, eq(aiMemoryProvenance.conversationId, aiConversations.id))
      .where(and(
        eq(aiMemoryProvenance.principalRef, input.principalRef),
        eq(aiMemoryProvenance.sourceState, "ACTIVE"),
        or(
          rowIds.length ? inArray(aiMemoryProvenance.memoryId, rowIds) : undefined,
          inArray(aiMemories.status, ["RESOLVED", "EXPIRED", "DELETED"]),
          eq(aiConversations.status, "DELETED"),
        ),
      )).orderBy(asc(aiMemoryProvenance.createdAt), asc(aiMemoryProvenance.id)).limit(limit).all();
    for (const row of provenanceRows) this.database.db.update(aiMemoryProvenance).set({ sourceState: "DELETED" }).where(and(eq(aiMemoryProvenance.id, row.id), eq(aiMemoryProvenance.sourceState, "ACTIVE"))).run();
    return count;
  }
}

function fromRow(row: AIMemoryRow): AIMemory {
  return {
    id: row.id,
    principalRef: row.principalRef,
    scope: row.scope,
    subjectKey: row.subjectKey,
    memoryPolicyId: row.memoryPolicyId,
    memoryPolicyRevision: row.memoryPolicyRevision,
    revision: row.revision,
    status: row.status,
    visibilityScope: row.visibilityScope,
    creationOrigin: row.creationOrigin,
    kind: row.kind,
    sourceConversationId: row.sourceConversationId,
    sourceStartOrdinal: row.sourceStartOrdinal,
    sourceEndOrdinal: row.sourceEndOrdinal,
    memoryText: row.memoryText,
    confidenceUnits: row.confidenceUnits,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    reviewedAt: row.reviewedAt,
    resolvedAt: row.resolvedAt,
    deletedAt: row.deletedAt,
    expiresAt: row.expiresAt,
    safeReviewCode: row.safeReviewCode,
    contentSha256: row.contentSha256,
  };
}

function memoryContextFromRow(row: AIMemoryRow): AIContextMemory {
  if (row.memoryText === null) throw new AIMemoryError("AI_MEMORY_INVALID", "An eligible Memory has no text.");
  return {
    memoryId: row.id,
    revision: row.revision,
    scope: row.scope,
    subjectKey: row.subjectKey,
    text: row.memoryText,
    confidenceUnits: row.confidenceUnits,
    sourceConversationId: row.sourceConversationId,
    sourceStartOrdinal: row.sourceStartOrdinal,
    sourceEndOrdinal: row.sourceEndOrdinal,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

function provenanceFromRow(row: typeof aiMemoryProvenance.$inferSelect): AIMemoryProvenance {
  return {
    id: row.id,
    memoryId: row.memoryId,
    memoryRevision: row.memoryRevision,
    principalRef: row.principalRef,
    scope: row.scope,
    subjectKey: row.subjectKey,
    conversationId: row.conversationId,
    responseId: row.responseId,
    requestMessageId: row.requestMessageId,
    assistantMessageId: row.assistantMessageId,
    sourceStartOrdinal: row.sourceStartOrdinal,
    sourceEndOrdinal: row.sourceEndOrdinal,
    sourceState: row.sourceState as "ACTIVE" | "DELETED",
    createdAt: row.createdAt,
  };
}

function assertScope(scope: AIMemoryScope, subjectKey: string | null): void {
  if (scope === "GLOBAL" ? subjectKey !== null : subjectKey === null) throw new AIMemoryError("AI_MEMORY_SCOPE_MISMATCH", "The Memory scope and subject are inconsistent.");
}

function validateMemoryInput(input: Omit<AIMemory, "id"> & { id: string }): void {
  assertScope(input.scope, input.subjectKey);
  if (!Number.isSafeInteger(input.revision) || input.revision < 1 || !Number.isSafeInteger(input.updatedAt) || input.updatedAt < input.createdAt || input.updatedAt > MAX_TIMESTAMP || (input.contentSha256 !== null && !SHA256.test(input.contentSha256))) throw new AIMemoryError("AI_MEMORY_INVALID", "The Memory identity or revision metadata is invalid.");
}

function validateProvenanceInput(input: Omit<AIMemoryProvenance, "id"> & { id: string }): void {
  assertScope(input.scope, input.subjectKey);
  if (!Number.isSafeInteger(input.memoryRevision) || input.memoryRevision < 1 || !Number.isSafeInteger(input.sourceStartOrdinal) || input.sourceStartOrdinal < 1 || !Number.isSafeInteger(input.sourceEndOrdinal) || input.sourceEndOrdinal < input.sourceStartOrdinal || input.sourceEndOrdinal - input.sourceStartOrdinal + 1 > 10_000 || !Number.isSafeInteger(input.createdAt) || input.createdAt < 0 || input.createdAt > MAX_TIMESTAMP) throw new AIMemoryError("AI_MEMORY_PROVENANCE_INVALID", "The Memory provenance metadata is invalid.");
}

function assertTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMESTAMP) throw new AIMemoryError("AI_MEMORY_INVALID", "The Memory timestamp is invalid.");
}
