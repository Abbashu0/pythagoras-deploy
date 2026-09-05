import { and, asc, count, eq, inArray } from "drizzle-orm";

import type { ContentDatabase } from "../../content/database";
import {
  aiMemoryMutationIntents,
  aiMemoryMutationRecords,
} from "../../content/schema";
import type { AIMemoryMutationIntent, AIMemoryMutationRecord, AIMemoryMutationRepository } from "./contracts";
import { AIMemoryError } from "./contracts";

const MAX_TIMESTAMP = 8_640_000_000_000_000;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_CODE = /^[A-Z0-9_.-]{1,120}$/u;

export class SQLiteAIMemoryMutationRepository implements AIMemoryMutationRepository {
  constructor(private readonly database: ContentDatabase) {}

  getIntent(commandId: string): AIMemoryMutationIntent | null {
    const row = this.database.db.select().from(aiMemoryMutationIntents).where(eq(aiMemoryMutationIntents.commandId, commandId)).get();
    return row ? intentFromRow(row) : null;
  }

  insertIntent(input: Omit<AIMemoryMutationIntent, "id" | "contentSha256"> & { id: string; contentSha256: string | null }): AIMemoryMutationIntent {
    validateTimestamp(input.createdAt);
    if (input.appliedAt !== null) throw new AIMemoryError("AI_MEMORY_MUTATION_INVALID", "A new Memory mutation intent cannot be applied.");
    if (input.contentSha256 !== null && !SHA256.test(input.contentSha256)) throw new AIMemoryError("AI_MEMORY_MUTATION_INVALID", "The Memory mutation content hash is invalid.");
    try {
      const row = this.database.db.insert(aiMemoryMutationIntents).values({
        id: input.id,
        commandId: input.commandId,
        principalRef: input.principalRef,
        responseId: input.responseId,
        conversationId: input.conversationId,
        scope: input.scope,
        subjectKey: input.subjectKey,
        action: input.action,
        memoryId: input.memoryId,
        expectedRevision: input.expectedRevision,
        kind: input.kind,
        origin: input.origin,
        confidenceUnits: input.confidenceUnits,
        memoryText: input.memoryText,
        status: "PENDING",
        contentSha256: input.contentSha256,
        createdAt: input.createdAt,
        appliedAt: null,
      }).returning().get();
      return intentFromRow(row);
    } catch (error) {
      throw new AIMemoryError("AI_MEMORY_MUTATION_INVALID", "The Memory mutation intent could not be persisted safely.", {}, error);
    }
  }

  markIntentApplied(commandId: string, appliedAt: number): AIMemoryMutationIntent {
    validateTimestamp(appliedAt);
    const row = this.database.db.update(aiMemoryMutationIntents).set({ status: "APPLIED", memoryText: null, appliedAt }).where(and(eq(aiMemoryMutationIntents.commandId, commandId), eq(aiMemoryMutationIntents.status, "PENDING"))).returning().get();
    if (!row) {
      const existing = this.getIntent(commandId);
      if (existing?.status === "APPLIED") return existing;
      throw new AIMemoryError("AI_MEMORY_MUTATION_INVALID", "The Memory mutation intent changed before application.");
    }
    return intentFromRow(row);
  }

  markIntentFailed(commandId: string, safeErrorCode: string, at: number): AIMemoryMutationIntent {
    validateTimestamp(at);
    if (!SAFE_CODE.test(safeErrorCode)) throw new AIMemoryError("AI_MEMORY_MUTATION_INVALID", "The Memory mutation failure code is invalid.");
    const row = this.database.db.update(aiMemoryMutationIntents).set({ status: "FAILED", memoryText: null, appliedAt: at }).where(and(eq(aiMemoryMutationIntents.commandId, commandId), eq(aiMemoryMutationIntents.status, "PENDING"))).returning().get();
    if (!row) {
      const existing = this.getIntent(commandId);
      if (existing && ["FAILED", "CANCELLED"].includes(existing.status)) return existing;
      throw new AIMemoryError("AI_MEMORY_MUTATION_INVALID", "The Memory mutation intent changed before failure was recorded.");
    }
    return intentFromRow(row);
  }

  markIntentCancelled(commandId: string, at: number): AIMemoryMutationIntent {
    validateTimestamp(at);
    const row = this.database.db.update(aiMemoryMutationIntents).set({ status: "CANCELLED", memoryText: null, appliedAt: at }).where(and(eq(aiMemoryMutationIntents.commandId, commandId), eq(aiMemoryMutationIntents.status, "PENDING"))).returning().get();
    if (!row) {
      const existing = this.getIntent(commandId);
      if (existing?.status === "CANCELLED") return existing;
      throw new AIMemoryError("AI_MEMORY_MUTATION_INVALID", "The Memory mutation intent changed before cancellation.");
    }
    return intentFromRow(row);
  }

  cancelPendingForPrincipal(principalRef: string, at: number, limit: number): number {
    validateTimestamp(at);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new AIMemoryError("AI_MEMORY_MUTATION_INVALID", "The Memory purge limit is invalid.");
    const rows = this.database.db.select({ id: aiMemoryMutationIntents.id }).from(aiMemoryMutationIntents)
      .where(and(eq(aiMemoryMutationIntents.principalRef, principalRef), eq(aiMemoryMutationIntents.status, "PENDING")))
      .orderBy(asc(aiMemoryMutationIntents.createdAt), asc(aiMemoryMutationIntents.id)).limit(limit).all();
    if (!rows.length) return 0;
    return this.database.db.update(aiMemoryMutationIntents).set({ status: "CANCELLED", memoryText: null, appliedAt: at })
      .where(and(eq(aiMemoryMutationIntents.status, "PENDING"), inArray(aiMemoryMutationIntents.id, rows.map((row) => row.id)))).run().changes;
  }

  countPendingForPrincipal(principalRef: string): number {
    const row = this.database.db.select({ value: count() }).from(aiMemoryMutationIntents)
      .where(and(eq(aiMemoryMutationIntents.principalRef, principalRef), eq(aiMemoryMutationIntents.status, "PENDING"))).get();
    return Number(row?.value ?? 0);
  }

  listPendingIntents(limit: number): AIMemoryMutationIntent[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new AIMemoryError("AI_MEMORY_MUTATION_INVALID", "The pending Memory mutation limit is invalid.");
    return this.database.db.select().from(aiMemoryMutationIntents).where(eq(aiMemoryMutationIntents.status, "PENDING")).orderBy(asc(aiMemoryMutationIntents.createdAt), asc(aiMemoryMutationIntents.id)).limit(limit).all().map(intentFromRow);
  }

  insertRecord(input: Omit<AIMemoryMutationRecord, "id"> & { id: string }): AIMemoryMutationRecord {
    validateTimestamp(input.createdAt);
    if (input.contentSha256 !== null && !SHA256.test(input.contentSha256)) throw new AIMemoryError("AI_MEMORY_MUTATION_INVALID", "The Memory mutation record hash is invalid.");
    if (input.safeErrorCode !== null && !SAFE_CODE.test(input.safeErrorCode)) throw new AIMemoryError("AI_MEMORY_MUTATION_INVALID", "The Memory mutation record error code is invalid.");
    try {
      const row = this.database.db.insert(aiMemoryMutationRecords).values({
        id: input.id,
        commandId: input.commandId,
        principalRef: input.principalRef,
        responseId: input.responseId,
        scope: input.scope,
        subjectKey: input.subjectKey,
        action: input.action,
        memoryId: input.memoryId,
        origin: input.origin,
        expectedRevision: input.expectedRevision,
        resultRevision: input.resultRevision,
        status: input.status,
        contentSha256: input.contentSha256,
        safeErrorCode: input.safeErrorCode,
        createdAt: input.createdAt,
      }).returning().get();
      return recordFromRow(row);
    } catch (error) {
      throw new AIMemoryError("AI_MEMORY_MUTATION_INVALID", "The Memory mutation record could not be persisted safely.", {}, error);
    }
  }

  getRecord(commandId: string): AIMemoryMutationRecord | null {
    const row = this.database.db.select().from(aiMemoryMutationRecords).where(eq(aiMemoryMutationRecords.commandId, commandId)).get();
    return row ? recordFromRow(row) : null;
  }
}

function intentFromRow(row: typeof aiMemoryMutationIntents.$inferSelect): AIMemoryMutationIntent {
  return {
    id: row.id,
    commandId: row.commandId,
    principalRef: row.principalRef,
    responseId: row.responseId,
    conversationId: row.conversationId,
    scope: row.scope,
    subjectKey: row.subjectKey,
    action: row.action as AIMemoryMutationIntent["action"],
    memoryId: row.memoryId,
    expectedRevision: row.expectedRevision,
    kind: row.kind,
    origin: row.origin,
    confidenceUnits: row.confidenceUnits,
    memoryText: row.memoryText,
    status: row.status as AIMemoryMutationIntent["status"],
    contentSha256: row.contentSha256,
    createdAt: row.createdAt,
    appliedAt: row.appliedAt,
  };
}

function recordFromRow(row: typeof aiMemoryMutationRecords.$inferSelect): AIMemoryMutationRecord {
  return {
    id: row.id,
    commandId: row.commandId,
    principalRef: row.principalRef,
    responseId: row.responseId,
    scope: row.scope,
    subjectKey: row.subjectKey,
    action: row.action as AIMemoryMutationRecord["action"],
    memoryId: row.memoryId,
    origin: row.origin,
    expectedRevision: row.expectedRevision,
    resultRevision: row.resultRevision,
    status: row.status as AIMemoryMutationRecord["status"],
    contentSha256: row.contentSha256,
    safeErrorCode: row.safeErrorCode,
    createdAt: row.createdAt,
  };
}

function validateTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMESTAMP) throw new AIMemoryError("AI_MEMORY_MUTATION_INVALID", "The Memory mutation timestamp is invalid.");
}
