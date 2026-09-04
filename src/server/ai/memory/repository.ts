import { and, asc, desc, eq, gt, inArray, isNotNull } from "drizzle-orm";

import type { ContentDatabase } from "../../content/database";
import {
  aiConversations,
  aiMemories,
  aiMemoryPolicies,
  aiMemoryPolicyRevisions,
  type AIMemoryRow,
} from "../../content/schema";
import type { AIContextMemory, AIMemory, AIMemoryRepository } from "./contracts";
import { AI_MEMORY_PURGE_BATCH_SIZE, AIMemoryError } from "./contracts";

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
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new AIMemoryError("AI_MEMORY_INVALID", "The Memory selection limit is invalid.");
    const rows = this.database.db.select({ memory: aiMemories }).from(aiMemories)
      .innerJoin(aiConversations, eq(aiMemories.sourceConversationId, aiConversations.id))
      .innerJoin(aiMemoryPolicies, eq(aiMemories.memoryPolicyId, aiMemoryPolicies.id))
      .innerJoin(aiMemoryPolicyRevisions, and(
        eq(aiMemoryPolicyRevisions.memoryPolicyId, aiMemoryPolicies.id),
        eq(aiMemoryPolicyRevisions.revision, aiMemoryPolicies.currentRevision),
      ))
      .where(and(
        eq(aiMemories.principalRef, input.principalRef),
        eq(aiMemories.subjectKey, input.subjectKey),
        eq(aiMemories.status, "APPROVED"),
        isNotNull(aiMemories.memoryText),
        gt(aiMemories.expiresAt, input.at),
        eq(aiConversations.principalRef, input.principalRef),
        eq(aiConversations.subjectKey, input.subjectKey),
        eq(aiConversations.status, "ACTIVE"),
        eq(aiMemoryPolicies.subjectKey, input.subjectKey),
        eq(aiMemoryPolicyRevisions.enabled, true),
      )).orderBy(
        desc(aiMemories.confidenceUnits),
        desc(aiMemories.createdAt),
        asc(aiMemories.id),
      ).limit(input.limit).all();
    return rows.map((row) => memoryContextFromRow(row.memory));
  }

  insertCandidate(input: Omit<AIMemory, "id"> & { id: string }): AIMemory {
    try {
      const row = this.database.db.insert(aiMemories).values({
        id: input.id,
        principalRef: input.principalRef,
        subjectKey: input.subjectKey,
        memoryPolicyId: input.memoryPolicyId,
        memoryPolicyRevision: input.memoryPolicyRevision,
        revision: input.revision,
        status: input.status,
        visibilityScope: input.visibilityScope,
        creationOrigin: input.creationOrigin,
        sourceConversationId: input.sourceConversationId,
        sourceStartOrdinal: input.sourceStartOrdinal,
        sourceEndOrdinal: input.sourceEndOrdinal,
        memoryText: input.memoryText,
        confidenceUnits: input.confidenceUnits,
        createdAt: input.createdAt,
        reviewedAt: input.reviewedAt,
        deletedAt: input.deletedAt,
        expiresAt: input.expiresAt,
        safeReviewCode: input.safeReviewCode,
      }).returning().get();
      return fromRow(row);
    } catch (error) {
      throw new AIMemoryError("AI_MEMORY_INVALID", "The Memory candidate could not be created safely.", {}, error);
    }
  }

  review(input: { id: string; principalRef: string; status: "APPROVED" | "REJECTED"; reviewedAt: number; safeReviewCode: "STUDENT_APPROVED" | "STUDENT_REJECTED" }): AIMemory {
    const row = this.database.db.update(aiMemories).set({
      status: input.status,
      reviewedAt: input.reviewedAt,
      safeReviewCode: input.safeReviewCode,
    }).where(and(
      eq(aiMemories.id, input.id),
      eq(aiMemories.principalRef, input.principalRef),
      eq(aiMemories.status, "CANDIDATE"),
    )).returning().get();
    if (!row) throw new AIMemoryError("AI_MEMORY_LIFECYCLE_CONFLICT", "The Memory candidate is unavailable for review.");
    return fromRow(row);
  }

  purgeForConversationInTransaction(input: { conversationId: string; principalRef: string; at: number }): number {
    const result = this.database.db.update(aiMemories).set({
      status: "DELETED",
      memoryText: null,
      deletedAt: input.at,
      safeReviewCode: "CONVERSATION_DELETED",
    }).where(and(
      eq(aiMemories.sourceConversationId, input.conversationId),
      eq(aiMemories.principalRef, input.principalRef),
      inArray(aiMemories.status, ["CANDIDATE", "APPROVED", "REJECTED"]),
    )).run();
    return result.changes;
  }

  purgeForPrincipalInTransaction(input: { principalRef: string; at: number; limit?: number }): number {
    const limit = input.limit ?? AI_MEMORY_PURGE_BATCH_SIZE;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > AI_MEMORY_PURGE_BATCH_SIZE) throw new AIMemoryError("AI_MEMORY_INVALID", "The Memory principal purge limit is invalid.");
    const rows = this.database.db.select({ id: aiMemories.id }).from(aiMemories)
      .innerJoin(aiConversations, eq(aiMemories.sourceConversationId, aiConversations.id))
      .where(and(
        eq(aiMemories.principalRef, input.principalRef),
        eq(aiConversations.status, "DELETED"),
        inArray(aiMemories.status, ["CANDIDATE", "APPROVED", "REJECTED"]),
      ))
      .orderBy(asc(aiMemories.createdAt), asc(aiMemories.id))
      .limit(limit)
      .all();
    let count = 0;
    for (const row of rows) {
      const result = this.database.db.update(aiMemories).set({
        status: "DELETED",
        memoryText: null,
        deletedAt: input.at,
        safeReviewCode: "CONVERSATION_DELETED",
      }).where(and(eq(aiMemories.id, row.id), inArray(aiMemories.status, ["CANDIDATE", "APPROVED", "REJECTED"]))).run();
      count += result.changes;
    }
    return count;
  }
}

function fromRow(row: AIMemoryRow): AIMemory {
  return {
    id: row.id,
    principalRef: row.principalRef,
    subjectKey: row.subjectKey,
    memoryPolicyId: row.memoryPolicyId,
    memoryPolicyRevision: row.memoryPolicyRevision,
    revision: row.revision,
    status: row.status,
    visibilityScope: row.visibilityScope,
    creationOrigin: row.creationOrigin,
    sourceConversationId: row.sourceConversationId,
    sourceStartOrdinal: row.sourceStartOrdinal,
    sourceEndOrdinal: row.sourceEndOrdinal,
    memoryText: row.memoryText,
    confidenceUnits: row.confidenceUnits,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt,
    deletedAt: row.deletedAt,
    expiresAt: row.expiresAt,
    safeReviewCode: row.safeReviewCode,
  };
}

function memoryContextFromRow(row: AIMemoryRow): AIContextMemory {
  if (row.memoryText === null) throw new AIMemoryError("AI_MEMORY_INVALID", "An eligible Memory has no text.");
  return {
    memoryId: row.id,
    revision: row.revision,
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
