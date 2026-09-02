import { createHash } from "node:crypto";

import type { AIJob, AIJobExecutionContext, AIClaimedJob, AIJobTerminalReconciler } from "../jobs";
import {
  AIJobError,
  AIJobExecutionError,
  AIJobHandlerRegistry,
  AIJobQueueService,
  classifyAIJobFailure,
} from "../jobs";
import type { AIOutboxEvent } from "../outbox";
import { AIOutboxService } from "../outbox";
import type { AIOperationalRecoveryPolicy, AIRecoveryRunResult } from "../recovery";
import { AIOperationalRecoveryService } from "../recovery";

export interface AIWorkerRunResult {
  recoveredJobs: number;
  recovery?: AIRecoveryRunResult;
  dispatchedOutbox: AIOutboxEvent | null;
  claimedJobId: string | null;
  completedJobId: string | null;
}

export interface AIWorkerDependencies {
  jobs: AIJobQueueService;
  handlers: AIJobHandlerRegistry;
  outbox?: AIOutboxService;
  recovery?: AIOperationalRecoveryService;
  terminalReconciler?: AIJobTerminalReconciler;
  recoveryPolicy?: AIOperationalRecoveryPolicy;
  pollIntervalMs?: number;
  workerId?: string;
  clock?: () => number;
}

export class AIWorker {
  private readonly workerId: string;
  private readonly clock: () => number;
  private readonly pollIntervalMs: number;
  private stopping = false;
  private currentAbortController: AbortController | null = null;

  constructor(private readonly dependencies: AIWorkerDependencies) {
    this.workerId = dependencies.workerId ?? dependencies.jobs.createWorkerId();
    this.clock = dependencies.clock ?? Date.now;
    this.pollIntervalMs = dependencies.pollIntervalMs ?? 1_000;
    if (!Number.isSafeInteger(this.pollIntervalMs) || this.pollIntervalMs < 50 || this.pollIntervalMs > 60_000) {
      throw new AIJobError("AI_JOB_INVALID", "Worker poll interval is invalid.");
    }
  }

  get id(): string {
    return this.workerId;
  }

  requestShutdown(): void {
    this.stopping = true;
  }

  async runOnce(now = this.clock()): Promise<AIWorkerRunResult> {
    if (!Number.isSafeInteger(now) || now < 0) throw new AIJobError("AI_JOB_INVALID", "Worker timestamp is invalid.");
    const recoveredJobs = this.dependencies.jobs.recoverExpiredLeases(now);
    const recovery = this.dependencies.recovery?.runOnce(now);
    this.reconcileTerminalJobs(recoveredJobs, now);
    const dispatchedOutbox = !this.stopping && this.dependencies.outbox
      ? this.dependencies.outbox.dispatchOne({ now })
      : null;
    if (this.stopping) {
      return { recoveredJobs: recoveredJobs.length, recovery, dispatchedOutbox, claimedJobId: null, completedJobId: null };
    }
    const claimed = this.dependencies.jobs.claimNext({
      workerId: this.workerId,
      supportedKinds: this.dependencies.handlers.supportedKinds(),
      now,
    });
    if (!claimed) return { recoveredJobs: recoveredJobs.length, recovery, dispatchedOutbox, claimedJobId: null, completedJobId: null };
    const completed = await this.executeClaimed(claimed);
    const terminalJob = this.dependencies.jobs.getJob(claimed.job.id);
    if (terminalJob) this.reconcileTerminalJobs([terminalJob], now);
    return {
      recoveredJobs: recoveredJobs.length,
      recovery,
      dispatchedOutbox,
      claimedJobId: claimed.job.id,
      completedJobId: completed ? claimed.job.id : null,
    };
  }

  private reconcileTerminalJobs(jobs: readonly AIJob[], now: number): void {
    const reconciler = this.dependencies.terminalReconciler;
    if (!reconciler) return;
    const seen = new Set<string>();
    const candidates = [...jobs];
    for (const view of this.dependencies.jobs.listTerminal(100)) {
      if (seen.has(view.id)) continue;
      const job = this.dependencies.jobs.getJob(view.id);
      if (job) candidates.push(job);
    }
    for (const job of candidates) {
      if (seen.has(job.id)) continue;
      seen.add(job.id);
      if (job.status === "DEAD_LETTER" || job.status === "CANCELLED") reconciler.reconcile(job, now);
    }
  }

  async runContinuous(): Promise<void> {
    while (!this.stopping) {
      await this.runOnce();
      if (!this.stopping) await delay(this.pollIntervalMs);
    }
  }

  private async executeClaimed(claimed: AIClaimedJob): Promise<boolean> {
    const definition = this.dependencies.handlers.get(claimed.job.kind, claimed.job.payloadVersion);
    if (!definition) {
      this.dependencies.jobs.fail({
        lease: claimed.lease,
        safeErrorCode: "AI_JOB_HANDLER_NOT_FOUND",
        retryable: false,
        attemptOutcome: "NON_RETRYABLE_FAILURE",
      });
      return false;
    }
    const controller = new AbortController();
    this.currentAbortController = controller;
    let timedOut = false;
    let leaseLost = false;
    const heartbeatInterval = Math.max(25, Math.floor(claimed.job.leaseDurationMs / 3));
    const heartbeatTimer = setInterval(() => {
      if (controller.signal.aborted) return;
      try {
        this.dependencies.jobs.heartbeat(claimed.lease, this.clock());
      } catch (error) {
        if (error instanceof AIJobError && error.code === "AI_JOB_LEASE_LOST") {
          leaseLost = true;
          controller.abort();
        } else {
          leaseLost = true;
          controller.abort();
        }
      }
    }, heartbeatInterval);
    let rejectTimeout: ((reason?: unknown) => void) | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      rejectTimeout = reject;
    });
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      rejectTimeout?.(new AIJobExecutionError("AI_JOB_TIMEOUT", true));
    }, claimed.job.timeoutMs);
    const context: AIJobExecutionContext = {
      job: claimed.job,
      attempt: claimed.attempt,
      lease: claimed.lease,
      workerId: this.workerId,
      signal: controller.signal,
      heartbeat: () => {
        if (controller.signal.aborted) throw new AIJobExecutionError(timedOut ? "AI_JOB_TIMEOUT" : "AI_JOB_CANCELLED", false);
        this.dependencies.jobs.heartbeat(claimed.lease, this.clock());
      },
      checkLease: () => {
        if (controller.signal.aborted) throw new AIJobExecutionError(timedOut ? "AI_JOB_TIMEOUT" : "AI_JOB_CANCELLED", false);
        const current = this.dependencies.jobs.getJob(claimed.job.id);
        if (!current || current.status !== "RUNNING" || current.leaseOwner !== claimed.lease.leaseOwner || current.leaseToken !== claimed.lease.leaseToken || current.leaseGeneration !== claimed.lease.leaseGeneration) {
          throw new AIJobError("AI_JOB_LEASE_LOST", "The Job lease is no longer current.");
        }
      },
    };
    try {
      const payloadHash = createHash("sha256").update(claimed.job.payloadJson).digest("hex");
      if (payloadHash !== claimed.job.payloadHash) {
        throw new AIJobExecutionError("AI_JOB_PAYLOAD_INVALID", false);
      }
      let payload: Record<string, unknown>;
      try {
        payload = definition.validatePayload(JSON.parse(claimed.job.payloadJson) as unknown);
      } catch (error) {
        if (error instanceof AIJobExecutionError) throw error;
        throw new AIJobExecutionError("AI_JOB_PAYLOAD_INVALID", false, "The Job payload failed validation.", error);
      }
      await Promise.race([
        Promise.resolve(definition.execute(payload, context)),
        timeoutPromise,
      ]);
      if (timedOut || leaseLost || controller.signal.aborted) return false;
      this.dependencies.jobs.complete(claimed.lease, this.clock());
      return true;
    } catch (error) {
      if (error instanceof AIJobError && error.code === "AI_JOB_LEASE_LOST") {
        leaseLost = true;
        return false;
      }
      if (leaseLost) return false;
      const failure = timedOut
        ? { safeErrorCode: "AI_JOB_TIMEOUT", retryable: true, attemptOutcome: "TIMED_OUT" as const }
        : classifyAIJobFailure(error);
      try {
        this.dependencies.jobs.fail({
          lease: claimed.lease,
          safeErrorCode: failure.safeErrorCode,
          retryable: failure.retryable,
          attemptOutcome: failure.attemptOutcome,
          now: this.clock(),
        });
      } catch (failureError) {
        if (!(failureError instanceof AIJobError && failureError.code === "AI_JOB_LEASE_LOST")) throw failureError;
      }
      return false;
    } finally {
      clearInterval(heartbeatTimer);
      clearTimeout(timeoutTimer);
      this.currentAbortController = null;
    }
  }
}

export function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
