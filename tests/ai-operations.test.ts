import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../src/server/admin-auth";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import {
  AIJobError,
  AIJobExecutionError,
  AIJobHandlerRegistry,
  AIJobQueueService,
  AIOutboxError,
  AIOutboxRouterRegistry,
  AIOutboxService,
  SQLiteAIJobRepository,
  AIWorker,
  normalizeAIJobSpec,
  type AIJobExecutionContext,
  type AIJobSpec,
} from "../src/server/ai";
import { createChangeManagementService } from "../src/server/change-management";
import { contentResources, aiJobs, aiOutboxEvents } from "../src/server/content/schema";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const BASE_TIME = 1_900_700_000_000;

interface Fixture {
  root: string;
  database: ContentDatabase;
  owner: AdminActor;
  handlers: AIJobHandlerRegistry;
  jobs: AIJobQueueService;
  routers: AIOutboxRouterRegistry;
  outbox: AIOutboxService;
  setNow(value: number): void;
  close(): void;
}

function createFixture(): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-operations-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  const identities = new SQLiteAdminIdentityRepository(database);
  const ownerUser = identities.createInitialOwner({
    id: uuidv7(),
    email: `owner-${uuidv7()}@ai-operations.test`,
    displayName: "AI Operations Owner",
    passwordHash: "fixture-only",
    createdAt: BASE_TIME,
  });
  const owner: AdminActor = { actorUserId: ownerUser.id, actorRole: "OWNER" };
  let now = BASE_TIME + 100;
  const handlers = new AIJobHandlerRegistry();
  const jobs = new AIJobQueueService(database, handlers, { clock: () => now });
  const routers = new AIOutboxRouterRegistry();
  const outbox = new AIOutboxService(database, routers, { jobQueue: jobs, clock: () => now });
  return {
    root,
    database,
    owner,
    handlers,
    jobs,
    routers,
    outbox,
    setNow(value: number) {
      now = value;
    },
    close() {
      database.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
    },
  };
}

function registerValueHandler(
  fixture: Pick<Fixture, "handlers">,
  kind: string,
  execute: (value: string, context: AIJobExecutionContext) => void | Promise<void> = () => undefined,
  payloadVersion = 1,
): void {
  fixture.handlers.register({
    kind,
    payloadVersion,
    validatePayload(value: unknown): Record<string, unknown> {
      if (typeof value !== "object" || value === null || Array.isArray(value)) throw new AIJobError("AI_JOB_PAYLOAD_INVALID", "Synthetic payload is invalid.");
      const record = value as Record<string, unknown>;
      if (Object.keys(record).some((key) => key !== "value" && key !== "z") || typeof record.value !== "string" || (record.z !== undefined && typeof record.z !== "string")) {
        throw new AIJobError("AI_JOB_PAYLOAD_INVALID", "Synthetic payload is invalid.");
      }
      return record.z === undefined ? { value: record.value } : { value: record.value, z: record.z };
    },
    execute(payload, context) {
      return execute(payload.value as string, context);
    },
  });
}

function spec(overrides: Partial<AIJobSpec> = {}): AIJobSpec {
  return {
    kind: "synthetic.work",
    payloadVersion: 1,
    payload: { value: "ok" },
    dedupeKey: `synthetic-${uuidv7()}`,
    costCenter: "EXPERIMENTS",
    priority: "NORMAL",
    maxAttempts: 2,
    timeoutMs: 1_000,
    leaseDurationMs: 100,
    backoffBaseMs: 0,
    backoffMaxMs: 0,
    scheduledAt: BASE_TIME + 100,
    ...overrides,
  };
}

function expectJobCode(fn: () => unknown, code: AIJobError["code"]): AIJobError {
  let captured: unknown;
  try {
    fn();
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof AIJobError);
  assert.equal(captured.code, code);
  return captured;
}

test("M3C1 migration creates durable Job, Attempt, and Outbox tables without raw content", () => {
  const fixture = createFixture();
  try {
    const migrationCount = (fixture.database.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count;
    assert.equal(migrationCount, 47);
    for (const table of ["ai_jobs", "ai_job_attempts", "ai_outbox_events"]) {
      const columns = fixture.database.client.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>;
      assert.ok(columns.length > 0);
      assert.equal(columns.some((column) => /prompt|message|answer|secret|credential|authorization/i.test(column.name)), false);
    }
  } finally {
    fixture.close();
  }
});

test("Job handler registry is closed and Job dedupe uses canonical payload and execution meaning", () => {
  const fixture = createFixture();
  try {
    registerValueHandler(fixture, "synthetic.work");
    assert.deepEqual(fixture.handlers.supportedKinds(), ["synthetic.work"]);
    assert.throws(() => fixture.handlers.register({
      kind: "synthetic.work",
      payloadVersion: 1,
      validatePayload: () => ({ value: "ok" }),
      execute: () => undefined,
    }), /duplicate/i);
    const first = fixture.jobs.enqueue(spec({ payload: { z: "last", value: "ok" }, dedupeKey: "same-job" }));
    const replay = fixture.jobs.enqueue(spec({ payload: { value: "ok", z: "last" }, dedupeKey: "same-job" }));
    assert.equal(first.id, replay.id);
    assert.equal(first.payloadJson, '{"value":"ok","z":"last"}');
    assert.equal(first.payloadHash, createHash("sha256").update(first.payloadJson).digest("hex"));
    expectJobCode(() => fixture.jobs.enqueue(spec({ payload: { value: "different" }, dedupeKey: "same-job" })), "AI_JOB_DEDUPE_CONFLICT");
    expectJobCode(() => fixture.jobs.enqueue(spec({ kind: "not.registered" })), "AI_JOB_HANDLER_NOT_FOUND");
    expectJobCode(() => fixture.jobs.enqueue(spec({ payload: { value: "x".repeat(5_000) } })), "AI_JOB_INVALID");
  } finally {
    fixture.close();
  }
});

test("Job and Outbox payload boundaries reject raw student-content and secret-shaped fields", () => {
  const fixture = createFixture();
  try {
    fixture.handlers.register({
      kind: "synthetic.untrusted",
      payloadVersion: 1,
      validatePayload: (value) => value as Record<string, unknown>,
      execute: () => undefined,
    });
    expectJobCode(() => fixture.jobs.enqueue(spec({
      kind: "synthetic.untrusted",
      payload: { prompt: "TOP_SECRET_STUDENT_PROMPT" },
    })), "AI_JOB_INVALID");

    fixture.routers.register({
      eventType: "synthetic.untrusted",
      payloadVersion: 1,
      validatePayload: (value) => value as Record<string, unknown>,
      toJob: () => spec({ kind: "synthetic.untrusted" }),
    });
    assert.throws(() => fixture.outbox.enqueue({
      eventType: "synthetic.untrusted",
      payloadVersion: 1,
      payload: { message: "TOP_SECRET_STUDENT_PROMPT" },
      dedupeKey: "untrusted",
    }), /forbidden|invalid/i);
    const jobs = fixture.database.client.prepare("select payload_json from ai_jobs").all() as Array<{ payload_json: string }>;
    const events = fixture.database.client.prepare("select payload_json from ai_outbox_events").all() as Array<{ payload_json: string }>;
    assert.equal(JSON.stringify(jobs).includes("TOP_SECRET_STUDENT_PROMPT"), false);
    assert.equal(JSON.stringify(events).includes("TOP_SECRET_STUDENT_PROMPT"), false);
  } finally {
    fixture.close();
  }
});

test("Claim ordering respects priority and schedule, while pending cancellation is durable", () => {
  const fixture = createFixture();
  try {
    registerValueHandler(fixture, "synthetic.work");
    registerValueHandler(fixture, "synthetic.other");
    const low = fixture.jobs.enqueue(spec({ dedupeKey: "low", priority: "LOW", scheduledAt: BASE_TIME + 100 }));
    const high = fixture.jobs.enqueue(spec({ dedupeKey: "high", priority: "HIGH", scheduledAt: BASE_TIME + 100 }));
    const future = fixture.jobs.enqueue(spec({ dedupeKey: "future", scheduledAt: BASE_TIME + 500 }));
    const claimed = fixture.jobs.claimNext({ workerId: "worker-priority", supportedKinds: ["synthetic.work"], now: BASE_TIME + 100 });
    assert.ok(claimed);
    assert.equal(claimed.job.id, high.id);
    const cancelled = fixture.jobs.cancelPending(future.id, BASE_TIME + 110);
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal(fixture.jobs.getJob(low.id)?.status, "PENDING");
    assert.equal(fixture.jobs.getJob(future.id)?.status, "CANCELLED");
  } finally {
    fixture.close();
  }
});

test("A rolling-deployment worker leaves an unknown Job payload version pending", () => {
  const fixture = createFixture();
  try {
    registerValueHandler(fixture, "synthetic.work");
    const repository = new SQLiteAIJobRepository(fixture.database);
    const normalized = normalizeAIJobSpec(spec({ kind: "synthetic.work", payloadVersion: 2, dedupeKey: "future-version" }));
    const unknown = repository.insertInTransaction({ id: uuidv7(), spec: normalized, now: BASE_TIME + 100 });
    assert.equal(fixture.jobs.claimNext({ workerId: "old-worker", supportedKinds: ["synthetic.work"], now: BASE_TIME + 100 }), null);
    assert.equal(fixture.jobs.getJob(unknown.id)?.status, "PENDING");
  } finally {
    fixture.close();
  }
});

test("Job selection filters exact handler versions before LIMIT and preserves rolling-deployment liveness", () => {
  const fixture = createFixture();
  try {
    registerValueHandler(fixture, "synthetic.work", undefined, 1);
    const repository = new SQLiteAIJobRepository(fixture.database);
    const unsupported: ReturnType<typeof repository.insertInTransaction>[] = [];
    for (let index = 0; index < 101; index += 1) {
      const normalized = normalizeAIJobSpec(spec({
        id: uuidv7(),
        kind: "synthetic.work",
        payloadVersion: 2,
        payload: { value: `future-${index}` },
        dedupeKey: `future-${index}`,
        priority: "CRITICAL",
      }));
      unsupported.push(repository.insertInTransaction({ id: normalized.id ?? uuidv7(), spec: normalized, now: BASE_TIME + 100 }));
    }
    const supported = fixture.jobs.enqueue(spec({
      kind: "synthetic.work",
      payloadVersion: 1,
      payload: { value: "supported-behind-future" },
      dedupeKey: "supported-behind-future",
      priority: "LOW",
    }));

    assert.equal(fixture.jobs.oldestEligible({ supportedKinds: ["synthetic.work"], now: BASE_TIME + 100 })?.id, supported.id);
    const claimed = fixture.jobs.claimNext({ workerId: "old-worker", supportedKinds: ["synthetic.work"], now: BASE_TIME + 100 });
    assert.equal(claimed?.job.id, supported.id);
    assert.equal(claimed?.attempt.attemptNumber, 1);
    assert.equal(unsupported.every((job) => fixture.jobs.getJob(job.id)?.status === "PENDING"), true);
    assert.equal(unsupported.every((job) => fixture.jobs.listAttempts(job.id).length === 0), true);
    assert.equal(unsupported.every((job) => fixture.jobs.getJob(job.id)?.leaseOwner === null), true);

    const newHandlers = new AIJobHandlerRegistry();
    registerValueHandler({ handlers: newHandlers }, "synthetic.work", undefined, 1);
    registerValueHandler({ handlers: newHandlers }, "synthetic.work", undefined, 2);
    const newWorkerJobs = new AIJobQueueService(fixture.database, newHandlers, { clock: () => BASE_TIME + 100 });
    const futureClaim = newWorkerJobs.claimNext({ workerId: "new-worker", supportedKinds: ["synthetic.work"], now: BASE_TIME + 100 });
    assert.ok(futureClaim);
    assert.equal(futureClaim.job.payloadVersion, 2);
    fixture.jobs.complete(claimed!.lease, BASE_TIME + 110);
    newWorkerJobs.complete(futureClaim.lease, BASE_TIME + 110);
  } finally {
    fixture.close();
  }
});

test("Two independent SQLite worker connections cannot claim the same Job", () => {
  const fixture = createFixture();
  let secondDatabase: ContentDatabase | null = null;
  try {
    registerValueHandler(fixture, "synthetic.work");
    secondDatabase = openContentDatabase({ dataDirectory: fixture.root, migrationsDirectory });
    const secondHandlers = new AIJobHandlerRegistry();
    registerValueHandler({ handlers: secondHandlers }, "synthetic.work");
    const secondJobs = new AIJobQueueService(secondDatabase, secondHandlers, { clock: () => BASE_TIME + 100 });
    const job = fixture.jobs.enqueue(spec({ dedupeKey: "two-connections" }));
    const firstClaim = fixture.jobs.claimNext({ workerId: "worker-connection-a", supportedKinds: ["synthetic.work"], now: BASE_TIME + 100 });
    const secondClaim = secondJobs.claimNext({ workerId: "worker-connection-b", supportedKinds: ["synthetic.work"], now: BASE_TIME + 100 });
    assert.ok(firstClaim);
    assert.equal(secondClaim, null);
    assert.equal(firstClaim.job.id, job.id);
  } finally {
    secondDatabase?.close();
    fixture.close();
  }
});

test("Lease heartbeat, expiry recovery, generation fencing, and immutable attempts protect Job ownership", () => {
  const fixture = createFixture();
  try {
    registerValueHandler(fixture, "synthetic.work");
    const job = fixture.jobs.enqueue(spec({ dedupeKey: "fenced", leaseDurationMs: 100 }));
    const first = fixture.jobs.claimNext({ workerId: "worker-a", supportedKinds: ["synthetic.work"], now: BASE_TIME + 100 });
    assert.ok(first);
    assert.equal(first.job.leaseGeneration, 1);
    assert.equal(first.attempt.attemptNumber, 1);
    assert.ok(first.lease.leaseToken);
    const heartbeat = fixture.jobs.heartbeat(first.lease, BASE_TIME + 150);
    assert.equal(heartbeat.lastHeartbeatAt, BASE_TIME + 150);
    const recovered = fixture.jobs.recoverExpiredLeases(BASE_TIME + 250);
    assert.equal(recovered.length, 1);
    assert.equal(fixture.jobs.getJob(job.id)?.status, "RETRY_WAIT");
    const second = fixture.jobs.claimNext({ workerId: "worker-b", supportedKinds: ["synthetic.work"], now: BASE_TIME + 250 });
    assert.ok(second);
    assert.equal(second.job.leaseGeneration, 2);
    expectJobCode(() => fixture.jobs.heartbeat(first.lease, BASE_TIME + 260), "AI_JOB_LEASE_LOST");
    expectJobCode(() => fixture.jobs.complete(first.lease, BASE_TIME + 260), "AI_JOB_LEASE_LOST");
    expectJobCode(() => fixture.jobs.fail({ lease: first.lease, now: BASE_TIME + 260, safeErrorCode: "STALE", retryable: true, attemptOutcome: "RETRYABLE_FAILURE" }), "AI_JOB_LEASE_LOST");
    fixture.jobs.complete(second.lease, BASE_TIME + 270);
    const attempts = fixture.jobs.listAttempts(job.id);
    assert.deepEqual(attempts.map((attempt) => [attempt.attemptNumber, attempt.leaseGeneration, attempt.outcome]), [
      [1, 1, "LEASE_EXPIRED"],
      [2, 2, "SUCCEEDED"],
    ]);
    assert.equal(fixture.jobs.getJob(job.id)?.status, "SUCCEEDED");
  } finally {
    fixture.close();
  }
});

test("Worker retries explicitly retryable failures, dead-letters non-retryable failures, and enforces timeout", async () => {
  const fixture = createFixture();
  try {
    let attempts = 0;
    registerValueHandler(fixture, "synthetic.retry", (value) => {
      attempts += 1;
      if (value === "retry" && attempts === 1) throw new AIJobExecutionError("SYNTHETIC_RETRY", true);
    });
    registerValueHandler(fixture, "synthetic.dead", () => {
      throw new AIJobExecutionError("SYNTHETIC_FATAL", false);
    });
    registerValueHandler(fixture, "synthetic.timeout", async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    const worker = new AIWorker({ jobs: fixture.jobs, handlers: fixture.handlers, workerId: "worker-test", clock: () => BASE_TIME + 100 });
    const retryJob = fixture.jobs.enqueue(spec({ kind: "synthetic.retry", payload: { value: "retry" }, dedupeKey: "retry", maxAttempts: 2 }));
    await worker.runOnce(BASE_TIME + 100);
    assert.equal(fixture.jobs.getJob(retryJob.id)?.status, "RETRY_WAIT");
    await worker.runOnce(BASE_TIME + 100);
    assert.equal(fixture.jobs.getJob(retryJob.id)?.status, "SUCCEEDED");
    assert.deepEqual(fixture.jobs.listAttempts(retryJob.id).map((attempt) => attempt.outcome), ["RETRYABLE_FAILURE", "SUCCEEDED"]);

    const deadJob = fixture.jobs.enqueue(spec({ kind: "synthetic.dead", payload: { value: "fatal" }, dedupeKey: "fatal", maxAttempts: 3 }));
    await worker.runOnce(BASE_TIME + 100);
    assert.equal(fixture.jobs.getJob(deadJob.id)?.status, "DEAD_LETTER");
    assert.equal(fixture.jobs.listAttempts(deadJob.id)[0]?.outcome, "NON_RETRYABLE_FAILURE");

    const timeoutJob = fixture.jobs.enqueue(spec({ kind: "synthetic.timeout", payload: { value: "slow" }, dedupeKey: "timeout", timeoutMs: 20, maxAttempts: 1 }));
    await worker.runOnce(BASE_TIME + 100);
    assert.equal(fixture.jobs.getJob(timeoutJob.id)?.status, "DEAD_LETTER");
    assert.equal(fixture.jobs.listAttempts(timeoutJob.id)[0]?.outcome, "TIMED_OUT");
    const noSecondRun = await worker.runOnce(BASE_TIME + 100);
    assert.equal(noSecondRun.claimedJobId, null);
  } finally {
    fixture.close();
  }
});

test("A retried handler can safely repeat an idempotent domain action after completion is lost", async () => {
  const fixture = createFixture();
  try {
    const appliedKeys = new Set<string>();
    let forcedRecovery = false;
    registerValueHandler(fixture, "synthetic.idempotent", (value) => {
      if (!appliedKeys.has(value)) appliedKeys.add(value);
      if (!forcedRecovery) {
        forcedRecovery = true;
        fixture.jobs.recoverExpiredLeases(BASE_TIME + 300);
      }
    });
    const worker = new AIWorker({ jobs: fixture.jobs, handlers: fixture.handlers, workerId: "idempotent-worker", clock: () => BASE_TIME + 100 });
    const job = fixture.jobs.enqueue(spec({
      kind: "synthetic.idempotent",
      payload: { value: "stable-domain-key" },
      dedupeKey: "idempotent-action",
      maxAttempts: 2,
      leaseDurationMs: 100,
      backoffBaseMs: 0,
      backoffMaxMs: 0,
    }));
    await worker.runOnce(BASE_TIME + 100);
    assert.equal(fixture.jobs.getJob(job.id)?.status, "RETRY_WAIT");
    await worker.runOnce(BASE_TIME + 300);
    assert.equal(fixture.jobs.getJob(job.id)?.status, "SUCCEEDED");
    assert.equal(appliedKeys.size, 1);
    assert.deepEqual(fixture.jobs.listAttempts(job.id).map((attempt) => attempt.outcome), ["LEASE_EXPIRED", "SUCCEEDED"]);
  } finally {
    fixture.close();
  }
});

function registerOutboxRouterVersion(fixture: Fixture, payloadVersion: number): void {
  fixture.routers.register({
    eventType: "synthetic.event",
    payloadVersion,
    validatePayload(value: unknown): Record<string, unknown> {
      if (typeof value !== "object" || value === null || Array.isArray(value)) throw new AIOutboxError("AI_OUTBOX_INVALID", "Synthetic event payload is invalid.");
      const record = value as Record<string, unknown>;
      if (Object.keys(record).length !== 1 || typeof record.ref !== "string" || !record.ref.trim()) throw new AIOutboxError("AI_OUTBOX_INVALID", "Synthetic event payload is invalid.");
      return { ref: record.ref.trim() };
    },
    toJob(payload) {
      return spec({
        kind: "synthetic.outbox",
        payloadVersion,
        payload: { value: payload.ref },
        dedupeKey: `outbox-job:${payload.ref}:v${payloadVersion}`,
        scheduledAt: BASE_TIME + 100,
      });
    },
  });
  registerValueHandler(fixture, "synthetic.outbox", undefined, payloadVersion);
}

function registerOutboxRouter(fixture: Fixture): void {
  registerOutboxRouterVersion(fixture, 1);
}

function insertRawOutbox(
  fixture: Fixture,
  input: { eventType: string; payloadVersion?: number; payloadJson?: string; payloadHash?: string; dedupeKey: string },
): void {
  const payloadJson = input.payloadJson ?? '{"ref":"raw"}';
  fixture.database.db.insert(aiOutboxEvents).values({
    id: uuidv7(),
    eventType: input.eventType,
    payloadVersion: input.payloadVersion ?? 1,
    payloadJson,
    payloadHash: input.payloadHash ?? createHash("sha256").update(payloadJson).digest("hex"),
    dedupeKey: input.dedupeKey,
    status: "PENDING",
    scheduledAt: BASE_TIME + 100,
    dispatchedJobId: null,
    safeErrorCode: null,
    createdAt: BASE_TIME + 100,
    dispatchedAt: null,
  }).run();
}

test("Outbox enqueue is deduplicated, dispatch is atomic with Job creation, and unsupported/corrupt events remain safe", () => {
  const fixture = createFixture();
  try {
    registerOutboxRouter(fixture);
    const first = fixture.outbox.enqueue({
      eventType: "synthetic.event",
      payloadVersion: 1,
      payload: { ref: "one" },
      dedupeKey: "event-one",
      scheduledAt: BASE_TIME + 100,
    });
    const replay = fixture.outbox.enqueue({
      eventType: "synthetic.event",
      payloadVersion: 1,
      payload: { ref: "one" },
      dedupeKey: "event-one",
      scheduledAt: BASE_TIME + 100,
    });
    assert.equal(replay.id, first.id);
    assert.equal("payloadJson" in (fixture.jobs.listRecent(10)[0] ?? {}), false);
    assert.throws(() => fixture.outbox.enqueue({
      eventType: "synthetic.event",
      payloadVersion: 1,
      payload: { ref: "two" },
      dedupeKey: "event-one",
      scheduledAt: BASE_TIME + 100,
    }), /dedupe/i);
    const dispatched = fixture.outbox.dispatchOne({ now: BASE_TIME + 100, supportedEventTypes: fixture.routers.supportedEventTypes() });
    assert.equal(dispatched?.status, "DISPATCHED");
    assert.ok(dispatched?.dispatchedJobId);
    assert.equal(fixture.outbox.dispatchOne({ now: BASE_TIME + 100, supportedEventTypes: fixture.routers.supportedEventTypes() }), null);
    const jobCount = (fixture.database.client.prepare("select count(*) as count from ai_jobs where kind = 'synthetic.outbox'").get() as { count: number }).count;
    assert.equal(jobCount, 1);

    insertRawOutbox(fixture, { eventType: "future.event", dedupeKey: "future" });
    assert.equal(fixture.outbox.dispatchOne({ now: BASE_TIME + 100, supportedEventTypes: ["future.event"] }), null);
    const invalidId = (fixture.database.client.prepare("select id from ai_outbox_events where event_type = 'future.event'").get() as { id: string }).id;
    assert.equal(fixture.outbox.listRecent(10).find((event) => event.id === invalidId)?.status, "PENDING");

    insertRawOutbox(fixture, { eventType: "synthetic.event", payloadJson: '{"wrong":true}', dedupeKey: "invalid-payload" });
    const failed = fixture.outbox.dispatchOne({ now: BASE_TIME + 100, supportedEventTypes: fixture.routers.supportedEventTypes() });
    assert.equal(failed?.status, "FAILED");
    assert.equal(failed?.safeErrorCode, "AI_OUTBOX_INVALID");

    insertRawOutbox(fixture, { eventType: "synthetic.event", payloadHash: "0".repeat(64), dedupeKey: "tampered-hash" });
    const tampered = fixture.outbox.dispatchOne({ now: BASE_TIME + 100, supportedEventTypes: fixture.routers.supportedEventTypes() });
    assert.equal(tampered?.status, "FAILED");
    assert.equal(tampered?.safeErrorCode, "AI_OUTBOX_INVALID");
  } finally {
    fixture.close();
  }
});

test("Outbox selection filters exact routes before LIMIT and keeps future versions pending", () => {
  const fixture = createFixture();
  try {
    registerOutboxRouter(fixture);
    insertRawOutbox(fixture, {
      eventType: "synthetic.event",
      payloadVersion: 2,
      dedupeKey: "future-route",
    });
    const supported = fixture.outbox.enqueue({
      eventType: "synthetic.event",
      payloadVersion: 1,
      payload: { ref: "supported-route" },
      dedupeKey: "supported-route",
      scheduledAt: BASE_TIME + 200,
    });
    const firstDispatch = fixture.outbox.dispatchOne({ now: BASE_TIME + 300 });
    assert.equal(firstDispatch?.id, supported.id);
    assert.equal(firstDispatch?.status, "DISPATCHED");
    const future = fixture.database.client.prepare("select status, safe_error_code, dispatched_job_id from ai_outbox_events where dedupe_key = 'future-route'").get() as { status: string; safe_error_code: string | null; dispatched_job_id: string | null };
    assert.deepEqual(future, { status: "PENDING", safe_error_code: null, dispatched_job_id: null });

    registerOutboxRouterVersion(fixture, 2);
    assert.deepEqual(fixture.routers.supportedRoutes(), [
      { eventType: "synthetic.event", payloadVersion: 1 },
      { eventType: "synthetic.event", payloadVersion: 2 },
    ]);
    const secondDispatch = fixture.outbox.dispatchOne({ now: BASE_TIME + 300 });
    assert.equal(secondDispatch?.status, "DISPATCHED");
    assert.equal(secondDispatch?.dedupeKey, "future-route");
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_jobs where kind = 'synthetic.outbox'").get() as { count: number }).count, 2);
  } finally {
    fixture.close();
  }
});

test("Outbox route registry exposes deterministic exact event/version pairs", () => {
  const registry = new AIOutboxRouterRegistry();
  for (const route of [
    { eventType: "event.b", payloadVersion: 2 },
    { eventType: "event.a", payloadVersion: 3 },
    { eventType: "event.a", payloadVersion: 1 },
  ]) {
    registry.register({
      ...route,
      validatePayload: () => ({ ref: "route" }),
      toJob: () => spec(),
    });
  }
  assert.deepEqual(registry.supportedRoutes(), [
    { eventType: "event.a", payloadVersion: 1 },
    { eventType: "event.a", payloadVersion: 3 },
    { eventType: "event.b", payloadVersion: 2 },
  ]);
});

test("Outbox producer participates in caller transaction atomicity", () => {
  const fixture = createFixture();
  try {
    registerOutboxRouter(fixture);
    const rollbackResourceId = uuidv7();
    assert.throws(() => fixture.database.client.transaction(() => {
      fixture.database.db.insert(contentResources).values({
        id: rollbackResourceId,
        resourceType: "test.outbox",
        resourceKey: "rollback",
        payload: { value: "rollback" },
        revision: 1,
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME,
      }).run();
      fixture.outbox.enqueueInTransaction({ eventType: "synthetic.event", payloadVersion: 1, payload: { ref: "rollback" }, dedupeKey: "rollback", scheduledAt: BASE_TIME + 100 }, BASE_TIME + 100);
      throw new Error("rollback fixture");
    })());
    assert.equal((fixture.database.client.prepare("select count(*) as count from content_resources where id = ?").get(rollbackResourceId) as { count: number }).count, 0);
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_outbox_events where dedupe_key = 'rollback'").get() as { count: number }).count, 0);

    const commitResourceId = uuidv7();
    fixture.database.client.transaction(() => {
      fixture.database.db.insert(contentResources).values({
        id: commitResourceId,
        resourceType: "test.outbox",
        resourceKey: "commit",
        payload: { value: "commit" },
        revision: 1,
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME,
      }).run();
      fixture.outbox.enqueueInTransaction({ eventType: "synthetic.event", payloadVersion: 1, payload: { ref: "commit" }, dedupeKey: "commit", scheduledAt: BASE_TIME + 100 }, BASE_TIME + 100);
    })();
    assert.equal((fixture.database.client.prepare("select count(*) as count from content_resources where id = ?").get(commitResourceId) as { count: number }).count, 1);
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_outbox_events where dedupe_key = 'commit'").get() as { count: number }).count, 1);
  } finally {
    fixture.close();
  }
});
