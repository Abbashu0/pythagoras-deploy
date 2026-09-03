import { and, asc, count, desc, eq, inArray, or } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import type { ContentDatabase } from "../../content/database";
import {
  aiConversations,
  aiEvalCaseExecutions,
  aiEvalTargetCleanups,
  aiJobs,
  type AIEvalTargetCleanupRow,
} from "../../content/schema";
import { AIConversationService, type AIStudentPrincipal } from "../conversations";
import type {
  AIEvalCaseExecutionRepository,
  AIEvalTargetCleanup,
  AIEvalTargetCleanupRepository,
} from "./contracts";
import { AIEvalError } from "./errors";

const MAX_TIMESTAMP = 8_640_000_000_000_000;
const MAX_RECOVERY_BATCH = 500;
const CLEANUP_PENDING_CODE = "EVAL_C4_CLEANUP_PENDING";

/** Safe, metadata-only repository for synthetic Conversation ownership. */
export class SQLiteAIEvalTargetCleanupRepository implements AIEvalTargetCleanupRepository {
  constructor(private readonly database: ContentDatabase) {}

  getByCaseExecutionId(caseExecutionId: string): AIEvalTargetCleanup | null {
    const row = this.database.db.select().from(aiEvalTargetCleanups)
      .where(eq(aiEvalTargetCleanups.caseExecutionId, caseExecutionId))
      .orderBy(desc(aiEvalTargetCleanups.createdAt), desc(aiEvalTargetCleanups.id)).get();
    return row ? fromRow(row) : null;
  }

  listByCaseExecutionId(caseExecutionId: string): AIEvalTargetCleanup[] {
    return this.database.db.select().from(aiEvalTargetCleanups)
      .where(eq(aiEvalTargetCleanups.caseExecutionId, caseExecutionId))
      .orderBy(asc(aiEvalTargetCleanups.createdAt), asc(aiEvalTargetCleanups.id))
      .all().map(fromRow);
  }

  listPending(input: { runId?: string; limit: number }): AIEvalTargetCleanup[] {
    assertLimit(input.limit);
    const rows = this.database.db.select({ cleanup: aiEvalTargetCleanups })
      .from(aiEvalTargetCleanups)
      .innerJoin(aiEvalCaseExecutions, eq(aiEvalCaseExecutions.id, aiEvalTargetCleanups.caseExecutionId))
      .leftJoin(aiJobs, eq(aiJobs.id, aiEvalCaseExecutions.jobId))
      .where(and(
        eq(aiEvalTargetCleanups.status, "PENDING"),
        or(
          inArray(aiEvalCaseExecutions.status, ["COMPLETED", "BLOCKED", "FAILED", "CANCELLED", "AMBIGUOUS"]),
          inArray(aiJobs.status, ["DEAD_LETTER", "CANCELLED"]),
        ),
        input.runId === undefined ? undefined : eq(aiEvalCaseExecutions.runId, input.runId),
      ))
      .orderBy(asc(aiEvalTargetCleanups.createdAt), asc(aiEvalTargetCleanups.id))
      .limit(input.limit)
      .all();
    return rows.map((row) => fromRow(row.cleanup));
  }

  countPending(runId: string): number {
    const row = this.database.db.select({ value: count() }).from(aiEvalTargetCleanups)
      .innerJoin(aiEvalCaseExecutions, eq(aiEvalCaseExecutions.id, aiEvalTargetCleanups.caseExecutionId))
      .where(and(eq(aiEvalTargetCleanups.status, "PENDING"), eq(aiEvalCaseExecutions.runId, runId))).get();
    return Number(row?.value ?? 0);
  }

  createInTransaction(input: { id: string; caseExecutionId: string; syntheticConversationId: string; createdAt: number }): AIEvalTargetCleanup {
    assertTimestamp(input.createdAt, "createdAt");
    try {
      const row = this.database.db.insert(aiEvalTargetCleanups).values({
        id: input.id,
        caseExecutionId: input.caseExecutionId,
        syntheticConversationId: input.syntheticConversationId,
        status: "PENDING",
        safeFailureCode: null,
        createdAt: input.createdAt,
        cleanedAt: null,
        updatedAt: input.createdAt,
      }).returning().get();
      return fromRow(row);
    } catch (error) {
      throw new AIEvalError("AI_EVAL_TARGET_INVALID", "The Eval target cleanup binding could not be created.", {}, error);
    }
  }

  markPendingFailure(id: string, safeFailureCode: string, updatedAt: number): AIEvalTargetCleanup {
    assertTimestamp(updatedAt, "updatedAt");
    if (!/^[A-Z0-9_.-]{1,120}$/u.test(safeFailureCode)) throw new AIEvalError("AI_EVAL_TARGET_INVALID", "The Eval target cleanup error code is invalid.");
    const row = this.database.db.update(aiEvalTargetCleanups).set({
      status: "PENDING",
      safeFailureCode,
      updatedAt,
    }).where(and(eq(aiEvalTargetCleanups.id, id), eq(aiEvalTargetCleanups.status, "PENDING"))).returning().get();
    if (!row) {
      const existing = this.database.db.select().from(aiEvalTargetCleanups).where(eq(aiEvalTargetCleanups.id, id)).get();
      if (existing) return fromRow(existing);
      throw new AIEvalError("AI_EVAL_TARGET_INVALID", "The Eval target cleanup binding was not found.");
    }
    return fromRow(row);
  }

  markCleaned(id: string, cleanedAt: number): AIEvalTargetCleanup {
    assertTimestamp(cleanedAt, "cleanedAt");
    const existing = this.database.db.select().from(aiEvalTargetCleanups).where(eq(aiEvalTargetCleanups.id, id)).get();
    if (!existing) throw new AIEvalError("AI_EVAL_TARGET_INVALID", "The Eval target cleanup binding was not found.");
    if (existing.status === "CLEANED") return fromRow(existing);
    const row = this.database.db.update(aiEvalTargetCleanups).set({
      status: "CLEANED",
      safeFailureCode: null,
      cleanedAt,
      updatedAt: cleanedAt,
    }).where(and(eq(aiEvalTargetCleanups.id, id), eq(aiEvalTargetCleanups.status, "PENDING"))).returning().get();
    if (!row) throw new AIEvalError("AI_EVAL_TARGET_INVALID", "The Eval target cleanup binding changed before it was marked cleaned.");
    return fromRow(row);
  }
}

/**
 * Owns only the synthetic C4 cleanup lifecycle. It never executes a Provider
 * and never reads or stores Eval input/output content.
 */
export class AIEvalTargetCleanupService {
  private readonly repository: AIEvalTargetCleanupRepository;
  private readonly conversations: AIConversationService;
  private readonly executions: AIEvalCaseExecutionRepository;
  private readonly clock: () => number;

  constructor(private readonly dependencies: {
    database: ContentDatabase;
    executions: AIEvalCaseExecutionRepository;
    conversations?: AIConversationService;
    repository?: AIEvalTargetCleanupRepository;
    clock?: () => number;
  }) {
    this.executions = dependencies.executions;
    this.clock = dependencies.clock ?? Date.now;
    this.conversations = dependencies.conversations ?? new AIConversationService(dependencies.database, { clock: this.clock });
    this.repository = dependencies.repository ?? new SQLiteAIEvalTargetCleanupRepository(dependencies.database);
  }

  getByCaseExecutionId(caseExecutionId: string): AIEvalTargetCleanup | null {
    return this.repository.getByCaseExecutionId(caseExecutionId);
  }

  pendingCountForRun(runId: string): number {
    return this.repository.countPending(runId);
  }

  /** Must be called inside the caller's existing IMMEDIATE transaction. */
  bindInTransaction(input: { caseExecutionId: string; syntheticConversationId: string; createdAt: number }): AIEvalTargetCleanup {
    return this.repository.createInTransaction({ id: uuidv7(), ...input });
  }

  cleanupForExecution(caseExecutionId: string, now = this.clock()): boolean {
    assertTimestamp(now, "cleanup");
    const bindings = this.repository.listByCaseExecutionId(caseExecutionId).filter((binding) => binding.status === "PENDING");
    if (bindings.length === 0) return true;
    const principal = syntheticPrincipal(caseExecutionId);
    let complete = true;
    for (const binding of bindings) {
      try {
        this.conversations.deleteConversation(principal, binding.syntheticConversationId);
        this.repository.markCleaned(binding.id, now);
      } catch {
        complete = false;
        try { this.repository.markPendingFailure(binding.id, CLEANUP_PENDING_CODE, Math.max(now, binding.updatedAt)); } catch { /* preserve pending ownership for the next bounded scan */ }
      }
    }
    return complete;
  }

  reconcilePending(input: { limit: number; now: number }): { scanned: number; reconciled: number; skipped: number } {
    assertLimit(input.limit);
    assertTimestamp(input.now, "recovery");
    const pending = this.repository.listPending({ limit: input.limit });
    let reconciled = 0;
    let skipped = 0;
    for (const binding of pending) {
      const execution = this.executions.getById(binding.caseExecutionId);
      if (!execution) { skipped += 1; continue; }
      if (this.cleanupForExecution(execution.id, input.now)) reconciled += 1;
      else skipped += 1;
    }
    return { scanned: pending.length, reconciled, skipped };
  }
}

export function syntheticPrincipal(caseExecutionId: string): AIStudentPrincipal {
  return { principalRef: `eval-target-${caseExecutionId.replace(/-/gu, "")}`, status: "ACTIVE" };
}

function fromRow(row: AIEvalTargetCleanupRow): AIEvalTargetCleanup {
  return {
    id: row.id,
    caseExecutionId: row.caseExecutionId,
    syntheticConversationId: row.syntheticConversationId,
    status: row.status,
    safeFailureCode: row.safeFailureCode,
    createdAt: row.createdAt,
    cleanedAt: row.cleanedAt,
    updatedAt: row.updatedAt,
  };
}

function assertLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_RECOVERY_BATCH) throw new AIEvalError("AI_EVAL_TARGET_INVALID", "The Eval target cleanup recovery limit is invalid.");
}

function assertTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMESTAMP) throw new AIEvalError("AI_EVAL_TARGET_INVALID", `The Eval target ${field} timestamp is invalid.`);
}
