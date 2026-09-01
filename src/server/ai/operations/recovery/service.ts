import type {
  AIBudgetAdmissionService,
  SQLiteAIBudgetAccountingReader,
} from "../../admission";
import type { AIJobExecutionContext } from "../jobs";
import { AIJobExecutionError, AIJobQueueService } from "../jobs";
import type { SQLiteAIBudgetRuntimeRepository } from "../../budget";
import {
  AI_RECONCILIATION_JOB_KIND,
  type AIRecoveryRunResult,
  type AIOperationalRecoveryPolicy,
} from "./contracts";
import { AIRecoveryError } from "./errors";

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_SCAN_BATCH = 500;

export class AIOperationalRecoveryService {
  constructor(
    private readonly admission: AIBudgetAdmissionService,
    private readonly budgetRuntime: SQLiteAIBudgetRuntimeRepository,
    private readonly accounting: SQLiteAIBudgetAccountingReader,
    private readonly jobs: AIJobQueueService,
    private readonly policy: AIOperationalRecoveryPolicy,
    private readonly clock: () => number = Date.now,
  ) {
    validatePolicy(policy);
  }

  runOnce(now = this.clock()): AIRecoveryRunResult {
    validateTimestamp(now);
    const reservations = this.budgetRuntime.listReservationsForRecovery({
      now,
      reservedStaleAfterMs: this.policy.reservedStaleAfterMs,
      executingStaleAfterMs: this.policy.executingStaleAfterMs,
      limit: this.policy.scanBatchSize,
    });
    let staleReservedReleased = 0;
    let staleExecutingSettled = 0;
    let reconciliationJobsEnsured = 0;
    let stillReconciling = 0;
    for (const reservation of reservations) {
      if (reservation.status === "RESERVED" && reservation.createdAt <= now - this.policy.reservedStaleAfterMs) {
        this.admission.releaseBeforeExecution(reservation.id, now, "STALE_PRE_EXECUTION_RECOVERY");
        staleReservedReleased += 1;
        continue;
      }
      if (reservation.status === "EXECUTING" && reservation.executionStartedAt !== null && reservation.executionStartedAt <= now - this.policy.executingStaleAfterMs) {
        const result = this.admission.settle(reservation.id, now);
        staleExecutingSettled += 1;
        if (result.status === "RECONCILIATION_REQUIRED") {
          this.ensureReconciliationJob(reservation.id, now);
          reconciliationJobsEnsured += 1;
          stillReconciling += 1;
        }
        continue;
      }
      if (reservation.status === "RECONCILIATION_REQUIRED") {
        this.ensureReconciliationJob(reservation.id, now);
        reconciliationJobsEnsured += 1;
        stillReconciling += 1;
      }
    }
    return {
      scanned: reservations.length,
      staleReservedReleased,
      staleExecutingSettled,
      reconciliationJobsEnsured,
      stillReconciling,
    };
  }

  ensureReconciliationJob(reservationId: string, now = this.clock()) {
    validateTimestamp(now);
    const reservation = this.budgetRuntime.getReservation(reservationId);
    if (!reservation) throw new AIRecoveryError("AI_RECOVERY_INVALID", "The reservation for recovery was not found.");
    if (reservation.status !== "RECONCILIATION_REQUIRED") {
      throw new AIRecoveryError("AI_RECOVERY_INVALID", "Only reconciliation-required reservations need a reconciliation Job.");
    }
    const account = this.budgetRuntime.getAccount(reservation.budgetAccountId);
    if (!account) throw new AIRecoveryError("AI_RECOVERY_INVALID", "The reservation Budget Account was not found.");
    const observation = this.accounting.getOperationCost(reservation.operationId);
    const dedupeKey = `admission-reconcile:${reservation.id}:${observation.accountingFingerprint}`;
    return this.jobs.enqueue({
      kind: AI_RECONCILIATION_JOB_KIND,
      payloadVersion: 1,
      payload: {
        reservationId: reservation.id,
        accountingFingerprint: observation.accountingFingerprint,
      },
      dedupeKey,
      costCenter: account.costCenter,
      costOperationId: reservation.operationId,
      priority: "HIGH",
      maxAttempts: this.policy.reconciliationJob.maxAttempts,
      timeoutMs: this.policy.reconciliationJob.timeoutMs,
      leaseDurationMs: this.policy.reconciliationJob.leaseDurationMs,
      backoffBaseMs: this.policy.reconciliationJob.backoffBaseMs,
      backoffMaxMs: this.policy.reconciliationJob.backoffMaxMs,
      scheduledAt: reservation.createdAt,
    });
  }
}

export function createReconciliationJobHandler(admission: AIBudgetAdmissionService) {
  return {
    kind: AI_RECONCILIATION_JOB_KIND,
    payloadVersion: 1,
    validatePayload(value: unknown): Record<string, unknown> {
      if (typeof value !== "object" || value === null || Array.isArray(value)) throw new AIJobExecutionError("AI_JOB_PAYLOAD_INVALID", false);
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      if (keys.length !== 2 || keys[0] !== "accountingFingerprint" || keys[1] !== "reservationId") {
        throw new AIJobExecutionError("AI_JOB_PAYLOAD_INVALID", false);
      }
      if (typeof record.reservationId !== "string" || !record.reservationId.trim() || record.reservationId.length > 120) {
        throw new AIJobExecutionError("AI_JOB_PAYLOAD_INVALID", false);
      }
      if (typeof record.accountingFingerprint !== "string" || !FINGERPRINT_PATTERN.test(record.accountingFingerprint)) {
        throw new AIJobExecutionError("AI_JOB_PAYLOAD_INVALID", false);
      }
      return { reservationId: record.reservationId, accountingFingerprint: record.accountingFingerprint };
    },
    async execute(payload: Record<string, unknown>, context: AIJobExecutionContext): Promise<void> {
      context.checkLease();
      if (context.signal.aborted) throw new AIJobExecutionError("AI_JOB_CANCELLED", false);
      const result = admission.settle(payload.reservationId as string);
      if (result.status === "RECONCILIATION_REQUIRED") {
        throw new AIJobExecutionError("AI_RECONCILIATION_INCOMPLETE", true);
      }
    },
  };
}

export function defaultAIOperationalRecoveryPolicy(): AIOperationalRecoveryPolicy {
  return {
    reservedStaleAfterMs: 15 * 60_000,
    executingStaleAfterMs: 5 * 60_000,
    scanBatchSize: 100,
    reconciliationJob: {
      maxAttempts: 8,
      timeoutMs: 30_000,
      leaseDurationMs: 120_000,
      backoffBaseMs: 5_000,
      backoffMaxMs: 15 * 60_000,
    },
  };
}

function validatePolicy(policy: AIOperationalRecoveryPolicy): void {
  for (const value of [policy.reservedStaleAfterMs, policy.executingStaleAfterMs]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 31_536_000_000) throw new AIRecoveryError("AI_RECOVERY_INVALID", "Recovery stale thresholds are invalid.");
  }
  if (!Number.isSafeInteger(policy.scanBatchSize) || policy.scanBatchSize < 1 || policy.scanBatchSize > MAX_SCAN_BATCH) throw new AIRecoveryError("AI_RECOVERY_INVALID", "Recovery scan batch size is invalid.");
  const job = policy.reconciliationJob;
  for (const value of [job.maxAttempts, job.timeoutMs, job.leaseDurationMs, job.backoffBaseMs, job.backoffMaxMs]) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 86_400_000) throw new AIRecoveryError("AI_RECOVERY_INVALID", "Reconciliation Job parameters are invalid.");
  }
  if (job.maxAttempts < 1 || job.timeoutMs < 1 || job.leaseDurationMs < 100 || job.backoffMaxMs < job.backoffBaseMs) throw new AIRecoveryError("AI_RECOVERY_INVALID", "Reconciliation Job parameters are inconsistent.");
}

function validateTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000) throw new AIRecoveryError("AI_RECOVERY_INVALID", "Recovery timestamp is invalid.");
}
