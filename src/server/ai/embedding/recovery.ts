import type { AIBudgetAdmissionService } from "../admission";
import type { AICostAccountingService } from "../economics";
import type {
  AIJob,
  AIJobTerminalReconciliationResult,
  AIJobTerminalReconciler,
} from "../operations/jobs";
import {
  AI_EMBEDDING_JOB_KIND,
  AI_EMBEDDING_JOB_PAYLOAD_VERSION,
  type AIEmbeddingPendingTerminalProjection,
  type AIEmbeddingProjectionRepository,
} from "./contracts";
import { AIEmbeddingError } from "./errors";

const MAX_TIMESTAMP = 8_640_000_000_000_000;
const DEFAULT_TERMINAL_RECONCILIATION_BATCH_SIZE = 50;
const MAX_TERMINAL_RECONCILIATION_BATCH_SIZE = 500;

export interface AIEmbeddingProjectionRecoveryDependencies {
  projections: Pick<AIEmbeddingProjectionRepository, "listRevisionsByJobId" | "listPendingTerminalReconciliations" | "markFailed">;
  admission: Pick<AIBudgetAdmissionService, "getReservationByOperationId" | "releaseBeforeExecution" | "settle">;
  accounting: Pick<AICostAccountingService, "getOperation" | "completeOperation">;
  clock?: () => number;
}

/**
 * Reconciles embedding-domain state after a generic Job reaches a terminal
 * state outside the embedding handler. It is intentionally idempotent and
 * never executes a Provider.
 */
export class AIEmbeddingProjectionRecoveryService implements AIJobTerminalReconciler {
  private readonly clock: () => number;

  constructor(private readonly dependencies: AIEmbeddingProjectionRecoveryDependencies) {
    this.clock = dependencies.clock ?? Date.now;
  }

  reconcile(job: AIJob, now = this.clock()): void {
    if (!isSupportedTerminalJob(job)) return;
    const revisions = this.dependencies.projections.listRevisionsByJobId(job.id);
    if (revisions.length !== 1) return;
    this.reconcileOwned({
      revision: revisions[0],
      job: terminalJobIdentity(job),
    }, now);
  }

  reconcilePending(input: { limit?: number; now?: number } = {}): AIJobTerminalReconciliationResult {
    const limit = normalizeLimit(input.limit ?? DEFAULT_TERMINAL_RECONCILIATION_BATCH_SIZE);
    const now = normalizeTimestamp(input.now ?? this.clock());
    const work = this.dependencies.projections.listPendingTerminalReconciliations(limit);
    const byJob = new Map<string, AIEmbeddingPendingTerminalProjection[]>();
    for (const item of work) {
      const existing = byJob.get(item.job.id) ?? [];
      existing.push(item);
      byJob.set(item.job.id, existing);
    }
    let reconciled = 0;
    let skipped = 0;
    for (const items of byJob.values()) {
      if (items.length !== 1) {
        skipped += items.length;
        continue;
      }
      try {
        if (this.reconcileOwned(items[0], now)) reconciled += 1;
        else skipped += 1;
      } catch {
        // One corrupt/incomplete domain item must not poison the rest of the
        // bounded recovery batch. It remains BUILDING for a later retry.
        skipped += 1;
      }
    }
    return { scanned: work.length, reconciled, skipped };
  }

  private reconcileOwned(item: AIEmbeddingPendingTerminalProjection, now: number): boolean {
    const { revision, job } = item;
    if (!isSupportedTerminalJobIdentity(job) || revision.status !== "BUILDING" || revision.jobId !== job.id || job.costOperationId === null || revision.costOperationId !== job.costOperationId) return false;
    const operation = this.dependencies.accounting.getOperation(revision.costOperationId);
    if (!operation || (operation.jobId !== null && operation.jobId !== job.id)) return false;
    const at = terminalTimestamp(now, revision.updatedAt);
    if (operation.status === "OPEN") {
      this.dependencies.accounting.completeOperation(revision.costOperationId, "OPEN", "FAILED", at);
    }
    const reservation = this.dependencies.admission.getReservationByOperationId(revision.costOperationId);
    if (reservation?.status === "RESERVED") {
      this.dependencies.admission.releaseBeforeExecution(reservation.id, at, "PRE_EXECUTION_RELEASE");
    } else if (reservation && (reservation.status === "EXECUTING" || reservation.status === "RECONCILIATION_REQUIRED")) {
      this.dependencies.admission.settle(reservation.id, at);
    }
    this.dependencies.projections.markFailed(revision.id, job.status === "CANCELLED" ? "AI_EMBEDDING_JOB_CANCELLED" : "AI_EMBEDDING_JOB_DEAD_LETTER", at);
    return true;
  }
}

function terminalJobIdentity(job: AIJob & { status: "DEAD_LETTER" | "CANCELLED"; costOperationId: string }): AIEmbeddingPendingTerminalProjection["job"] {
  return {
    id: job.id,
    kind: job.kind,
    payloadVersion: job.payloadVersion,
    status: job.status,
    costOperationId: job.costOperationId,
  };
}

function isSupportedTerminalJob(job: AIJob): job is AIJob & { status: "DEAD_LETTER" | "CANCELLED"; costOperationId: string } {
  return job.kind === AI_EMBEDDING_JOB_KIND && job.payloadVersion === AI_EMBEDDING_JOB_PAYLOAD_VERSION && (job.status === "DEAD_LETTER" || job.status === "CANCELLED") && job.costOperationId !== null;
}

function isSupportedTerminalJobIdentity(job: AIEmbeddingPendingTerminalProjection["job"]): boolean {
  return job.kind === AI_EMBEDDING_JOB_KIND && job.payloadVersion === AI_EMBEDDING_JOB_PAYLOAD_VERSION && (job.status === "DEAD_LETTER" || job.status === "CANCELLED") && job.costOperationId !== null;
}

function normalizeLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TERMINAL_RECONCILIATION_BATCH_SIZE) throw new AIEmbeddingError("AI_EMBEDDING_INVALID", "The terminal reconciliation batch size is invalid.");
  return value;
}

function normalizeTimestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMESTAMP) throw new AIEmbeddingError("AI_EMBEDDING_INVALID", "The terminal reconciliation timestamp is invalid.");
  return value;
}

function terminalTimestamp(value: number, floor: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMESTAMP) return floor;
  return Math.max(value, floor);
}
