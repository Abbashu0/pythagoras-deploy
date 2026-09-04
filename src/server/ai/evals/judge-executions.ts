import { and, asc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import type { ContentDatabase } from "../../content/database";
import { aiEvalJudgeExecutions, type AIEvalJudgeExecutionRow } from "../../content/schema";
import type {
  AIEvalJudgeExecution,
  AIEvalJudgeExecutionRepository,
  AIEvalJudgeExecutionStatus,
  AIEvalProviderInvocationState,
} from "./contracts";
import { AIEvalError } from "./errors";

const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_TIMESTAMP = 8_640_000_000_000_000;

export class SQLiteAIEvalJudgeExecutionRepository implements AIEvalJudgeExecutionRepository {
  constructor(private readonly database: ContentDatabase) {}

  getById(id: string): AIEvalJudgeExecution | null {
    const row = this.database.db.select().from(aiEvalJudgeExecutions).where(eq(aiEvalJudgeExecutions.id, id)).get();
    return row ? fromRow(row) : null;
  }

  getForCase(input: { runId: string; caseId: string; caseRevision: number }): AIEvalJudgeExecution | null {
    const row = this.database.db
      .select()
      .from(aiEvalJudgeExecutions)
      .where(
        and(
          eq(aiEvalJudgeExecutions.runId, input.runId),
          eq(aiEvalJudgeExecutions.caseId, input.caseId),
          eq(aiEvalJudgeExecutions.caseRevision, input.caseRevision),
        ),
      )
      .get();
    return row ? fromRow(row) : null;
  }

  getByTarget(input: { runId: string; caseId: string; caseRevision: number }): AIEvalJudgeExecution | null {
    return this.getForCase(input);
  }

  listForRun(runId: string): AIEvalJudgeExecution[] {
    return this.database.db
      .select()
      .from(aiEvalJudgeExecutions)
      .where(eq(aiEvalJudgeExecutions.runId, runId))
      .orderBy(asc(aiEvalJudgeExecutions.ordinal), asc(aiEvalJudgeExecutions.id))
      .all()
      .map(fromRow);
  }

  create(input: Omit<AIEvalJudgeExecution, "id" | "idempotencyKey"> & { id?: string }): AIEvalJudgeExecution {
    assertTimestamp(input.createdAt, "createdAt");
    const id = input.id ?? uuidv7();
    if (
      input.status !== "PENDING" ||
      input.providerInvocationState !== "NOT_INVOKED" ||
      input.providerInvoked ||
      input.judgeCostOperationId !== null ||
      input.budgetReservationId !== null
    ) {
      throw new AIEvalError("AI_EVAL_JUDGE_INVALID", "An Eval Judge Execution must begin pending and uninvoked.");
    }
    try {
      this.database.db.insert(aiEvalJudgeExecutions).values({
        ...input,
        id,
        providerInvoked: false,
      }).run();
    } catch (error) {
      throw new AIEvalError("AI_EVAL_JUDGE_INVALID", "The Eval Judge Execution could not be created.", {}, error);
    }
    const result = this.getById(id);
    if (!result) throw new AIEvalError("AI_EVAL_JUDGE_INVALID", "The Eval Judge Execution could not be read after creation.");
    return result;
  }

  bindOperation(id: string, judgeCostOperationId: string, now: number): AIEvalJudgeExecution {
    return this.update(id, { judgeCostOperationId, updatedAt: now });
  }

  bindAdmission(id: string, input: { judgeCostOperationId: string; budgetReservationId: string }, now: number): AIEvalJudgeExecution {
    return this.update(id, { ...input, updatedAt: now });
  }

  markRunning(id: string, now: number): AIEvalJudgeExecution {
    assertTimestamp(now, "startedAt");
    const current = this.getById(id);
    if (!current) throw new AIEvalError("AI_EVAL_JUDGE_INVALID", "The Eval Judge Execution was not found.");
    return this.update(id, {
      status: "RUNNING",
      startedAt: current.startedAt ?? now,
      updatedAt: now,
    });
  }

  markInvoking(id: string, now: number): AIEvalJudgeExecution {
    return this.update(id, { status: "RUNNING", providerInvocationState: "INVOKING", updatedAt: now });
  }

  markNotInvoked(id: string, now: number): AIEvalJudgeExecution {
    return this.update(id, { status: "RUNNING", providerInvocationState: "NOT_INVOKED", providerInvoked: false, updatedAt: now });
  }

  markInvokedWithAccounting(id: string, now: number): AIEvalJudgeExecution {
    return this.update(id, { status: "RUNNING", providerInvocationState: "INVOKED_WITH_ACCOUNTING", providerInvoked: true, updatedAt: now });
  }

  complete(input: {
    id: string;
    providerInvoked: boolean;
    judgeOutputSha256: string;
    judgeOutputByteSize: number;
    latencyMs: number;
    now: number;
  }): AIEvalJudgeExecution {
    if (!SHA256.test(input.judgeOutputSha256) || !Number.isSafeInteger(input.judgeOutputByteSize) || input.judgeOutputByteSize < 0) {
      throw new AIEvalError("AI_EVAL_JUDGE_INVALID", "Eval Judge output metadata is invalid.");
    }
    return this.update(input.id, {
      status: "COMPLETED",
      providerInvoked: input.providerInvoked,
      providerInvocationState: input.providerInvoked ? "INVOKED_WITH_ACCOUNTING" : "NOT_INVOKED",
      judgeOutputSha256: input.judgeOutputSha256,
      judgeOutputByteSize: input.judgeOutputByteSize,
      latencyMs: input.latencyMs,
      completedAt: input.now,
      updatedAt: input.now,
    });
  }

  fail(input: {
    id: string;
    providerInvoked: boolean;
    judgeOutputSha256?: string | null;
    judgeOutputByteSize?: number | null;
    latencyMs?: number | null;
    safeFailureCode: string;
    now: number;
  }): AIEvalJudgeExecution {
    const current = this.getById(input.id);
    if (!current) throw new AIEvalError("AI_EVAL_JUDGE_INVALID", "The Eval Judge Execution was not found.");
    const invocationState = current.providerInvocationState === "INVOKED_WITH_ACCOUNTING"
      ? current.providerInvocationState
      : input.providerInvoked
      ? "INVOKED_WITH_ACCOUNTING"
      : "NOT_INVOKED";
    return this.update(input.id, {
      status: "FAILED",
      providerInvoked: input.providerInvoked || current.providerInvoked,
      providerInvocationState: invocationState,
      judgeOutputSha256: input.judgeOutputSha256 ?? null,
      judgeOutputByteSize: input.judgeOutputByteSize ?? null,
      latencyMs: input.latencyMs ?? null,
      safeFailureCode: input.safeFailureCode,
      completedAt: input.now,
      updatedAt: input.now,
    });
  }

  cancel(input: { id: string; providerInvoked: boolean; safeFailureCode: string; now: number }): AIEvalJudgeExecution {
    const current = this.getById(input.id);
    if (!current) throw new AIEvalError("AI_EVAL_JUDGE_INVALID", "The Eval Judge Execution was not found.");
    const invocationState = current.providerInvocationState === "INVOKED_WITH_ACCOUNTING"
      ? current.providerInvocationState
      : input.providerInvoked
      ? "INVOKED_WITH_ACCOUNTING"
      : "NOT_INVOKED";
    return this.update(input.id, {
      status: "CANCELLED",
      providerInvoked: input.providerInvoked || current.providerInvoked,
      providerInvocationState: invocationState,
      safeFailureCode: input.safeFailureCode,
      completedAt: input.now,
      updatedAt: input.now,
    });
  }

  ambiguous(input: { id: string; safeFailureCode: string; now: number }): AIEvalJudgeExecution {
    return this.update(input.id, {
      status: "AMBIGUOUS",
      providerInvocationState: "AMBIGUOUS",
      safeFailureCode: input.safeFailureCode,
      completedAt: input.now,
      updatedAt: input.now,
    });
  }

  inputLost(input: { id: string; safeFailureCode: string; now: number }): AIEvalJudgeExecution {
    return this.update(input.id, {
      status: "INPUT_LOST",
      safeFailureCode: input.safeFailureCode,
      completedAt: input.now,
      updatedAt: input.now,
    });
  }

  private update(id: string, values: Partial<AIEvalJudgeExecutionRow>): AIEvalJudgeExecution {
    if (values.updatedAt !== undefined) assertTimestamp(values.updatedAt, "updatedAt");
    try {
      const row = this.database.db.update(aiEvalJudgeExecutions).set(values).where(eq(aiEvalJudgeExecutions.id, id)).returning().get();
      if (!row) throw new AIEvalError("AI_EVAL_JUDGE_INVALID", "The Eval Judge Execution was not found for update.");
      return fromRow(row);
    } catch (error) {
      if (error instanceof AIEvalError) throw error;
      throw new AIEvalError("AI_EVAL_JUDGE_INVALID", "The Eval Judge Execution could not be updated.", {}, error);
    }
  }
}

function fromRow(row: AIEvalJudgeExecutionRow): AIEvalJudgeExecution {
  return {
    id: row.id,
    idempotencyKey: `eval-judge-execution:${row.id}`,
    runId: row.runId,
    caseId: row.caseId,
    caseRevision: row.caseRevision,
    ordinal: row.ordinal,
    subjectKey: row.subjectKey,
    judgeConfigId: row.judgeConfigId,
    judgeConfigRevision: row.judgeConfigRevision,
    judgeConfigFingerprint: row.judgeConfigFingerprint,
    protocolKey: row.protocolKey,
    protocolRevision: row.protocolRevision,
    judgeModelConfigId: row.judgeModelConfigId,
    judgeModelConfigRevision: row.judgeModelConfigRevision,
    judgeProviderConfigId: row.judgeProviderConfigId,
    judgeProviderConfigRevision: row.judgeProviderConfigRevision,
    judgeCostOperationId: row.judgeCostOperationId,
    budgetReservationId: row.budgetReservationId,
    status: row.status as AIEvalJudgeExecutionStatus,
    providerInvocationState: row.providerInvocationState as AIEvalProviderInvocationState,
    providerInvoked: Boolean(row.providerInvoked),
    judgeOutputSha256: row.judgeOutputSha256,
    judgeOutputByteSize: row.judgeOutputByteSize,
    safeFailureCode: row.safeFailureCode,
    latencyMs: row.latencyMs,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    updatedAt: row.updatedAt,
  };
}

function assertTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMESTAMP) {
    throw new AIEvalError("AI_EVAL_JUDGE_INVALID", `The Eval Judge timestamp for ${field} is invalid.`);
  }
}
