import { randomBytes } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import type { ContentDatabase } from "../../../content/database";
import {
  aiJobAttempts,
  aiJobs,
  type AIJobAttemptRow,
  type AIJobRow,
} from "../../../content/schema";
import type {
  AIClaimedJob,
  AIJob,
  AIJobAttempt,
  AIJobAttemptOutcome,
  AIJobFailureResult,
  AIJobLease,
  AIJobOperationalSummary,
  AIJobOperationalView,
  AIJobStatus,
} from "./contracts";
import { AIJobError } from "./errors";
import { addAIJobDelay, calculateAIJobRetryDelay } from "./backoff";
import type { NormalizedAIJobSpec } from "./validation";

export class SQLiteAIJobRepository {
  constructor(private readonly database: ContentDatabase) {}

  getById(id: string): AIJob | null {
    const row = this.database.db.select().from(aiJobs).where(eq(aiJobs.id, id)).get();
    return row ? jobFromRow(row) : null;
  }

  findByDedupe(kind: string, dedupeKey: string): AIJob | null {
    const row = this.database.db.select().from(aiJobs).where(and(
      eq(aiJobs.kind, kind),
      eq(aiJobs.dedupeKey, dedupeKey),
    )).get();
    return row ? jobFromRow(row) : null;
  }

  insertInTransaction(input: {
    id: string;
    spec: NormalizedAIJobSpec;
    now: number;
  }): AIJob {
    try {
      const row = this.database.db.insert(aiJobs).values({
        id: input.id,
        kind: input.spec.kind,
        payloadVersion: input.spec.payloadVersion,
        payloadJson: input.spec.payloadJson,
        payloadHash: input.spec.payloadHash,
        dedupeKey: input.spec.dedupeKey,
        costCenter: input.spec.costCenter,
        costOperationId: input.spec.costOperationId,
        priority: input.spec.priority,
        status: "PENDING",
        attemptCount: 0,
        maxAttempts: input.spec.maxAttempts,
        timeoutMs: input.spec.timeoutMs,
        leaseDurationMs: input.spec.leaseDurationMs,
        backoffBaseMs: input.spec.backoffBaseMs,
        backoffMaxMs: input.spec.backoffMaxMs,
        scheduledAt: input.spec.scheduledAt,
        leaseOwner: null,
        leaseToken: null,
        leaseGeneration: 0,
        leaseExpiresAt: null,
        lastHeartbeatAt: null,
        lastErrorCode: null,
        cancellationRequestedAt: null,
        createdAt: input.now,
        updatedAt: input.now,
        completedAt: null,
      }).returning().get();
      return jobFromRow(row);
    } catch (error) {
      throw new AIJobError("AI_JOB_INVALID", "The AI Job could not be persisted.", error);
    }
  }

  claimNextInTransaction(input: {
    now: number;
    workerId: string;
    supportedJobs: ReadonlyArray<{ kind: string; payloadVersion: number }>;
  }): AIClaimedJob | null {
    if (!input.supportedJobs.length) return null;
    const supportedPairs = input.supportedJobs.map((supported) => and(
      eq(aiJobs.kind, supported.kind),
      eq(aiJobs.payloadVersion, supported.payloadVersion),
    ));
    const exactSupport = supportedPairs.length === 1 ? supportedPairs[0] : or(...supportedPairs);
    const candidate = this.database.db.select().from(aiJobs).where(and(
      exactSupport,
      or(eq(aiJobs.status, "PENDING"), eq(aiJobs.status, "RETRY_WAIT")),
      lte(aiJobs.scheduledAt, input.now),
      sql`${aiJobs.attemptCount} < ${aiJobs.maxAttempts}`,
      isNull(aiJobs.leaseOwner),
    )).orderBy(
      desc(sql<number>`case ${aiJobs.priority} when 'CRITICAL' then 4 when 'HIGH' then 3 when 'NORMAL' then 2 else 1 end`),
      asc(aiJobs.scheduledAt),
      asc(aiJobs.createdAt),
      asc(aiJobs.id),
    ).limit(1).get();
    if (!candidate) return null;
    const leaseGeneration = candidate.leaseGeneration + 1;
    const leaseToken = randomBytes(32).toString("base64url");
    const leaseExpiresAt = addAIJobDelay(input.now, candidate.leaseDurationMs);
    const updated = this.database.db.update(aiJobs).set({
      status: "RUNNING",
      attemptCount: candidate.attemptCount + 1,
      leaseOwner: input.workerId,
      leaseToken,
      leaseGeneration,
      leaseExpiresAt,
      lastHeartbeatAt: input.now,
      updatedAt: input.now,
    }).where(and(
      eq(aiJobs.id, candidate.id),
      eq(aiJobs.status, candidate.status),
      eq(aiJobs.attemptCount, candidate.attemptCount),
      eq(aiJobs.leaseGeneration, candidate.leaseGeneration),
      isNull(aiJobs.leaseOwner),
      lte(aiJobs.scheduledAt, input.now),
    )).returning().get();
    if (!updated) return null;
    try {
      const attempt = this.database.db.insert(aiJobAttempts).values({
        id: randomBytes(16).toString("hex"),
        jobId: updated.id,
        attemptNumber: updated.attemptCount,
        workerId: input.workerId,
        leaseGeneration,
        startedAt: input.now,
        lastHeartbeatAt: input.now,
        completedAt: null,
        outcome: "RUNNING",
        safeErrorCode: null,
        retryScheduledAt: null,
      }).returning().get();
      return {
        job: jobFromRow(updated),
        attempt: attemptFromRow(attempt),
        lease: { jobId: updated.id, leaseOwner: input.workerId, leaseToken, leaseGeneration },
      };
    } catch (error) {
      throw new AIJobError("AI_JOB_INVALID", "The Job attempt could not be created.", error);
    }
  }

  heartbeatInTransaction(lease: AIJobLease, now: number): AIJob {
    const current = this.getById(lease.jobId);
    if (!current || !matchesLease(current, lease)) throw new AIJobError("AI_JOB_LEASE_LOST", "The Job lease is no longer current.");
    const lifecycleNow = monotonicJobTime(current, now);
    const leaseExpiresAt = addAIJobDelay(lifecycleNow, current.leaseDurationMs);
    const row = this.database.db.update(aiJobs).set({
      leaseExpiresAt,
      lastHeartbeatAt: lifecycleNow,
      updatedAt: lifecycleNow,
    }).where(leaseWhere(lease)).returning().get();
    if (!row) throw new AIJobError("AI_JOB_LEASE_LOST", "The Job lease is no longer current.");
    const attempt = this.database.db.update(aiJobAttempts).set({
      lastHeartbeatAt: lifecycleNow,
    }).where(and(
      eq(aiJobAttempts.jobId, lease.jobId),
      eq(aiJobAttempts.leaseGeneration, lease.leaseGeneration),
      eq(aiJobAttempts.outcome, "RUNNING"),
      eq(aiJobAttempts.attemptNumber, row.attemptCount),
    )).returning().get();
    if (!attempt) throw new AIJobError("AI_JOB_LEASE_LOST", "The Job attempt lease is no longer current.");
    return jobFromRow(row);
  }

  assertLeaseInTransaction(lease: AIJobLease): void {
    const current = this.getById(lease.jobId);
    if (!current || !matchesLease(current, lease)) throw new AIJobError("AI_JOB_LEASE_LOST", "The Job lease is no longer current.");
  }

  completeInTransaction(lease: AIJobLease, now: number): { job: AIJob; attempt: AIJobAttempt } {
    const current = this.getById(lease.jobId);
    if (!current || !matchesLease(current, lease)) throw new AIJobError("AI_JOB_LEASE_LOST", "The Job lease is no longer current.");
    const lifecycleNow = monotonicJobTime(current, now);
    const row = this.database.db.update(aiJobs).set({
      status: "SUCCEEDED",
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
      lastErrorCode: null,
      updatedAt: lifecycleNow,
      completedAt: lifecycleNow,
    }).where(leaseWhere(lease)).returning().get();
    if (!row) throw new AIJobError("AI_JOB_LEASE_LOST", "The Job lease is no longer current.");
    const attempt = this.database.db.update(aiJobAttempts).set({
      completedAt: lifecycleNow,
      outcome: "SUCCEEDED",
      safeErrorCode: null,
      retryScheduledAt: null,
    }).where(and(
      eq(aiJobAttempts.jobId, lease.jobId),
      eq(aiJobAttempts.attemptNumber, row.attemptCount),
      eq(aiJobAttempts.leaseGeneration, lease.leaseGeneration),
      eq(aiJobAttempts.outcome, "RUNNING"),
    )).returning().get();
    if (!attempt) throw new AIJobError("AI_JOB_LEASE_LOST", "The Job attempt lease is no longer current.");
    return { job: jobFromRow(row), attempt: attemptFromRow(attempt) };
  }

  failInTransaction(input: {
    lease: AIJobLease;
    now: number;
    safeErrorCode: string;
    retryable: boolean;
    attemptOutcome: AIJobAttemptOutcome;
  }): AIJobFailureResult {
    const current = this.getById(input.lease.jobId);
    if (!current || !matchesLease(current, input.lease)) throw new AIJobError("AI_JOB_LEASE_LOST", "The Job lease is no longer current.");
    const lifecycleNow = monotonicJobTime(current, input.now);
    const canRetry = input.retryable && current.attemptCount < current.maxAttempts;
    const retryScheduledAt = canRetry
      ? addAIJobDelay(lifecycleNow, calculateAIJobRetryDelay({
          jobId: current.id,
          attemptNumber: current.attemptCount,
          backoffBaseMs: current.backoffBaseMs,
          backoffMaxMs: current.backoffMaxMs,
        }))
      : null;
    const status: AIJobStatus = canRetry ? "RETRY_WAIT" : "DEAD_LETTER";
    const row = this.database.db.update(aiJobs).set({
      status,
      scheduledAt: retryScheduledAt ?? current.scheduledAt,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
      lastErrorCode: input.safeErrorCode,
      updatedAt: lifecycleNow,
      completedAt: canRetry ? null : lifecycleNow,
    }).where(leaseWhere(input.lease)).returning().get();
    if (!row) throw new AIJobError("AI_JOB_LEASE_LOST", "The Job lease is no longer current.");
    const attempt = this.database.db.update(aiJobAttempts).set({
      completedAt: lifecycleNow,
      outcome: input.attemptOutcome,
      safeErrorCode: input.safeErrorCode,
      retryScheduledAt,
    }).where(and(
      eq(aiJobAttempts.jobId, input.lease.jobId),
      eq(aiJobAttempts.attemptNumber, row.attemptCount),
      eq(aiJobAttempts.leaseGeneration, input.lease.leaseGeneration),
      eq(aiJobAttempts.outcome, "RUNNING"),
    )).returning().get();
    if (!attempt) throw new AIJobError("AI_JOB_LEASE_LOST", "The Job attempt lease is no longer current.");
    return { job: jobFromRow(row), attempt: attemptFromRow(attempt), retryScheduledAt };
  }

  recoverExpiredLeasesInTransaction(input: { now: number; limit: number }): AIJob[] {
    const rows = this.database.db.select().from(aiJobs).where(and(
      eq(aiJobs.status, "RUNNING"),
      lte(aiJobs.leaseExpiresAt, input.now),
    )).orderBy(asc(aiJobs.leaseExpiresAt), asc(aiJobs.id)).limit(input.limit).all();
    const recovered: AIJob[] = [];
    for (const row of rows) {
      const canRetry = row.attemptCount < row.maxAttempts;
      const retryScheduledAt = canRetry
        ? addAIJobDelay(input.now, calculateAIJobRetryDelay({
            jobId: row.id,
            attemptNumber: row.attemptCount,
            backoffBaseMs: row.backoffBaseMs,
            backoffMaxMs: row.backoffMaxMs,
          }))
        : null;
      const updated = this.database.db.update(aiJobs).set({
        status: canRetry ? "RETRY_WAIT" : "DEAD_LETTER",
        scheduledAt: retryScheduledAt ?? row.scheduledAt,
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        lastHeartbeatAt: null,
        lastErrorCode: "AI_JOB_LEASE_EXPIRED",
        updatedAt: input.now,
        completedAt: canRetry ? null : input.now,
      }).where(and(
        eq(aiJobs.id, row.id),
        eq(aiJobs.status, "RUNNING"),
        eq(aiJobs.leaseGeneration, row.leaseGeneration),
        eq(aiJobs.leaseOwner, row.leaseOwner as string),
        eq(aiJobs.leaseToken, row.leaseToken as string),
        lte(aiJobs.leaseExpiresAt, input.now),
      )).returning().get();
      if (!updated) continue;
      const attempt = this.database.db.update(aiJobAttempts).set({
        completedAt: input.now,
        outcome: "LEASE_EXPIRED",
        safeErrorCode: "AI_JOB_LEASE_EXPIRED",
        retryScheduledAt,
      }).where(and(
        eq(aiJobAttempts.jobId, row.id),
        eq(aiJobAttempts.attemptNumber, row.attemptCount),
        eq(aiJobAttempts.leaseGeneration, row.leaseGeneration),
        eq(aiJobAttempts.outcome, "RUNNING"),
      )).returning().get();
      if (!attempt) throw new AIJobError("AI_JOB_INVALID", "The expired Job attempt history is missing.");
      recovered.push(jobFromRow(updated));
    }
    return recovered;
  }

  cancelPendingInTransaction(id: string, now: number): AIJob {
    const row = this.database.db.update(aiJobs).set({
      status: "CANCELLED",
      cancellationRequestedAt: now,
      updatedAt: now,
      completedAt: now,
    }).where(and(
      eq(aiJobs.id, id),
      or(eq(aiJobs.status, "PENDING"), eq(aiJobs.status, "RETRY_WAIT")),
    )).returning().get();
    if (!row) throw new AIJobError("AI_JOB_NOT_CANCELLABLE", "Only pending or retry-waiting Jobs can be cancelled.");
    return jobFromRow(row);
  }

  listAttempts(jobId: string): AIJobAttempt[] {
    return this.database.db.select().from(aiJobAttempts).where(eq(aiJobAttempts.jobId, jobId))
      .orderBy(asc(aiJobAttempts.attemptNumber)).all().map(attemptFromRow);
  }

  oldestEligibleInTransaction(input: {
    now: number;
    supportedJobs: ReadonlyArray<{ kind: string; payloadVersion: number }>;
  }): AIJobOperationalView | null {
    if (!input.supportedJobs.length) return null;
    const supportedPairs = input.supportedJobs.map((supported) => and(
      eq(aiJobs.kind, supported.kind),
      eq(aiJobs.payloadVersion, supported.payloadVersion),
    ));
    const exactSupport = supportedPairs.length === 1 ? supportedPairs[0] : or(...supportedPairs);
    const candidate = this.database.db.select().from(aiJobs).where(and(
      exactSupport,
      or(eq(aiJobs.status, "PENDING"), eq(aiJobs.status, "RETRY_WAIT")),
      lte(aiJobs.scheduledAt, input.now),
      sql`${aiJobs.attemptCount} < ${aiJobs.maxAttempts}`,
      isNull(aiJobs.leaseOwner),
    )).orderBy(
      desc(sql<number>`case ${aiJobs.priority} when 'CRITICAL' then 4 when 'HIGH' then 3 when 'NORMAL' then 2 else 1 end`),
      asc(aiJobs.scheduledAt),
      asc(aiJobs.createdAt),
      asc(aiJobs.id),
    ).limit(1).get();
    return candidate ? operationalViewFromJob(jobFromRow(candidate)) : null;
  }

  listActiveLeases(limit: number): AIJobOperationalView[] {
    return this.database.db.select().from(aiJobs).where(eq(aiJobs.status, "RUNNING"))
      .orderBy(asc(aiJobs.leaseExpiresAt), asc(aiJobs.id)).limit(limit).all().map((row) => operationalViewFromJob(jobFromRow(row)));
  }

  listDeadLetters(limit: number): AIJobOperationalView[] {
    return this.database.db.select().from(aiJobs).where(eq(aiJobs.status, "DEAD_LETTER"))
      .orderBy(desc(aiJobs.updatedAt), desc(aiJobs.id)).limit(limit).all().map((row) => operationalViewFromJob(jobFromRow(row)));
  }

  listRecentAttempts(limit: number): AIJobAttempt[] {
    return this.database.db.select().from(aiJobAttempts).orderBy(desc(aiJobAttempts.startedAt), desc(aiJobAttempts.id)).limit(limit).all().map(attemptFromRow);
  }

  listOperationalSummaries(): AIJobOperationalSummary[] {
    const rows = this.database.client.prepare("select status, count(*) as count from ai_jobs group by status order by status").all() as Array<{ status: AIJobStatus; count: number }>;
    return rows.map((row) => ({ status: row.status, count: row.count }));
  }

  listRecent(limit: number): AIJobOperationalView[] {
    return this.database.db.select().from(aiJobs).orderBy(desc(aiJobs.updatedAt), desc(aiJobs.id)).limit(limit).all().map((row) => operationalViewFromJob(jobFromRow(row)));
  }

  listTerminal(limit: number): AIJobOperationalView[] {
    return this.database.db.select().from(aiJobs).where(inArray(aiJobs.status, ["DEAD_LETTER", "CANCELLED"]))
      .orderBy(desc(aiJobs.updatedAt), desc(aiJobs.id)).limit(limit).all().map((row) => operationalViewFromJob(jobFromRow(row)));
  }
}

function leaseWhere(lease: AIJobLease) {
  return and(
    eq(aiJobs.id, lease.jobId),
    eq(aiJobs.status, "RUNNING"),
    eq(aiJobs.leaseOwner, lease.leaseOwner),
    eq(aiJobs.leaseToken, lease.leaseToken),
    eq(aiJobs.leaseGeneration, lease.leaseGeneration),
  );
}

function matchesLease(job: AIJob, lease: AIJobLease): boolean {
  return job.status === "RUNNING" && job.leaseOwner === lease.leaseOwner && job.leaseToken === lease.leaseToken && job.leaseGeneration === lease.leaseGeneration;
}

function monotonicJobTime(job: AIJob, requested: number): number {
  return Math.max(requested, job.createdAt, job.lastHeartbeatAt ?? 0);
}

function jobFromRow(row: AIJobRow): AIJob {
  return {
    id: row.id,
    kind: row.kind,
    payloadVersion: row.payloadVersion,
    payloadJson: row.payloadJson,
    payloadHash: row.payloadHash,
    dedupeKey: row.dedupeKey,
    costCenter: row.costCenter,
    costOperationId: row.costOperationId,
    priority: row.priority,
    status: row.status,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    timeoutMs: row.timeoutMs,
    leaseDurationMs: row.leaseDurationMs,
    backoffBaseMs: row.backoffBaseMs,
    backoffMaxMs: row.backoffMaxMs,
    scheduledAt: row.scheduledAt,
    leaseOwner: row.leaseOwner,
    leaseToken: row.leaseToken,
    leaseGeneration: row.leaseGeneration,
    leaseExpiresAt: row.leaseExpiresAt,
    lastHeartbeatAt: row.lastHeartbeatAt,
    lastErrorCode: row.lastErrorCode,
    cancellationRequestedAt: row.cancellationRequestedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };
}

function attemptFromRow(row: AIJobAttemptRow): AIJobAttempt {
  return {
    id: row.id,
    jobId: row.jobId,
    attemptNumber: row.attemptNumber,
    workerId: row.workerId,
    leaseGeneration: row.leaseGeneration,
    startedAt: row.startedAt,
    lastHeartbeatAt: row.lastHeartbeatAt,
    completedAt: row.completedAt,
    outcome: row.outcome,
    safeErrorCode: row.safeErrorCode,
    retryScheduledAt: row.retryScheduledAt,
  };
}

function operationalViewFromJob(job: AIJob): AIJobOperationalView {
  return {
    id: job.id,
    kind: job.kind,
    payloadVersion: job.payloadVersion,
    payloadHash: job.payloadHash,
    dedupeKey: job.dedupeKey,
    costCenter: job.costCenter,
    costOperationId: job.costOperationId,
    priority: job.priority,
    status: job.status,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    timeoutMs: job.timeoutMs,
    leaseDurationMs: job.leaseDurationMs,
    backoffBaseMs: job.backoffBaseMs,
    backoffMaxMs: job.backoffMaxMs,
    scheduledAt: job.scheduledAt,
    leaseOwner: job.leaseOwner,
    leaseGeneration: job.leaseGeneration,
    leaseExpiresAt: job.leaseExpiresAt,
    lastHeartbeatAt: job.lastHeartbeatAt,
    lastErrorCode: job.lastErrorCode,
    cancellationRequestedAt: job.cancellationRequestedAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
  };
}
