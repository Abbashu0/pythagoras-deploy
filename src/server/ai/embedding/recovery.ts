import type { AIBudgetAdmissionService } from "../admission";
import type { AICostAccountingService } from "../economics";
import type { AIJob, AIJobTerminalReconciler } from "../operations/jobs";
import {
  AI_EMBEDDING_JOB_KIND,
  AI_EMBEDDING_JOB_PAYLOAD_VERSION,
  type AIEmbeddingProjectionRepository,
} from "./contracts";
import { validateAIEmbeddingJobPayload } from "./job";

const MAX_TIMESTAMP = 8_640_000_000_000_000;

export interface AIEmbeddingProjectionRecoveryDependencies {
  projections: Pick<AIEmbeddingProjectionRepository, "getRevision" | "markFailed">;
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
    if (job.kind !== AI_EMBEDDING_JOB_KIND || job.payloadVersion !== AI_EMBEDDING_JOB_PAYLOAD_VERSION) return;
    if (job.status !== "DEAD_LETTER" && job.status !== "CANCELLED") return;
    if (job.costOperationId === null) return;

    let payload: ReturnType<typeof validateAIEmbeddingJobPayload>;
    try {
      payload = validateAIEmbeddingJobPayload(JSON.parse(job.payloadJson) as unknown);
    } catch {
      // A malformed/future payload cannot prove ownership of a projection.
      // Leave it untouched for the normal operational failure path.
      return;
    }
    if (payload.costOperationId !== job.costOperationId) return;

    const revision = this.dependencies.projections.getRevision(payload.embeddingProjectionRevisionId);
    if (!revision || revision.jobId !== job.id || revision.costOperationId !== payload.costOperationId) return;

    const at = terminalTimestamp(now, revision.updatedAt);
    const safeErrorCode = job.status === "CANCELLED"
      ? "AI_EMBEDDING_JOB_CANCELLED"
      : "AI_EMBEDDING_JOB_DEAD_LETTER";
    if (revision.status === "BUILDING") {
      this.dependencies.projections.markFailed(revision.id, safeErrorCode, at);
    }

    const operation = this.dependencies.accounting.getOperation(revision.costOperationId);
    if (operation && operation.jobId !== null && operation.jobId !== job.id) return;
    if (operation?.status === "OPEN") {
      this.dependencies.accounting.completeOperation(revision.costOperationId, "OPEN", "FAILED", at);
    }

    const reservation = this.dependencies.admission.getReservationByOperationId(revision.costOperationId);
    if (!reservation) return;
    if (reservation.status === "RESERVED") {
      this.dependencies.admission.releaseBeforeExecution(reservation.id, at, "PRE_EXECUTION_RELEASE");
    } else if (reservation.status === "EXECUTING" || reservation.status === "RECONCILIATION_REQUIRED") {
      this.dependencies.admission.settle(reservation.id, at);
    }
  }
}

function terminalTimestamp(value: number, floor: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMESTAMP) return floor;
  return Math.max(value, floor);
}
