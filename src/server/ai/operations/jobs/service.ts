import { randomUUID } from "node:crypto";

import { v7 as uuidv7 } from "uuid";

import type { ContentDatabase } from "../../../content/database";
import { SQLiteAIAccountingRepository } from "../../economics";
import type {
  AIClaimedJob,
  AIJob,
  AIJobAttempt,
  AIJobAttemptOutcome,
  AIJobFailureResult,
  AIJobHandlerDefinition,
  AIJobLease,
  AIJobOperationalSummary,
  AIJobOperationalView,
  AIJobSpec,
} from "./contracts";
import { AIJobError, AIJobExecutionError } from "./errors";
import { AIJobHandlerRegistry } from "./handler-registry";
import { SQLiteAIJobRepository } from "./sqlite-repository";
import { normalizeAIJobSpec, type NormalizedAIJobSpec } from "./validation";

const MAX_TIMESTAMP = 8_640_000_000_000_000;

export interface AIJobServiceDependencies {
  repository?: SQLiteAIJobRepository;
  accounting?: SQLiteAIAccountingRepository;
  clock?: () => number;
  idFactory?: () => string;
  workerIdFactory?: () => string;
}

export class AIJobQueueService {
  private readonly repository: SQLiteAIJobRepository;
  private readonly accounting: SQLiteAIAccountingRepository;
  private readonly clock: () => number;
  private readonly idFactory: () => string;
  private readonly workerIdFactory: () => string;

  constructor(
    private readonly database: ContentDatabase,
    private readonly handlers: AIJobHandlerRegistry,
    dependencies: AIJobServiceDependencies = {},
  ) {
    this.repository = dependencies.repository ?? new SQLiteAIJobRepository(database);
    this.accounting = dependencies.accounting ?? new SQLiteAIAccountingRepository(database);
    this.clock = dependencies.clock ?? Date.now;
    this.idFactory = dependencies.idFactory ?? uuidv7;
    this.workerIdFactory = dependencies.workerIdFactory ?? randomUUID;
  }

  enqueue(spec: AIJobSpec): AIJob {
    const now = this.safeNow();
    const prepared = this.prepare(spec, now);
    return this.database.client.transaction(() => this.enqueuePreparedInTransaction(prepared, now)).immediate();
  }

  /** Enqueue inside an already-open SQLite transaction; this method never starts a nested transaction. */
  enqueueInTransaction(spec: AIJobSpec, now = this.safeNow()): AIJob {
    this.assertTimestamp(now);
    return this.enqueuePreparedInTransaction(this.prepare(spec, now), now);
  }

  getJob(id: string): AIJob | null {
    return this.repository.getById(id);
  }

  listAttempts(jobId: string): AIJobAttempt[] {
    return this.repository.listAttempts(jobId);
  }

  listOperationalSummaries(): AIJobOperationalSummary[] {
    return this.repository.listOperationalSummaries();
  }

  listRecent(limit = 50): AIJobOperationalView[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new AIJobError("AI_JOB_INVALID", "Job query limit is invalid.");
    return this.repository.listRecent(limit);
  }

  oldestEligible(input: { supportedKinds: readonly string[]; now?: number }): AIJobOperationalView | null {
    const now = input.now ?? this.safeNow();
    this.assertTimestamp(now);
    return this.database.client.transaction(() => this.repository.oldestEligibleInTransaction({
      now,
      supportedJobs: this.supportedJobsForKinds(input.supportedKinds),
    }))();
  }

  listActiveLeases(limit = 50): AIJobOperationalView[] {
    return this.repository.listActiveLeases(this.queryLimit(limit));
  }

  listDeadLetters(limit = 50): AIJobOperationalView[] {
    return this.repository.listDeadLetters(this.queryLimit(limit));
  }

  listRecentAttempts(limit = 50): AIJobAttempt[] {
    return this.repository.listRecentAttempts(this.queryLimit(limit));
  }

  claimNext(input: { workerId?: string; supportedKinds: readonly string[]; now?: number }): AIClaimedJob | null {
    const now = input.now ?? this.safeNow();
    this.assertTimestamp(now);
    const workerId = input.workerId ?? this.workerIdFactory();
    if (typeof workerId !== "string" || !workerId.trim() || workerId.length > 200) throw new AIJobError("AI_JOB_INVALID", "Worker identity is invalid.");
    return this.database.client.transaction(() => this.repository.claimNextInTransaction({
      now,
      workerId,
      supportedJobs: this.supportedJobsForKinds(input.supportedKinds),
    })).immediate();
  }

  heartbeat(lease: AIJobLease, now = this.safeNow()): AIJob {
    this.assertTimestamp(now);
    return this.database.client.transaction(() => this.repository.heartbeatInTransaction(lease, now)).immediate();
  }

  assertLease(lease: AIJobLease): void {
    this.database.client.transaction(() => this.repository.assertLeaseInTransaction(lease)).immediate();
  }

  assertLeaseInTransaction(lease: AIJobLease): void {
    this.repository.assertLeaseInTransaction(lease);
  }

  complete(lease: AIJobLease, now = this.safeNow()): { job: AIJob; attempt: AIJobAttempt } {
    this.assertTimestamp(now);
    return this.database.client.transaction(() => this.repository.completeInTransaction(lease, now)).immediate();
  }

  fail(input: {
    lease: AIJobLease;
    now?: number;
    safeErrorCode: string;
    retryable: boolean;
    attemptOutcome: AIJobAttemptOutcome;
  }): AIJobFailureResult {
    const now = input.now ?? this.safeNow();
    this.assertTimestamp(now);
    const safeErrorCode = normalizeErrorCode(input.safeErrorCode);
    return this.database.client.transaction(() => this.repository.failInTransaction({
      lease: input.lease,
      now,
      safeErrorCode,
      retryable: input.retryable,
      attemptOutcome: input.attemptOutcome,
    })).immediate();
  }

  recoverExpiredLeases(now = this.safeNow(), limit = 100): AIJob[] {
    this.assertTimestamp(now);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new AIJobError("AI_JOB_INVALID", "Lease recovery limit is invalid.");
    return this.database.client.transaction(() => this.repository.recoverExpiredLeasesInTransaction({ now, limit })).immediate();
  }

  cancelPending(jobId: string, now = this.safeNow()): AIJob {
    this.assertTimestamp(now);
    return this.database.client.transaction(() => this.repository.cancelPendingInTransaction(jobId, now)).immediate();
  }

  createWorkerId(): string {
    return this.workerIdFactory();
  }

  private prepare(spec: AIJobSpec, now: number): NormalizedAIJobSpec {
    const definition: AIJobHandlerDefinition | null = this.handlers.get(spec.kind, spec.payloadVersion);
    if (!definition) throw new AIJobError("AI_JOB_HANDLER_NOT_FOUND", "No registered handler supports this Job kind/version.");
    let payload: Record<string, unknown>;
    try {
      payload = definition.validatePayload(spec.payload);
    } catch (error) {
      if (error instanceof AIJobError && error.code === "AI_JOB_PAYLOAD_INVALID") throw error;
      throw new AIJobError("AI_JOB_PAYLOAD_INVALID", "The Job payload failed its registered validator.", error);
    }
    try {
      return normalizeAIJobSpec({ ...spec, payload, scheduledAt: spec.scheduledAt ?? now });
    } catch (error) {
      if (error instanceof AIJobError) throw error;
      throw new AIJobError("AI_JOB_INVALID", "The Job specification is invalid.", error);
    }
  }

  private enqueuePreparedInTransaction(spec: NormalizedAIJobSpec, now: number): AIJob {
    const id = spec.id ?? this.idFactory();
    const existing = this.repository.findByDedupe(spec.kind, spec.dedupeKey);
    if (existing) {
      if (!sameExecutionMeaning(existing, spec)) {
        throw new AIJobError("AI_JOB_DEDUPE_CONFLICT", "The Job dedupe identity is bound to different execution meaning.");
      }
      return existing;
    }
    if (spec.costOperationId) {
      const operation = this.accounting.getOperation(spec.costOperationId);
      if (!operation) throw new AIJobError("AI_JOB_INVALID", "The Job Cost Operation was not found.");
      if (operation.costCenter !== spec.costCenter) throw new AIJobError("AI_JOB_INVALID", "The Job cost center does not match its Cost Operation.");
      if (operation.jobId !== null && operation.jobId !== id) throw new AIJobError("AI_JOB_INVALID", "The Cost Operation is bound to a different Job identity.");
    }
    return this.repository.insertInTransaction({ id, spec, now });
  }

  private safeNow(): number {
    const now = this.clock();
    this.assertTimestamp(now);
    return now;
  }

  private assertTimestamp(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMESTAMP) throw new AIJobError("AI_JOB_INVALID", "Job timestamp is invalid.");
  }

  private queryLimit(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1 || value > 500) throw new AIJobError("AI_JOB_INVALID", "Job query limit is invalid.");
    return value;
  }

  private supportedJobsForKinds(supportedKinds: readonly string[]): Array<{ kind: string; payloadVersion: number }> {
    if (!supportedKinds.length) return [];
    const requestedKinds = new Set(supportedKinds);
    return this.handlers.supportedJobs().filter((supported) => requestedKinds.has(supported.kind));
  }
}

function sameExecutionMeaning(existing: AIJob, spec: NormalizedAIJobSpec): boolean {
  return existing.kind === spec.kind &&
    existing.payloadVersion === spec.payloadVersion &&
    existing.payloadHash === spec.payloadHash &&
    existing.dedupeKey === spec.dedupeKey &&
    existing.costCenter === spec.costCenter &&
    existing.costOperationId === spec.costOperationId &&
    existing.priority === spec.priority &&
    existing.maxAttempts === spec.maxAttempts &&
    existing.timeoutMs === spec.timeoutMs &&
    existing.leaseDurationMs === spec.leaseDurationMs &&
    existing.backoffBaseMs === spec.backoffBaseMs &&
    existing.backoffMaxMs === spec.backoffMaxMs &&
    existing.scheduledAt === spec.scheduledAt;
}

function normalizeErrorCode(value: string): string {
  const normalized = value.normalize("NFKC").trim().toUpperCase();
  if (!normalized || normalized.length > 120 || !/^[A-Z0-9_.-]+$/u.test(normalized)) throw new AIJobError("AI_JOB_INVALID", "Job error code is invalid.");
  return normalized;
}

export function classifyAIJobFailure(error: unknown): { safeErrorCode: string; retryable: boolean; attemptOutcome: AIJobAttemptOutcome } {
  if (error instanceof AIJobError && error.code === "AI_JOB_LEASE_LOST") throw error;
  if (error instanceof AIJobExecutionError) {
    const safeErrorCode = normalizeErrorCode(error.safeErrorCode);
    return {
      safeErrorCode,
      retryable: error.retryable,
      attemptOutcome: safeErrorCode === "AI_JOB_TIMEOUT" ? "TIMED_OUT" : error.retryable ? "RETRYABLE_FAILURE" : "NON_RETRYABLE_FAILURE",
    };
  }
  return {
    safeErrorCode: "AI_JOB_HANDLER_FAILED",
    retryable: false,
    attemptOutcome: "NON_RETRYABLE_FAILURE",
  };
}
