import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";

import type { ContentDatabase } from "../../content/database";
import {
  aiMemoryExecutionMemoryLinks,
  aiMemoryExecutions,
  type AIMemoryExecutionMemoryLinkRow,
  type AIMemoryExecutionRow,
} from "../../content/schema";
import type {
  AIMemoryExecution,
  AIMemoryExecutionRepository,
  AIMemoryExecutionStatus,
  AIMemoryExtractionResultLink,
} from "./execution-contracts";
import { AIMemoryExecutionError } from "./execution-errors";

export class SQLiteAIMemoryExecutionRepository implements AIMemoryExecutionRepository {
  constructor(private readonly database: ContentDatabase) {}

  getById(id: string): AIMemoryExecution | null {
    const row = this.database.db.select().from(aiMemoryExecutions).where(eq(aiMemoryExecutions.id, id)).get();
    return row ? fromRow(row) : null;
  }

  getByScheduleKey(scheduleKey: string): AIMemoryExecution | null {
    const row = this.database.db.select().from(aiMemoryExecutions).where(eq(aiMemoryExecutions.scheduleKey, scheduleKey)).get();
    return row ? fromRow(row) : null;
  }

  getByJobId(jobId: string): AIMemoryExecution | null {
    const row = this.database.db.select().from(aiMemoryExecutions).where(eq(aiMemoryExecutions.jobId, jobId)).get();
    return row ? fromRow(row) : null;
  }

  listPendingTerminal(limit: number): AIMemoryExecution[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_INVALID", "The Memory execution query limit is invalid.");
    return this.database.db.select().from(aiMemoryExecutions).where(inArray(aiMemoryExecutions.status, ["PENDING", "RUNNING"]))
      .orderBy(asc(aiMemoryExecutions.updatedAt), asc(aiMemoryExecutions.id)).limit(limit).all().map(fromRow);
  }

  create(input: Omit<AIMemoryExecution, "id"> & { id?: string }): AIMemoryExecution {
    try {
      const row = this.database.db.insert(aiMemoryExecutions).values({
        id: input.id ?? randomUUID(),
        executionKind: input.executionKind,
        scheduleKey: input.scheduleKey,
        principalRef: input.principalRef,
        subjectKey: input.subjectKey,
        conversationId: input.conversationId,
        responseId: input.responseId,
        requestMessageId: input.requestMessageId,
        requestOrdinal: input.requestOrdinal,
        assistantMessageId: input.assistantMessageId,
        assistantOrdinal: input.assistantOrdinal,
        executionConfigId: input.executionConfigId,
        executionConfigRevision: input.executionConfigRevision,
        executionConfigFingerprint: input.executionConfigFingerprint,
        generationModelConfigId: input.generationModelConfigId,
        generationModelConfigRevision: input.generationModelConfigRevision,
        generationProviderConfigId: input.generationProviderConfigId,
        generationProviderConfigRevision: input.generationProviderConfigRevision,
        budgetPolicyId: input.budgetPolicyId,
        budgetPolicyRevision: input.budgetPolicyRevision,
        rateLimitPolicyId: input.rateLimitPolicyId,
        rateLimitPolicyRevision: input.rateLimitPolicyRevision,
        protocolKey: input.protocolKey,
        protocolRevision: input.protocolRevision,
        memoryPolicyId: input.memoryPolicyId,
        memoryPolicyRevision: input.memoryPolicyRevision,
        baseSummaryId: input.baseSummaryId,
        baseSummaryRevision: input.baseSummaryRevision,
        baseSummaryCoverage: input.baseSummaryCoverage,
        targetCutoffOrdinal: input.targetCutoffOrdinal,
        jobId: input.jobId,
        costOperationId: input.costOperationId,
        budgetReservationId: input.budgetReservationId,
        admissionAttempt: input.admissionAttempt,
        status: input.status,
        providerInvocationState: input.providerInvocationState,
        providerInvoked: input.providerInvoked,
        resultSha256: input.resultSha256,
        resultByteSize: input.resultByteSize,
        resultCount: input.resultCount,
        resultSummaryId: input.resultSummaryId,
        resultSummaryRevision: input.resultSummaryRevision,
        safeFailureCode: input.safeFailureCode,
        createdAt: input.createdAt,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        updatedAt: input.updatedAt,
      }).returning().get();
      return fromRow(row);
    } catch (error) {
      throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_INVALID", "The Memory execution could not be created safely.", {}, error);
    }
  }

  bindJob(id: string, jobId: string, now: number): AIMemoryExecution {
    return this.updateBound(id, { jobId, updatedAt: now }, "The Memory execution Job could not be bound safely.");
  }

  bindCostOperation(id: string, costOperationId: string, now: number): AIMemoryExecution {
    return this.updateBound(id, { costOperationId, updatedAt: now }, "The Memory Cost Operation could not be bound safely.");
  }

  bindReservation(id: string, budgetReservationId: string, now: number): AIMemoryExecution {
    return this.updateBound(id, { budgetReservationId, updatedAt: now }, "The Memory Budget Reservation could not be bound safely.");
  }

  incrementAdmissionAttempt(id: string, now: number): AIMemoryExecution {
    const row = this.database.db.update(aiMemoryExecutions).set({
      admissionAttempt: sql`${aiMemoryExecutions.admissionAttempt} + 1`,
      updatedAt: now,
    }).where(and(eq(aiMemoryExecutions.id, id), lte(aiMemoryExecutions.admissionAttempt, 99))).returning().get();
    if (!row) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_INVALID", "The Memory admission retry limit was reached or the execution changed.");
    return fromRow(row);
  }

  markAdmissionRetry(id: string, safeFailureCode: string, now: number): AIMemoryExecution {
    const row = this.database.db.update(aiMemoryExecutions).set({
      status: "PENDING",
      providerInvocationState: "NOT_INVOKED",
      providerInvoked: false,
      startedAt: null,
      completedAt: null,
      safeFailureCode,
      updatedAt: now,
    }).where(and(eq(aiMemoryExecutions.id, id), inArray(aiMemoryExecutions.status, ["PENDING", "RUNNING"]), eq(aiMemoryExecutions.providerInvocationState, "NOT_INVOKED"), eq(aiMemoryExecutions.providerInvoked, false))).returning().get();
    if (!row) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_INVALID", "The Memory admission retry could not be persisted safely.");
    return fromRow(row);
  }

  markRunning(id: string, now: number): AIMemoryExecution {
    const row = this.database.db.update(aiMemoryExecutions).set({
      status: "RUNNING",
      providerInvocationState: "NOT_INVOKED",
      startedAt: now,
      completedAt: null,
      safeFailureCode: null,
      updatedAt: now,
    }).where(and(eq(aiMemoryExecutions.id, id), inArray(aiMemoryExecutions.status, ["PENDING", "RUNNING"]), eq(aiMemoryExecutions.providerInvocationState, "NOT_INVOKED"), eq(aiMemoryExecutions.providerInvoked, false))).returning().get();
    if (!row) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_INVALID", "The Memory execution cannot enter RUNNING safely.");
    return fromRow(row);
  }

  markInvoking(id: string, now: number): AIMemoryExecution {
    const row = this.database.db.update(aiMemoryExecutions).set({ status: "RUNNING", providerInvocationState: "INVOKING", startedAt: now, updatedAt: now }).where(and(eq(aiMemoryExecutions.id, id), eq(aiMemoryExecutions.status, "RUNNING"), eq(aiMemoryExecutions.providerInvocationState, "NOT_INVOKED"), eq(aiMemoryExecutions.providerInvoked, false))).returning().get();
    if (!row) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_INVALID", "The Memory Provider invocation state changed before it could begin.");
    return fromRow(row);
  }

  markInvokedWithAccounting(id: string, now: number): AIMemoryExecution {
    const row = this.database.db.update(aiMemoryExecutions).set({ providerInvocationState: "INVOKED_WITH_ACCOUNTING", providerInvoked: true, updatedAt: now }).where(and(eq(aiMemoryExecutions.id, id), eq(aiMemoryExecutions.providerInvocationState, "INVOKING"), eq(aiMemoryExecutions.providerInvoked, false))).returning().get();
    if (!row) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_INVALID", "The Memory Provider accounting state changed before completion.");
    return fromRow(row);
  }

  complete(input: { id: string; resultSha256: string; resultByteSize: number; resultCount: number; resultSummaryId?: string | null; resultSummaryRevision?: number | null; now: number }): AIMemoryExecution {
    const row = this.database.db.update(aiMemoryExecutions).set({
      status: "COMPLETED",
      resultSha256: input.resultSha256,
      resultByteSize: input.resultByteSize,
      resultCount: input.resultCount,
      resultSummaryId: input.resultSummaryId ?? null,
      resultSummaryRevision: input.resultSummaryRevision ?? null,
      completedAt: input.now,
      updatedAt: input.now,
      safeFailureCode: null,
    }).where(and(eq(aiMemoryExecutions.id, input.id), eq(aiMemoryExecutions.status, "RUNNING"), eq(aiMemoryExecutions.providerInvocationState, "INVOKED_WITH_ACCOUNTING"), eq(aiMemoryExecutions.providerInvoked, true))).returning().get();
    if (!row) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_INVALID", "The Memory execution could not complete safely.");
    return fromRow(row);
  }

  fail(input: { id: string; safeFailureCode: string; resultSha256?: string | null; resultByteSize?: number | null; now: number }): AIMemoryExecution {
    return this.terminal(input.id, "FAILED", input.safeFailureCode, input.now, input.resultSha256, input.resultByteSize);
  }

  cancel(input: { id: string; safeFailureCode: string; now: number }): AIMemoryExecution {
    return this.terminal(input.id, "CANCELLED", input.safeFailureCode, input.now);
  }

  ambiguous(input: { id: string; safeFailureCode: string; now: number }): AIMemoryExecution {
    const row = this.database.db.update(aiMemoryExecutions).set({ status: "AMBIGUOUS", providerInvocationState: "AMBIGUOUS", providerInvoked: true, safeFailureCode: input.safeFailureCode, completedAt: input.now, updatedAt: input.now }).where(and(eq(aiMemoryExecutions.id, input.id), inArray(aiMemoryExecutions.status, ["PENDING", "RUNNING"]))).returning().get();
    if (!row) return this.requireExisting(input.id);
    return fromRow(row);
  }

  inputLost(input: { id: string; safeFailureCode: string; now: number }): AIMemoryExecution {
    return this.terminal(input.id, "INPUT_LOST", input.safeFailureCode, input.now);
  }

  insertExtractionResultInTransaction(input: AIMemoryExtractionResultLink): AIMemoryExtractionResultLink {
    try {
      this.database.db.insert(aiMemoryExecutionMemoryLinks).values(input).onConflictDoNothing().run();
      const row = this.database.db.select().from(aiMemoryExecutionMemoryLinks).where(and(eq(aiMemoryExecutionMemoryLinks.executionId, input.executionId), eq(aiMemoryExecutionMemoryLinks.ordinal, input.ordinal))).get();
      if (!row || row.memoryId !== input.memoryId) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_RESULT_INVALID", "The Memory extraction result link conflicts with existing execution output.");
      return linkFromRow(row);
    } catch (error) {
      if (error instanceof AIMemoryExecutionError) throw error;
      throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_RESULT_INVALID", "The Memory extraction result link could not be persisted safely.", {}, error);
    }
  }

  listExtractionResults(executionId: string): AIMemoryExtractionResultLink[] {
    return this.database.db.select().from(aiMemoryExecutionMemoryLinks).where(eq(aiMemoryExecutionMemoryLinks.executionId, executionId)).orderBy(asc(aiMemoryExecutionMemoryLinks.ordinal)).all().map(linkFromRow);
  }

  private updateBound(id: string, patch: { jobId?: string; costOperationId?: string; budgetReservationId?: string; updatedAt: number }, message: string): AIMemoryExecution {
    const row = this.database.db.update(aiMemoryExecutions).set(patch).where(eq(aiMemoryExecutions.id, id)).returning().get();
    if (!row) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_NOT_FOUND", message);
    return fromRow(row);
  }

  private terminal(id: string, status: AIMemoryExecutionStatus, safeFailureCode: string, now: number, resultSha256: string | null = null, resultByteSize: number | null = null): AIMemoryExecution {
    const current = this.getById(id);
    if (!current) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_NOT_FOUND", "The Memory execution was not found.");
    const provenInvoked = current.providerInvoked || current.providerInvocationState === "INVOKED_WITH_ACCOUNTING";
    const row = this.database.db.update(aiMemoryExecutions).set({ status, providerInvocationState: provenInvoked ? current.providerInvocationState : "NOT_INVOKED", providerInvoked: provenInvoked, safeFailureCode, resultSha256, resultByteSize, completedAt: now, updatedAt: now }).where(and(eq(aiMemoryExecutions.id, id), inArray(aiMemoryExecutions.status, ["PENDING", "RUNNING"]))).returning().get();
    if (!row) return this.requireExisting(id);
    return fromRow(row);
  }

  private requireExisting(id: string): AIMemoryExecution {
    const execution = this.getById(id);
    if (!execution) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_NOT_FOUND", "The Memory execution was not found.");
    return execution;
  }
}

function fromRow(row: AIMemoryExecutionRow): AIMemoryExecution {
  return {
    id: row.id,
    executionKind: row.executionKind,
    scheduleKey: row.scheduleKey,
    principalRef: row.principalRef,
    subjectKey: row.subjectKey,
    conversationId: row.conversationId,
    responseId: row.responseId,
    requestMessageId: row.requestMessageId,
    requestOrdinal: row.requestOrdinal,
    assistantMessageId: row.assistantMessageId,
    assistantOrdinal: row.assistantOrdinal,
    executionConfigId: row.executionConfigId,
    executionConfigRevision: row.executionConfigRevision,
    executionConfigFingerprint: row.executionConfigFingerprint,
    generationModelConfigId: row.generationModelConfigId,
    generationModelConfigRevision: row.generationModelConfigRevision,
    generationProviderConfigId: row.generationProviderConfigId,
    generationProviderConfigRevision: row.generationProviderConfigRevision,
    budgetPolicyId: row.budgetPolicyId,
    budgetPolicyRevision: row.budgetPolicyRevision,
    rateLimitPolicyId: row.rateLimitPolicyId,
    rateLimitPolicyRevision: row.rateLimitPolicyRevision,
    protocolKey: row.protocolKey,
    protocolRevision: row.protocolRevision,
    memoryPolicyId: row.memoryPolicyId,
    memoryPolicyRevision: row.memoryPolicyRevision,
    baseSummaryId: row.baseSummaryId,
    baseSummaryRevision: row.baseSummaryRevision,
    baseSummaryCoverage: row.baseSummaryCoverage,
    targetCutoffOrdinal: row.targetCutoffOrdinal,
    jobId: row.jobId,
    costOperationId: row.costOperationId,
    budgetReservationId: row.budgetReservationId,
    admissionAttempt: row.admissionAttempt,
    status: row.status,
    providerInvocationState: row.providerInvocationState,
    providerInvoked: row.providerInvoked,
    resultSha256: row.resultSha256,
    resultByteSize: row.resultByteSize,
    resultCount: row.resultCount,
    resultSummaryId: row.resultSummaryId,
    resultSummaryRevision: row.resultSummaryRevision,
    safeFailureCode: row.safeFailureCode,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    updatedAt: row.updatedAt,
  };
}

function linkFromRow(row: AIMemoryExecutionMemoryLinkRow): AIMemoryExtractionResultLink {
  return { executionId: row.executionId, ordinal: row.ordinal, memoryId: row.memoryId };
}
