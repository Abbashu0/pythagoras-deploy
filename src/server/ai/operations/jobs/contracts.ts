import type { AICostCenter } from "../../economics";

export const AI_JOB_STATUSES = [
  "PENDING",
  "RUNNING",
  "RETRY_WAIT",
  "SUCCEEDED",
  "DEAD_LETTER",
  "CANCELLED",
] as const;
export type AIJobStatus = (typeof AI_JOB_STATUSES)[number];

export const AI_JOB_PRIORITIES = ["LOW", "NORMAL", "HIGH", "CRITICAL"] as const;
export type AIJobPriority = (typeof AI_JOB_PRIORITIES)[number];

export const AI_JOB_ATTEMPT_OUTCOMES = [
  "RUNNING",
  "SUCCEEDED",
  "RETRYABLE_FAILURE",
  "NON_RETRYABLE_FAILURE",
  "TIMED_OUT",
  "LEASE_EXPIRED",
  "CANCELLED",
] as const;
export type AIJobAttemptOutcome = (typeof AI_JOB_ATTEMPT_OUTCOMES)[number];

export interface AIJob {
  id: string;
  kind: string;
  payloadVersion: number;
  payloadJson: string;
  payloadHash: string;
  dedupeKey: string;
  costCenter: AICostCenter;
  costOperationId: string | null;
  priority: AIJobPriority;
  status: AIJobStatus;
  attemptCount: number;
  maxAttempts: number;
  timeoutMs: number;
  leaseDurationMs: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  scheduledAt: number;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseGeneration: number;
  leaseExpiresAt: number | null;
  lastHeartbeatAt: number | null;
  lastErrorCode: string | null;
  cancellationRequestedAt: number | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface AIJobOperationalView {
  id: string;
  kind: string;
  payloadVersion: number;
  payloadHash: string;
  dedupeKey: string;
  costCenter: AICostCenter;
  costOperationId: string | null;
  priority: AIJobPriority;
  status: AIJobStatus;
  attemptCount: number;
  maxAttempts: number;
  timeoutMs: number;
  leaseDurationMs: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  scheduledAt: number;
  leaseOwner: string | null;
  leaseGeneration: number;
  leaseExpiresAt: number | null;
  lastHeartbeatAt: number | null;
  lastErrorCode: string | null;
  cancellationRequestedAt: number | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface AIJobAttempt {
  id: string;
  jobId: string;
  attemptNumber: number;
  workerId: string;
  leaseGeneration: number;
  startedAt: number;
  lastHeartbeatAt: number | null;
  completedAt: number | null;
  outcome: AIJobAttemptOutcome;
  safeErrorCode: string | null;
  retryScheduledAt: number | null;
}

export interface AIJobSpec {
  id?: string;
  kind: string;
  payloadVersion: number;
  payload: Record<string, unknown>;
  dedupeKey: string;
  costCenter: AICostCenter;
  costOperationId?: string | null;
  priority?: AIJobPriority;
  maxAttempts?: number;
  timeoutMs?: number;
  leaseDurationMs?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  scheduledAt?: number;
}

export interface AIJobLease {
  jobId: string;
  leaseOwner: string;
  leaseToken: string;
  leaseGeneration: number;
}

export interface AIJobExecutionContext {
  job: AIJob;
  attempt: AIJobAttempt;
  lease: AIJobLease;
  workerId: string;
  signal: AbortSignal;
  heartbeat(): void;
  checkLease(): void;
}

export interface AIClaimedJob {
  job: AIJob;
  attempt: AIJobAttempt;
  lease: AIJobLease;
}

export interface AIJobFailureResult {
  job: AIJob;
  attempt: AIJobAttempt;
  retryScheduledAt: number | null;
}

export interface AIJobHandlerDefinition {
  kind: string;
  payloadVersion: number;
  validatePayload(value: unknown): Record<string, unknown>;
  execute(payload: Record<string, unknown>, context: AIJobExecutionContext): void | Promise<void>;
}

export interface AIJobOperationalSummary {
  status: AIJobStatus;
  count: number;
}

export type AIJobLeaseIdentity = AIJobLease;
