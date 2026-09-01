import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../src/server/admin-auth";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import {
  AIBudgetAdmissionService,
  SQLiteAIBudgetAccountingReader,
  SQLiteAIBudgetPolicyRepository,
  SQLiteAIBudgetRuntimeRepository,
  SQLiteAIAccountingRepository,
  SQLiteAIRateLimitPolicyRepository,
  AIJobHandlerRegistry,
  AIJobQueueService,
  AIWorker,
  AIOperationalRecoveryService,
  createAIAdmissionRequestFingerprint,
  createReconciliationJobHandler,
  type AIAdmissionPlan,
  type AIBudgetPolicyContent,
  type AIRateLimitPolicyContent,
  type AIOperationalRecoveryPolicy,
} from "../src/server/ai";
import {
  aiModelConfigs,
  aiProviderConfigs,
  aiRateCardRevisions,
  aiRateCards,
} from "../src/server/content/schema";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const BASE_TIME = 1_900_800_000_000;

interface Fixture {
  root: string;
  database: ContentDatabase;
  owner: AdminActor;
  admission: AIBudgetAdmissionService;
  accounting: SQLiteAIAccountingRepository;
  jobs: AIJobQueueService;
  handlers: AIJobHandlerRegistry;
  recovery: AIOperationalRecoveryService;
  budgetPolicyId: string;
  rateLimitPolicyId: string;
  providerConfigId: string;
  modelConfigId: string;
  rateCardId: string;
  rateCardRevisionId: string;
  setNow(value: number): void;
  close(): void;
}

function createFixture(maxAttempts = 3): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-recovery-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  const identities = new SQLiteAdminIdentityRepository(database);
  const ownerUser = identities.createInitialOwner({
    id: uuidv7(),
    email: `owner-${uuidv7()}@ai-recovery.test`,
    displayName: "AI Recovery Owner",
    passwordHash: "fixture-only",
    createdAt: BASE_TIME,
  });
  const owner: AdminActor = { actorUserId: ownerUser.id, actorRole: "OWNER" };
  const providerConfigId = uuidv7();
  const modelConfigId = uuidv7();
  const rateCardId = uuidv7();
  const rateCardRevisionId = uuidv7();
  database.db.insert(aiProviderConfigs).values({
    id: providerConfigId,
    key: `recovery-provider-${uuidv7()}`,
    displayName: "Recovery fixture Provider",
    baseUrl: "https://provider.example/v1",
    credentialRef: null,
    enabled: false,
    retentionPolicy: "UNKNOWN",
    trainingPolicy: "UNKNOWN",
    zdrSupported: false,
    zdrRequired: false,
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    createdBy: ownerUser.id,
    updatedBy: ownerUser.id,
    revision: 1,
  }).run();
  database.db.insert(aiModelConfigs).values({
    id: modelConfigId,
    key: `recovery-model-${uuidv7()}`,
    displayName: "Recovery fixture Model",
    providerConfigId,
    providerModelId: "recovery-model",
    capability: "GENERATION",
    adapterKey: "test.generation",
    enabled: false,
    contextWindowTokens: 4096,
    maxOutputTokens: 512,
    embeddingDimensions: null,
    supportsStreaming: true,
    supportsReasoning: false,
    supportsStructuredOutput: false,
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    createdBy: ownerUser.id,
    updatedBy: ownerUser.id,
    revision: 1,
  }).run();
  database.db.insert(aiRateCards).values({
    id: rateCardId,
    key: `recovery-rate-${uuidv7()}`,
    currentRevision: 1,
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    createdBy: ownerUser.id,
    updatedBy: ownerUser.id,
  }).run();
  database.db.insert(aiRateCardRevisions).values({
    id: rateCardRevisionId,
    rateCardId,
    revision: 1,
    displayName: "Recovery fixture Rate Card",
    modelConfigId,
    modelConfigRevision: 1,
    currency: "USD",
    billingUsageNormalizerKey: "test.billing-standard",
    effectiveFrom: 0,
    effectiveTo: null,
    enabled: true,
    createdAt: BASE_TIME,
    createdBy: ownerUser.id,
  }).run();

  const budgetPolicyId = uuidv7();
  const rateLimitPolicyId = uuidv7();
  new SQLiteAIBudgetPolicyRepository(database).create({
    id: budgetPolicyId,
    actor: owner,
    now: BASE_TIME,
    content: {
      key: `recovery-budget-${uuidv7()}`,
      displayName: "Recovery Budget",
      currency: "USD",
      costCenter: "STUDENT_GENERATION",
      hardCapNano: 100_000,
      enabled: true,
    },
  });
  new SQLiteAIRateLimitPolicyRepository(database).create({
    id: rateLimitPolicyId,
    actor: owner,
    now: BASE_TIME,
    content: {
      key: `recovery-rate-limit-${uuidv7()}`,
      displayName: "Recovery Rate Limit",
      windowMs: 1_000_000,
      maxRequests: 100,
      maxConcurrentRequests: 100,
      enabled: true,
    },
  });

  let now = BASE_TIME + 100;
  const accounting = new SQLiteAIAccountingRepository(database);
  const admission = new AIBudgetAdmissionService(database, { clock: () => now });
  const handlers = new AIJobHandlerRegistry();
  const jobs = new AIJobQueueService(database, handlers, { clock: () => now });
  handlers.register(createReconciliationJobHandler(admission));
  const policy: AIOperationalRecoveryPolicy = {
    reservedStaleAfterMs: 50,
    executingStaleAfterMs: 50,
    scanBatchSize: 50,
    reconciliationJob: {
      maxAttempts,
      timeoutMs: 100,
      leaseDurationMs: 100,
      backoffBaseMs: 1_000,
      backoffMaxMs: 1_000,
    },
  };
  const recovery = new AIOperationalRecoveryService(
    admission,
    new SQLiteAIBudgetRuntimeRepository(database),
    new SQLiteAIBudgetAccountingReader(database),
    jobs,
    policy,
    () => now,
  );
  return {
    root,
    database,
    owner,
    admission,
    accounting,
    jobs,
    handlers,
    recovery,
    budgetPolicyId,
    rateLimitPolicyId,
    providerConfigId,
    modelConfigId,
    rateCardId,
    rateCardRevisionId,
    setNow(value: number) {
      now = value;
    },
    close() {
      database.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
    },
  };
}

function createOperation(fixture: Fixture, principalRef: string, startedAt: number): string {
  const id = uuidv7();
  fixture.accounting.createOperation({
    id,
    content: {
      costCenter: "STUDENT_GENERATION",
      idempotencyKey: null,
      opaquePrincipalRef: principalRef,
      subjectKey: "arabic",
      conversationId: null,
      responseId: null,
      jobId: null,
      evalRunId: null,
      knowledgeRevision: null,
      status: "OPEN",
      startedAt,
      completedAt: null,
    },
  });
  return id;
}

function makePlan(fixture: Fixture, input: {
  principalRef: string;
  operationId: string;
  idempotencyKey: string;
  maxCostNano?: number;
}): AIAdmissionPlan {
  const withoutFingerprint = {
    principalRef: input.principalRef,
    budgetPolicyId: fixture.budgetPolicyId,
    budgetPolicyRevision: 1,
    rateLimitPolicyId: fixture.rateLimitPolicyId,
    rateLimitPolicyRevision: 1,
    budgetPeriod: { startAt: BASE_TIME, endAt: BASE_TIME + 1_000_000 },
    costOperationId: input.operationId,
    costEstimate: {
      currency: "USD",
      maxCostNano: input.maxCostNano ?? 100,
      estimateBasis: "RECOVERY_TEST_ESTIMATE",
    },
    idempotencyKey: input.idempotencyKey,
  } satisfies Omit<AIAdmissionPlan, "requestFingerprint">;
  return { ...withoutFingerprint, requestFingerprint: createAIAdmissionRequestFingerprint(withoutFingerprint) };
}

function appendCompleteUsage(fixture: Fixture, operationId: string, cost: number, at: number) {
  return fixture.accounting.appendUsageCostRecord({
    id: uuidv7(),
    createdAt: at,
    content: {
      operationId,
      gatewayRequestId: `recovery-gateway-${uuidv7()}`,
      attemptIndex: 0,
      capability: "GENERATION",
      modelConfigId: fixture.modelConfigId,
      modelConfigRevision: 1,
      providerConfigId: fixture.providerConfigId,
      providerConfigRevision: 1,
      providerRequestId: null,
      rateCardId: fixture.rateCardId,
      rateCardRevision: 1,
      rateCardRevisionId: fixture.rateCardRevisionId,
      resolvedPricingRule: "DEFAULT",
      normalizedInputTokens: null,
      normalizedCacheHitInputTokens: null,
      normalizedCacheMissInputTokens: null,
      normalizedOutputTokens: null,
      normalizedReasoningTokens: null,
      billableStandardInputTokens: null,
      billableCacheHitInputTokens: null,
      billableCacheMissInputTokens: null,
      billableOutputTokens: null,
      billableReasoningTokens: null,
      requestUnits: 1,
      currency: "USD",
      knownCostNano: cost,
      costCompleteness: "COMPLETE",
      costBasis: "RATE_CARD",
      attemptStatus: "SUCCEEDED",
      startedAt: at,
      completedAt: at,
      latencyMs: 1,
    },
  });
}

test("Recovery releases stale RESERVED and settles stale EXECUTING without releasing uncertain work", () => {
  const fixture = createFixture();
  try {
    const reservedOperation = createOperation(fixture, "principal-reserved", BASE_TIME + 10);
    const reserved = fixture.admission.admit(makePlan(fixture, {
      principalRef: "principal-reserved",
      operationId: reservedOperation,
      idempotencyKey: "reserved-stale",
    }));
    fixture.setNow(BASE_TIME + 180);
    const freshOperation = createOperation(fixture, "principal-fresh", BASE_TIME + 180);
    const fresh = fixture.admission.admit(makePlan(fixture, {
      principalRef: "principal-fresh",
      operationId: freshOperation,
      idempotencyKey: "reserved-fresh",
    }));
    fixture.setNow(BASE_TIME + 200);
    const scan = fixture.recovery.runOnce(BASE_TIME + 200);
    assert.equal(scan.staleReservedReleased, 1);
    assert.equal(fixture.admission.getReservation(reserved.reservation.id)?.status, "RELEASED");
    assert.equal(fixture.admission.listLedger(reserved.reservation.id).at(-1)?.reasonCode, "STALE_PRE_EXECUTION_RECOVERY");
    assert.equal(fixture.admission.getBudgetSnapshot(reserved.account.id).activeReservationCount, 0);
    assert.equal(fixture.admission.getReservation(fresh.reservation.id)?.status, "RESERVED");

    const executingOperation = createOperation(fixture, "principal-executing", BASE_TIME + 300);
    const executing = fixture.admission.admit(makePlan(fixture, {
      principalRef: "principal-executing",
      operationId: executingOperation,
      idempotencyKey: "executing-stale",
    }));
    fixture.admission.startExecution(executing.reservation.id, BASE_TIME + 310);
    appendCompleteUsage(fixture, executingOperation, 40, BASE_TIME + 315);
    const executingScan = fixture.recovery.runOnce(BASE_TIME + 400);
    assert.equal(executingScan.staleExecutingSettled, 1);
    assert.equal(fixture.admission.getReservation(executing.reservation.id)?.status, "SETTLED");
    assert.equal(fixture.admission.getBudgetSnapshot(executing.account.id).activeReservationCount, 0);
  } finally {
    fixture.close();
  }
});

test("Recovery ensures one fingerprinted reconciliation Job and retries until accounting becomes complete", async () => {
  const fixture = createFixture();
  try {
    const operationId = createOperation(fixture, "principal-reconcile", BASE_TIME + 500);
    const admitted = fixture.admission.admit(makePlan(fixture, {
      principalRef: "principal-reconcile",
      operationId,
      idempotencyKey: "reconcile-1",
    }));
    fixture.admission.startExecution(admitted.reservation.id, BASE_TIME + 510);
    const firstScan = fixture.recovery.runOnce(BASE_TIME + 600);
    assert.equal(firstScan.stillReconciling, 1);
    assert.equal(fixture.jobs.listRecent(10).length, 1);
    const secondScan = fixture.recovery.runOnce(BASE_TIME + 601);
    assert.equal(secondScan.reconciliationJobsEnsured, 1);
    assert.equal(fixture.jobs.listRecent(10).length, 1);

    const worker = new AIWorker({ jobs: fixture.jobs, handlers: fixture.handlers, workerId: "recovery-worker", clock: () => BASE_TIME + 601 });
    await worker.runOnce(BASE_TIME + 601);
    const firstJob = fixture.jobs.listRecent(10)[0];
    assert.equal(firstJob.status, "RETRY_WAIT");
    assert.equal(fixture.admission.getReservation(admitted.reservation.id)?.status, "RECONCILIATION_REQUIRED");
    assert.equal(fixture.admission.getBudgetSnapshot(admitted.account.id).activeReservationCount, 1);

    appendCompleteUsage(fixture, operationId, 20, BASE_TIME + 620);
    const changedScan = fixture.recovery.runOnce(BASE_TIME + 700);
    assert.equal(changedScan.reconciliationJobsEnsured, 1);
    assert.equal(fixture.jobs.listRecent(10).length, 2);
    await worker.runOnce(BASE_TIME + 700);
    assert.equal(fixture.admission.getReservation(admitted.reservation.id)?.status, "SETTLED");
  } finally {
    fixture.close();
  }
});

test("A dead-letter reconciliation Job never releases the reservation, while a changed accounting fingerprint opens a new cycle", async () => {
  const fixture = createFixture(1);
  try {
    const operationId = createOperation(fixture, "principal-dead-letter", BASE_TIME + 800);
    const admitted = fixture.admission.admit(makePlan(fixture, {
      principalRef: "principal-dead-letter",
      operationId,
      idempotencyKey: "dead-letter-reconcile",
    }));
    fixture.admission.startExecution(admitted.reservation.id, BASE_TIME + 810);
    fixture.recovery.runOnce(BASE_TIME + 900);
    const worker = new AIWorker({ jobs: fixture.jobs, handlers: fixture.handlers, workerId: "dead-letter-worker", clock: () => BASE_TIME + 900 });
    await worker.runOnce(BASE_TIME + 900);
    const dead = fixture.jobs.listRecent(10).find((job) => job.kind === "admission.reconcile-reservation");
    assert.equal(dead?.status, "DEAD_LETTER");
    assert.equal(fixture.admission.getReservation(admitted.reservation.id)?.status, "RECONCILIATION_REQUIRED");
    assert.equal(fixture.admission.getBudgetSnapshot(admitted.account.id).activeReservationCount, 1);
    appendCompleteUsage(fixture, operationId, 25, BASE_TIME + 920);
    fixture.recovery.runOnce(BASE_TIME + 950);
    assert.equal(fixture.jobs.listRecent(10).filter((job) => job.kind === "admission.reconcile-reservation").length, 2);
  } finally {
    fixture.close();
  }
});
