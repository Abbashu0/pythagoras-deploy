import { and, asc, eq, inArray } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import type { ContentDatabase } from "../../content/database";
import { aiEvalCaseExecutions, aiJobs, type AIEvalCaseExecutionRow } from "../../content/schema";
import type {
  AIEvalCaseExecution,
  AIEvalCaseExecutionRepository,
  AIEvalCaseExecutionStatus,
  AIEvalProviderInvocationState,
} from "./contracts";
import { AIEvalError } from "./errors";

const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_TIMESTAMP = 8_640_000_000_000_000;

export class SQLiteAIEvalCaseExecutionRepository implements AIEvalCaseExecutionRepository {
  constructor(private readonly database: ContentDatabase) {}

  getById(id: string): AIEvalCaseExecution | null {
    const row = this.database.db.select().from(aiEvalCaseExecutions).where(eq(aiEvalCaseExecutions.id, id)).get();
    return row ? fromRow(row) : null;
  }

  getForTarget(input: { runId: string; caseId: string; caseRevision: number }): AIEvalCaseExecution | null {
    const row = this.database.db.select().from(aiEvalCaseExecutions).where(and(eq(aiEvalCaseExecutions.runId, input.runId), eq(aiEvalCaseExecutions.caseId, input.caseId), eq(aiEvalCaseExecutions.caseRevision, input.caseRevision))).get();
    return row ? fromRow(row) : null;
  }

  getByJob(jobId: string): AIEvalCaseExecution | null {
    const row = this.database.db.select().from(aiEvalCaseExecutions).where(eq(aiEvalCaseExecutions.jobId, jobId)).get();
    return row ? fromRow(row) : null;
  }

  listForRun(runId: string): AIEvalCaseExecution[] {
    return this.database.db.select().from(aiEvalCaseExecutions).where(eq(aiEvalCaseExecutions.runId, runId)).orderBy(asc(aiEvalCaseExecutions.ordinal), asc(aiEvalCaseExecutions.id)).all().map(fromRow);
  }

  create(input: Omit<AIEvalCaseExecution, "id" | "idempotencyKey"> & { id?: string }): AIEvalCaseExecution {
    assertTimestamp(input.createdAt, "createdAt");
    const id = input.id ?? uuidv7();
    if (input.status !== "PENDING" || input.providerInvocationState !== "NOT_INVOKED" || input.providerInvoked || input.targetCostOperationId !== null || input.budgetReservationId !== null || input.jobId !== null) throw new AIEvalError("AI_EVAL_TARGET_INVALID", "An Eval Case Execution must begin pending and uninvoked.");
    try {
      this.database.db.insert(aiEvalCaseExecutions).values({ ...input, id, providerInvoked: false }).run();
    } catch (error) { throw new AIEvalError("AI_EVAL_TARGET_INVALID", "The Eval Case Execution could not be created.", {}, error); }
    const result = this.getById(id);
    if (!result) throw new AIEvalError("AI_EVAL_TARGET_INVALID", "The Eval Case Execution could not be read after creation.");
    return result;
  }

  bindJob(id: string, jobId: string, now: number): AIEvalCaseExecution { return this.update(id, { jobId, updatedAt: now }); }

  bindOperation(id: string, targetCostOperationId: string, now: number): AIEvalCaseExecution { return this.update(id, { targetCostOperationId, updatedAt: now }); }

  bindAdmission(id: string, input: { targetCostOperationId: string; budgetReservationId: string }, now: number): AIEvalCaseExecution { return this.update(id, { ...input, updatedAt: now }); }

  markRunning(id: string, now: number, maxConcurrency?: number): AIEvalCaseExecution {
    if (maxConcurrency !== undefined && (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 100)) throw new AIEvalError("AI_EVAL_TARGET_INVALID", "The Eval target concurrency limit is invalid.");
    const run = () => {
      if (maxConcurrency !== undefined) {
        const row = this.database.client.prepare("select count(*) as count from ai_eval_case_executions where run_id=(select run_id from ai_eval_case_executions where id=?) and status='RUNNING'").get(id) as { count: number };
        if (row.count >= maxConcurrency) throw new AIEvalError("AI_EVAL_TARGET_CONCURRENCY_LIMITED", "The Eval target concurrency limit is currently reached.");
      }
      return this.update(id, { status: "RUNNING", startedAt: now, updatedAt: now });
    };
    return (this.database.client.inTransaction ? run() : this.database.client.transaction(run).immediate());
  }

  markInvoking(id: string, now: number): AIEvalCaseExecution { return this.update(id, { status: "RUNNING", providerInvocationState: "INVOKING", updatedAt: now }); }

  markNotInvoked(id: string, now: number): AIEvalCaseExecution { return this.update(id, { status: "RUNNING", providerInvocationState: "NOT_INVOKED", providerInvoked: false, updatedAt: now }); }

  markInvokedWithAccounting(id: string, now: number): AIEvalCaseExecution { return this.update(id, { status: "RUNNING", providerInvocationState: "INVOKED_WITH_ACCOUNTING", providerInvoked: true, updatedAt: now }); }

  complete(input: { id: string; providerInvoked: boolean; outputSha256: string; outputByteSize: number; finishReason: AIEvalCaseExecution["finishReason"] & string; retrievalStatus: "SUFFICIENT" | "NOT_APPLICABLE"; planFingerprint: string; now: number }): AIEvalCaseExecution {
    if (!SHA256.test(input.outputSha256) || !SHA256.test(input.planFingerprint) || !Number.isSafeInteger(input.outputByteSize) || input.outputByteSize < 0 || input.outputByteSize > 524_288) throw new AIEvalError("AI_EVAL_TARGET_INVALID", "Eval target output metadata is invalid.");
    return this.update(input.id, { status: "COMPLETED", providerInvoked: input.providerInvoked, providerInvocationState: input.providerInvoked ? "INVOKED_WITH_ACCOUNTING" : "NOT_INVOKED", outputSha256: input.outputSha256, outputByteSize: input.outputByteSize, finishReason: input.finishReason, retrievalStatus: input.retrievalStatus, planFingerprint: input.planFingerprint, completedAt: input.now, updatedAt: input.now });
  }

  block(input: { id: string; retrievalStatus: "INSUFFICIENT"; safeFailureCode: string; now: number }): AIEvalCaseExecution { return this.update(input.id, { status: "BLOCKED", retrievalStatus: input.retrievalStatus, safeFailureCode: input.safeFailureCode, completedAt: input.now, updatedAt: input.now }); }

  fail(input: { id: string; providerInvoked: boolean; outputSha256?: string | null; outputByteSize?: number | null; finishReason?: AIEvalCaseExecution["finishReason"]; retrievalStatus?: AIEvalCaseExecution["retrievalStatus"]; safeFailureCode: string; now: number }): AIEvalCaseExecution {
    const current = this.getById(input.id);
    if (!current) throw new AIEvalError("AI_EVAL_TARGET_INVALID", "The Eval Case Execution was not found.");
    const invocationState = current.providerInvocationState === "INVOKED_WITH_ACCOUNTING" ? current.providerInvocationState : input.providerInvoked ? "INVOKED_WITH_ACCOUNTING" : "NOT_INVOKED";
    return this.update(input.id, { status: "FAILED", providerInvoked: input.providerInvoked || current.providerInvoked, providerInvocationState: invocationState, outputSha256: input.outputSha256 ?? null, outputByteSize: input.outputByteSize ?? null, finishReason: input.finishReason ?? "FAILED", retrievalStatus: input.retrievalStatus ?? null, safeFailureCode: input.safeFailureCode, completedAt: input.now, updatedAt: input.now });
  }

  cancel(input: { id: string; providerInvoked: boolean; safeFailureCode: string; now: number }): AIEvalCaseExecution { const current = this.getById(input.id); if (!current) throw new AIEvalError("AI_EVAL_TARGET_INVALID", "The Eval Case Execution was not found."); const invocationState = current.providerInvocationState === "INVOKED_WITH_ACCOUNTING" ? current.providerInvocationState : input.providerInvoked ? "INVOKED_WITH_ACCOUNTING" : "NOT_INVOKED"; return this.update(input.id, { status: "CANCELLED", providerInvoked: input.providerInvoked || current.providerInvoked, providerInvocationState: invocationState, finishReason: "CANCELLED", safeFailureCode: input.safeFailureCode, completedAt: input.now, updatedAt: input.now }); }

  ambiguous(input: { id: string; safeFailureCode: string; now: number }): AIEvalCaseExecution { return this.update(input.id, { status: "AMBIGUOUS", providerInvocationState: "AMBIGUOUS", safeFailureCode: input.safeFailureCode, completedAt: input.now, updatedAt: input.now }); }

  listPendingTerminalReconciliation(limit: number): AIEvalCaseExecution[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new AIEvalError("AI_EVAL_TARGET_INVALID", "The Eval target recovery limit is invalid.");
    const rows = this.database.db.select({ execution: aiEvalCaseExecutions })
      .from(aiEvalCaseExecutions)
      .innerJoin(aiJobs, eq(aiJobs.id, aiEvalCaseExecutions.jobId))
      .where(and(inArray(aiEvalCaseExecutions.status, ["PENDING", "RUNNING"]), inArray(aiJobs.status, ["DEAD_LETTER", "CANCELLED"])))
      .orderBy(asc(aiEvalCaseExecutions.createdAt), asc(aiEvalCaseExecutions.id))
      .limit(limit)
      .all();
    return rows.map((row) => fromRow(row.execution));
  }

  private update(id: string, values: Partial<Record<string, unknown>>): AIEvalCaseExecution {
    const current = this.getById(id);
    if (!current) throw new AIEvalError("AI_EVAL_TARGET_INVALID", "The Eval Case Execution was not found.");
    const row = this.database.db.update(aiEvalCaseExecutions).set(values as never).where(eq(aiEvalCaseExecutions.id, id)).returning().get();
    if (!row) throw new AIEvalError("AI_EVAL_TARGET_INVALID", "The Eval Case Execution changed before its transition.");
    return fromRow(row);
  }
}

function fromRow(row: AIEvalCaseExecutionRow): AIEvalCaseExecution {
  return { id: row.id, idempotencyKey: `eval-target-${row.id}`, runId: row.runId, caseId: row.caseId, caseRevision: row.caseRevision, ordinal: row.ordinal, subjectKey: row.subjectKey, executionConfigId: row.executionConfigId, executionConfigRevision: row.executionConfigRevision, executionConfigFingerprint: row.executionConfigFingerprint, executionProtocolKey: row.executionProtocolKey, executionProtocolRevision: row.executionProtocolRevision, cleanupProtocolKey: row.cleanupProtocolKey, cleanupProtocolRevision: row.cleanupProtocolRevision, targetCostOperationId: row.targetCostOperationId, budgetReservationId: row.budgetReservationId, jobId: row.jobId, status: row.status as AIEvalCaseExecutionStatus, providerInvocationState: row.providerInvocationState as AIEvalProviderInvocationState, providerInvoked: row.providerInvoked, outputSha256: row.outputSha256, outputByteSize: row.outputByteSize, finishReason: row.finishReason, retrievalStatus: row.retrievalStatus as AIEvalCaseExecution["retrievalStatus"], candidateFingerprint: row.candidateFingerprint, planFingerprint: row.planFingerprint, safeFailureCode: row.safeFailureCode, createdAt: row.createdAt, startedAt: row.startedAt, completedAt: row.completedAt, updatedAt: row.updatedAt };
}

function assertTimestamp(value: number, field: string): void { if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMESTAMP) throw new AIEvalError("AI_EVAL_TARGET_INVALID", `Eval target ${field} timestamp is invalid.`); }
