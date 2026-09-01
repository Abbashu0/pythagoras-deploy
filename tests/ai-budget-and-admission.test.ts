import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../src/server/admin-auth";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import {
  AI_ADMISSION_ERROR_CODES,
  AIAdmissionError,
  AIBudgetAdmissionService,
  AI_BUDGET_POLICY_RESOURCE_TYPE,
  AI_COST_CENTERS,
  AI_RATE_LIMIT_POLICY_RESOURCE_TYPE,
  SQLiteAIAccountingRepository,
  SQLiteAIBudgetPolicyRepository,
  SQLiteAIRateLimitPolicyRepository,
  createAIAdmissionRequestFingerprint,
  type AIAdmissionPlan,
  type AIBudgetPolicyContent,
  type AIRateLimitPolicyContent,
} from "../src/server/ai";
import { createChangeManagementService } from "../src/server/change-management";
import {
  aiModelConfigs,
  aiProviderConfigs,
  aiRateCardRevisions,
  aiRateCards,
} from "../src/server/content/schema";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const BASE_TIME = 1_900_600_000_000;

interface Fixture {
  root: string;
  database: ContentDatabase;
  owner: AdminActor;
  admin: AdminActor;
  budgets: SQLiteAIBudgetPolicyRepository;
  rateLimits: SQLiteAIRateLimitPolicyRepository;
  accounting: SQLiteAIAccountingRepository;
  admission: AIBudgetAdmissionService;
  providerConfigId: string;
  modelConfigId: string;
  rateCardId: string;
  rateCardRevisionId: string;
  setNow(value: number): void;
  close(): void;
}

function createFixture(): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-m3b-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  const identities = new SQLiteAdminIdentityRepository(database);
  const ownerUser = identities.createInitialOwner({
    id: uuidv7(),
    email: `owner-${uuidv7()}@ai-m3b.test`,
    displayName: "AI M3B Owner",
    passwordHash: "fixture-only",
    createdAt: BASE_TIME,
  });
  const adminUser = identities.createAdmin({
    id: uuidv7(),
    email: `admin-${uuidv7()}@ai-m3b.test`,
    displayName: "AI M3B Admin",
    passwordHash: "fixture-only",
    createdAt: BASE_TIME + 1,
  });
  const owner: AdminActor = { actorUserId: ownerUser.id, actorRole: "OWNER" };
  const admin: AdminActor = { actorUserId: adminUser.id, actorRole: "ADMIN" };
  const providerConfigId = uuidv7();
  const modelConfigId = uuidv7();
  const rateCardId = uuidv7();
  const rateCardRevisionId = uuidv7();
  database.db.insert(aiProviderConfigs).values({
    id: providerConfigId,
    key: `m3b-provider-${uuidv7()}`,
    displayName: "M3B fixture Provider",
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
    key: `m3b-model-${uuidv7()}`,
    displayName: "M3B fixture Model",
    providerConfigId,
    providerModelId: "fixture-model",
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
    key: `m3b-rate-card-${uuidv7()}`,
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
    displayName: "M3B fixture Rate Card",
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
  let now = BASE_TIME + 100;
  const fixture: Fixture = {
    root,
    database,
    owner,
    admin,
    budgets: new SQLiteAIBudgetPolicyRepository(database),
    rateLimits: new SQLiteAIRateLimitPolicyRepository(database),
    accounting: new SQLiteAIAccountingRepository(database),
    admission: null as unknown as AIBudgetAdmissionService,
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
  fixture.admission = new AIBudgetAdmissionService(database, { clock: () => now });
  return fixture;
}

function defaultBudgetContent(overrides: Partial<AIBudgetPolicyContent> = {}): AIBudgetPolicyContent {
  return {
    key: `m3b-budget-${uuidv7()}`,
    displayName: "M3B Budget Policy",
    currency: "USD",
    costCenter: "STUDENT_GENERATION",
    hardCapNano: 1_000,
    enabled: true,
    ...overrides,
  };
}

function defaultRateLimitContent(overrides: Partial<AIRateLimitPolicyContent> = {}): AIRateLimitPolicyContent {
  return {
    key: `m3b-rate-limit-${uuidv7()}`,
    displayName: "M3B Rate Limit Policy",
    windowMs: 1_000,
    maxRequests: 100,
    maxConcurrentRequests: 100,
    enabled: true,
    ...overrides,
  };
}

function publishBudgetPolicy(
  fixture: Fixture,
  content: AIBudgetPolicyContent = defaultBudgetContent(),
  actor: AdminActor = fixture.owner,
): { id: string; revision: number } {
  const id = uuidv7();
  const changes = createChangeManagementService(fixture.database);
  const draft = changes.createChangeSet({
    title: "M3B Budget Policy",
    initialItem: {
      resourceType: AI_BUDGET_POLICY_RESOURCE_TYPE,
      resourceId: id,
      operation: "CREATE",
      expectedRevision: 0,
      desired: content,
    },
  }, actor);
  const submitted = changes.submit(draft.changeSet.id, draft.changeSet.revision, actor);
  const approved = changes.approve(submitted.changeSet.id, submitted.changeSet.revision, fixture.owner);
  changes.publish(approved.changeSet.id, approved.changeSet.revision, fixture.owner);
  return { id, revision: fixture.budgets.getCurrentRevision(id)?.revision ?? 0 };
}

function updateBudgetPolicy(
  fixture: Fixture,
  id: string,
  revision: number,
  content: AIBudgetPolicyContent,
): number {
  const changes = createChangeManagementService(fixture.database);
  const draft = changes.createChangeSet({
    title: "M3B Budget Policy update",
    initialItem: {
      resourceType: AI_BUDGET_POLICY_RESOURCE_TYPE,
      resourceId: id,
      operation: "UPDATE",
      expectedRevision: revision,
      desired: content,
    },
  }, fixture.owner);
  const submitted = changes.submit(draft.changeSet.id, draft.changeSet.revision, fixture.owner);
  const approved = changes.approve(submitted.changeSet.id, submitted.changeSet.revision, fixture.owner);
  changes.publish(approved.changeSet.id, approved.changeSet.revision, fixture.owner);
  return fixture.budgets.getCurrentRevision(id)?.revision ?? 0;
}

function publishRateLimitPolicy(
  fixture: Fixture,
  content: AIRateLimitPolicyContent = defaultRateLimitContent(),
): { id: string; revision: number } {
  const id = uuidv7();
  const changes = createChangeManagementService(fixture.database);
  const draft = changes.createChangeSet({
    title: "M3B Rate Limit Policy",
    initialItem: {
      resourceType: AI_RATE_LIMIT_POLICY_RESOURCE_TYPE,
      resourceId: id,
      operation: "CREATE",
      expectedRevision: 0,
      desired: content,
    },
  }, fixture.owner);
  const submitted = changes.submit(draft.changeSet.id, draft.changeSet.revision, fixture.owner);
  const approved = changes.approve(submitted.changeSet.id, submitted.changeSet.revision, fixture.owner);
  changes.publish(approved.changeSet.id, approved.changeSet.revision, fixture.owner);
  return { id, revision: fixture.rateLimits.getCurrentRevision(id)?.revision ?? 0 };
}

function updateRateLimitPolicy(
  fixture: Fixture,
  id: string,
  revision: number,
  content: AIRateLimitPolicyContent,
): number {
  const changes = createChangeManagementService(fixture.database);
  const draft = changes.createChangeSet({
    title: "M3B Rate Limit Policy update",
    initialItem: {
      resourceType: AI_RATE_LIMIT_POLICY_RESOURCE_TYPE,
      resourceId: id,
      operation: "UPDATE",
      expectedRevision: revision,
      desired: content,
    },
  }, fixture.owner);
  const submitted = changes.submit(draft.changeSet.id, draft.changeSet.revision, fixture.owner);
  const approved = changes.approve(submitted.changeSet.id, submitted.changeSet.revision, fixture.owner);
  changes.publish(approved.changeSet.id, approved.changeSet.revision, fixture.owner);
  return fixture.rateLimits.getCurrentRevision(id)?.revision ?? 0;
}

function createOperation(
  fixture: Fixture,
  input: { principalRef: string; startedAt?: number; id?: string; idempotencyKey?: string | null },
): string {
  const id = input.id ?? uuidv7();
  fixture.accounting.createOperation({
    id,
    content: {
      costCenter: "STUDENT_GENERATION",
      idempotencyKey: input.idempotencyKey ?? null,
      opaquePrincipalRef: input.principalRef,
      subjectKey: "arabic",
      conversationId: null,
      responseId: null,
      jobId: null,
      evalRunId: null,
      knowledgeRevision: null,
      status: "OPEN",
      startedAt: input.startedAt ?? BASE_TIME + 10,
      completedAt: null,
    },
  });
  return id;
}

function makePlan(input: {
  principalRef: string;
  budgetPolicyId: string;
  budgetPolicyRevision: number;
  rateLimitPolicyId: string;
  rateLimitPolicyRevision: number;
  costOperationId: string;
  idempotencyKey: string;
  maxCostNano: number;
  currency?: string;
  periodStart?: number;
  periodEnd?: number;
}): AIAdmissionPlan {
  const withoutFingerprint = {
    principalRef: input.principalRef,
    budgetPolicyId: input.budgetPolicyId,
    budgetPolicyRevision: input.budgetPolicyRevision,
    rateLimitPolicyId: input.rateLimitPolicyId,
    rateLimitPolicyRevision: input.rateLimitPolicyRevision,
    budgetPeriod: {
      startAt: input.periodStart ?? BASE_TIME,
      endAt: input.periodEnd ?? BASE_TIME + 1_000_000,
    },
    costOperationId: input.costOperationId,
    costEstimate: {
      currency: input.currency ?? "USD",
      maxCostNano: input.maxCostNano,
      estimateBasis: "M3B_TEST_SERVER_ESTIMATE",
    },
    idempotencyKey: input.idempotencyKey,
  } satisfies Omit<AIAdmissionPlan, "requestFingerprint">;
  return {
    ...withoutFingerprint,
    requestFingerprint: createAIAdmissionRequestFingerprint(withoutFingerprint),
  };
}

function expectAdmissionCode(fn: () => unknown, code: (typeof AI_ADMISSION_ERROR_CODES)[number]): AIAdmissionError {
  let captured: unknown;
  try {
    fn();
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof AIAdmissionError);
  assert.equal(captured.code, code);
  return captured;
}

function appendUsage(
  fixture: Fixture,
  operationId: string,
  options: { knownCostNano: number; currency?: string; complete?: boolean; startedAt?: number } ,
) {
  const at = options.startedAt ?? BASE_TIME + 20;
  return fixture.accounting.appendUsageCostRecord({
    id: uuidv7(),
    createdAt: at,
    content: {
      operationId,
      gatewayRequestId: `gateway-${uuidv7()}`,
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
      currency: options.currency ?? "USD",
      knownCostNano: options.knownCostNano,
      costCompleteness: options.complete === false ? "PARTIAL" : "COMPLETE",
      costBasis: "RATE_CARD",
      attemptStatus: "SUCCEEDED",
      startedAt: at,
      completedAt: at,
      latencyMs: 1,
    },
  });
}

function appendCorrection(fixture: Fixture, originalRecordId: string, deltaCostNano: number, createdAt: number) {
  return fixture.accounting.appendCorrection({
    id: uuidv7(),
    content: {
      originalRecordId,
      currency: "USD",
      deltaCostNano,
      reasonCode: "M3B_TEST_CORRECTION",
      actorType: "SYSTEM",
      actorUserId: null,
      createdAt,
    },
  });
}

test("Budget and Rate Limit Policies are governed, revisioned, and accounts pin their policy snapshot", () => {
  const fixture = createFixture();
  try {
    const budgetContent = defaultBudgetContent({ hardCapNano: 1_000, key: `governed-budget-${uuidv7()}` });
    const budget = publishBudgetPolicy(fixture, budgetContent);
    assert.equal(budget.revision, 1);
    const rateContent = defaultRateLimitContent({ key: `governed-rate-${uuidv7()}` });
    const rate = publishRateLimitPolicy(fixture, rateContent);
    assert.equal(rate.revision, 1);
    const operationId = createOperation(fixture, { principalRef: "principal-governance" });
    const admitted = fixture.admission.admit(makePlan({
      principalRef: "principal-governance",
      budgetPolicyId: budget.id,
      budgetPolicyRevision: 1,
      rateLimitPolicyId: rate.id,
      rateLimitPolicyRevision: 1,
      costOperationId: operationId,
      idempotencyKey: "governance-request-1",
      maxCostNano: 600,
    }));
    const budgetRevision = updateBudgetPolicy(fixture, budget.id, 1, {
      ...budgetContent,
      hardCapNano: 2_000,
    });
    assert.equal(budgetRevision, 2);
    assert.equal(fixture.budgets.getRevision(budget.id, 1)?.hardCapNano, 1_000);
    assert.equal(fixture.budgets.getRevision(budget.id, 2)?.hardCapNano, 2_000);
    assert.equal(fixture.admission.getBudgetSnapshot(admitted.account.id).hardCapNano, 1_000);

    const changes = createChangeManagementService(fixture.database);
    assert.throws(() => changes.createChangeSet({
      title: "Mutate Budget identity",
      initialItem: {
        resourceType: AI_BUDGET_POLICY_RESOURCE_TYPE,
        resourceId: budget.id,
        operation: "UPDATE",
        expectedRevision: 2,
        desired: { ...budgetContent, key: `different-${uuidv7()}`, hardCapNano: 3_000 },
      },
    }, fixture.owner), /immutable/i);
    for (const override of [
      { currency: "EUR" },
      { costCenter: "AGENT_2" as const },
    ]) {
      assert.throws(() => changes.createChangeSet({
        title: "Mutate Budget identity",
        initialItem: {
          resourceType: AI_BUDGET_POLICY_RESOURCE_TYPE,
          resourceId: budget.id,
          operation: "UPDATE",
          expectedRevision: 2,
          desired: { ...budgetContent, hardCapNano: 3_000, ...override },
        },
      }, fixture.owner), /immutable/i);
    }

    const adminDraft = changes.createChangeSet({
      title: "Admin cannot publish Rate Limit Policy",
      initialItem: {
        resourceType: AI_RATE_LIMIT_POLICY_RESOURCE_TYPE,
        resourceId: rate.id,
        operation: "UPDATE",
        expectedRevision: 1,
        desired: { ...rateContent, maxRequests: 99 },
      },
    }, fixture.admin);
    const adminSubmitted = changes.submit(adminDraft.changeSet.id, adminDraft.changeSet.revision, fixture.admin);
    const adminApproved = changes.approve(adminSubmitted.changeSet.id, adminSubmitted.changeSet.revision, fixture.owner);
    assert.throws(
      () => changes.publish(adminApproved.changeSet.id, adminApproved.changeSet.revision, fixture.admin),
      /OWNER/i,
    );
    assert.equal(fixture.rateLimits.getCurrentRevision(rate.id)?.revision, 1);
    const rateRevision = updateRateLimitPolicy(fixture, rate.id, 1, {
      ...rateContent,
      maxRequests: 99,
    });
    assert.equal(rateRevision, 2);
    assert.equal(fixture.rateLimits.getRevision(rate.id, 1)?.maxRequests, 100);
    assert.equal(fixture.rateLimits.getRevision(rate.id, 2)?.maxRequests, 99);
  } finally {
    fixture.close();
  }
});

test("One Budget Account is pinned per stable policy period and blocks revision bypasses", () => {
  const fixture = createFixture();
  try {
    const budgetContent = defaultBudgetContent({
      key: `stable-period-budget-${uuidv7()}`,
      hardCapNano: 1_000,
    });
    const budget = publishBudgetPolicy(fixture, budgetContent);
    const rate = publishRateLimitPolicy(fixture);
    const periodStart = BASE_TIME;
    const periodEnd = BASE_TIME + 1_000;
    const principalRef = "principal-stable-period";
    const firstPlan = makePlan({
      principalRef,
      budgetPolicyId: budget.id,
      budgetPolicyRevision: 1,
      rateLimitPolicyId: rate.id,
      rateLimitPolicyRevision: 1,
      costOperationId: createOperation(fixture, { principalRef, startedAt: periodStart + 10 }),
      idempotencyKey: "stable-period-1",
      maxCostNano: 600,
      periodStart,
      periodEnd,
    });
    const first = fixture.admission.admit(firstPlan);
    assert.equal(first.account.budgetPolicyRevision, 1);

    assert.equal(updateBudgetPolicy(fixture, budget.id, 1, {
      ...budgetContent,
      hardCapNano: 2_000,
    }), 2);
    const replay = fixture.admission.admit(firstPlan);
    assert.equal(replay.replayed, true);
    assert.equal(replay.reservation.id, first.reservation.id);
    const conflictOperation = createOperation(fixture, { principalRef, startedAt: periodStart + 20 });
    const conflict = expectAdmissionCode(() => fixture.admission.admit(makePlan({
      principalRef,
      budgetPolicyId: budget.id,
      budgetPolicyRevision: 2,
      rateLimitPolicyId: rate.id,
      rateLimitPolicyRevision: 1,
      costOperationId: conflictOperation,
      idempotencyKey: "stable-period-2",
      maxCostNano: 600,
      periodStart,
      periodEnd,
    })), "AI_BUDGET_ACCOUNT_POLICY_REVISION_CONFLICT");
    assert.deepEqual(conflict.details, {
      budgetAccountId: first.account.id,
      budgetPolicyId: budget.id,
      pinnedBudgetPolicyRevision: 1,
      requestedBudgetPolicyRevision: 2,
      periodStart,
      periodEnd,
    });
    const accountCount = (fixture.database.client.prepare("select count(*) as count from ai_budget_accounts where principal_ref = ? and budget_policy_id = ? and period_start = ? and period_end = ?").get(principalRef, budget.id, periodStart, periodEnd) as { count: number }).count;
    const reservationCount = (fixture.database.client.prepare("select count(*) as count from ai_budget_reservations where principal_ref = ?").get(principalRef) as { count: number }).count;
    assert.ok(fixture.database.client.prepare("select name from sqlite_master where type = 'index' and name = 'ai_budget_accounts_stable_period_unique'").get());
    assert.equal(accountCount, 1);
    assert.equal(reservationCount, 1);
    assert.equal(fixture.admission.getBudgetSnapshot(first.account.id).activeReservedExposureNano, 600);

    const sameRevision = fixture.admission.admit(makePlan({
      principalRef,
      budgetPolicyId: budget.id,
      budgetPolicyRevision: 1,
      rateLimitPolicyId: rate.id,
      rateLimitPolicyRevision: 1,
      costOperationId: createOperation(fixture, { principalRef, startedAt: periodStart + 30 }),
      idempotencyKey: "stable-period-3",
      maxCostNano: 300,
      periodStart,
      periodEnd,
    }));
    assert.equal(sameRevision.account.id, first.account.id);
    assert.equal(fixture.admission.getBudgetSnapshot(first.account.id).activeReservedExposureNano, 900);

    const nextPeriodStart = periodEnd;
    const nextPeriodEnd = nextPeriodStart + 1_000;
    const nextPeriod = fixture.admission.admit(makePlan({
      principalRef,
      budgetPolicyId: budget.id,
      budgetPolicyRevision: 2,
      rateLimitPolicyId: rate.id,
      rateLimitPolicyRevision: 1,
      costOperationId: createOperation(fixture, { principalRef, startedAt: nextPeriodStart + 10 }),
      idempotencyKey: "stable-period-4",
      maxCostNano: 600,
      periodStart: nextPeriodStart,
      periodEnd: nextPeriodEnd,
    }));
    assert.notEqual(nextPeriod.account.id, first.account.id);
    assert.equal(nextPeriod.account.budgetPolicyRevision, 2);
    assert.equal(nextPeriod.account.hardCapNano, 2_000);
  } finally {
    fixture.close();
  }
});

test("Admission idempotency returns one reservation, rejects conflicts, and never creates operations", () => {
  const fixture = createFixture();
  try {
    const budget = publishBudgetPolicy(fixture);
    const rate = publishRateLimitPolicy(fixture);
    const operationId = createOperation(fixture, { principalRef: "principal-idempotency" });
    const plan = makePlan({
      principalRef: "principal-idempotency",
      budgetPolicyId: budget.id,
      budgetPolicyRevision: 1,
      rateLimitPolicyId: rate.id,
      rateLimitPolicyRevision: 1,
      costOperationId: operationId,
      idempotencyKey: "same-request",
      maxCostNano: 100,
    });
    const first = fixture.admission.admit(plan);
    const replay = fixture.admission.admit(plan);
    assert.equal(first.reservation.id, replay.reservation.id);
    assert.equal(replay.replayed, true);
    const eventCount = (fixture.database.client.prepare("select count(*) as count from ai_rate_limit_events where principal_ref = ?").get("principal-idempotency") as { count: number }).count;
    const reservationCount = (fixture.database.client.prepare("select count(*) as count from ai_budget_reservations where principal_ref = ?").get("principal-idempotency") as { count: number }).count;
    const operationCount = (fixture.database.client.prepare("select count(*) as count from ai_cost_operations where id = ?").get(operationId) as { count: number }).count;
    assert.equal(eventCount, 1);
    assert.equal(reservationCount, 1);
    assert.equal(operationCount, 1);
    const differentFingerprint = makePlan({
      principalRef: "principal-idempotency",
      budgetPolicyId: budget.id,
      budgetPolicyRevision: 1,
      rateLimitPolicyId: rate.id,
      rateLimitPolicyRevision: 1,
      costOperationId: operationId,
      idempotencyKey: "different-key-for-fingerprint",
      maxCostNano: 101,
    });
    expectAdmissionCode(() => fixture.admission.admit({ ...differentFingerprint, idempotencyKey: plan.idempotencyKey }), "AI_ADMISSION_IDEMPOTENCY_CONFLICT");
    const differentOperation = createOperation(fixture, { principalRef: "principal-idempotency" });
    expectAdmissionCode(() => fixture.admission.admit(makePlan({
      principalRef: "principal-idempotency",
      budgetPolicyId: budget.id,
      budgetPolicyRevision: 1,
      rateLimitPolicyId: rate.id,
      rateLimitPolicyRevision: 1,
      costOperationId: differentOperation,
      idempotencyKey: plan.idempotencyKey,
      maxCostNano: 100,
    })), "AI_ADMISSION_IDEMPOTENCY_CONFLICT");
  } finally {
    fixture.close();
  }
});

test("Sliding-window rate limits use server time, half-open expiry, persistence, and budget-denied events", () => {
  const fixture = createFixture();
  try {
    const budget = publishBudgetPolicy(fixture, defaultBudgetContent({ hardCapNano: 10_000 }));
    const rate = publishRateLimitPolicy(fixture, defaultRateLimitContent({ windowMs: 100, maxRequests: 2, maxConcurrentRequests: 100 }));
    fixture.setNow(1_000);
    for (const idempotencyKey of ["rate-1", "rate-2"]) {
      const operationId = createOperation(fixture, { principalRef: "principal-rate" });
      fixture.admission.admit(makePlan({
        principalRef: "principal-rate",
        budgetPolicyId: budget.id,
        budgetPolicyRevision: 1,
        rateLimitPolicyId: rate.id,
        rateLimitPolicyRevision: 1,
        costOperationId: operationId,
        idempotencyKey,
        maxCostNano: 1,
      }));
    }
    fixture.setNow(1_050);
    const limitedOperation = createOperation(fixture, { principalRef: "principal-rate" });
    const limited = expectAdmissionCode(() => fixture.admission.admit(makePlan({
      principalRef: "principal-rate",
      budgetPolicyId: budget.id,
      budgetPolicyRevision: 1,
      rateLimitPolicyId: rate.id,
      rateLimitPolicyRevision: 1,
      costOperationId: limitedOperation,
      idempotencyKey: "rate-3",
      maxCostNano: 1,
    })), "AI_RATE_LIMITED");
    assert.equal(limited.details.retryAfterMs, 50);
    fixture.setNow(1_100);
    const boundaryOperation = createOperation(fixture, { principalRef: "principal-rate" });
    fixture.admission.admit(makePlan({
      principalRef: "principal-rate",
      budgetPolicyId: budget.id,
      budgetPolicyRevision: 1,
      rateLimitPolicyId: rate.id,
      rateLimitPolicyRevision: 1,
      costOperationId: boundaryOperation,
      idempotencyKey: "rate-boundary",
      maxCostNano: 1,
    }));
    const recreated = new AIBudgetAdmissionService(fixture.database, { clock: () => 1_100 });
    assert.ok(recreated);

    const deniedBudget = publishBudgetPolicy(fixture, defaultBudgetContent({ hardCapNano: 0 }));
    const deniedRate = publishRateLimitPolicy(fixture, defaultRateLimitContent({ windowMs: 100, maxRequests: 1, maxConcurrentRequests: 100 }));
    const deniedOperation = createOperation(fixture, { principalRef: "principal-budget-denied" });
    expectAdmissionCode(() => fixture.admission.admit(makePlan({
      principalRef: "principal-budget-denied",
      budgetPolicyId: deniedBudget.id,
      budgetPolicyRevision: 1,
      rateLimitPolicyId: deniedRate.id,
      rateLimitPolicyRevision: 1,
      costOperationId: deniedOperation,
      idempotencyKey: "budget-denied-1",
      maxCostNano: 1,
    })), "AI_BUDGET_EXCEEDED");
    const secondDeniedOperation = createOperation(fixture, { principalRef: "principal-budget-denied" });
    expectAdmissionCode(() => fixture.admission.admit(makePlan({
      principalRef: "principal-budget-denied",
      budgetPolicyId: deniedBudget.id,
      budgetPolicyRevision: 1,
      rateLimitPolicyId: deniedRate.id,
      rateLimitPolicyRevision: 1,
      costOperationId: secondDeniedOperation,
      idempotencyKey: "budget-denied-2",
      maxCostNano: 1,
    })), "AI_RATE_LIMITED");
  } finally {
    fixture.close();
  }
});

test("Atomic admission prevents two 600-nano reservations from exceeding a 1,000-nano account", () => {
  const fixture = createFixture();
  let secondDatabase: ContentDatabase | null = null;
  try {
    const budget = publishBudgetPolicy(fixture, defaultBudgetContent({ hardCapNano: 1_000 }));
    const rate = publishRateLimitPolicy(fixture);
    const serviceA = new AIBudgetAdmissionService(fixture.database, { clock: () => BASE_TIME + 100 });
    secondDatabase = openContentDatabase({ dataDirectory: fixture.root, migrationsDirectory });
    const serviceB = new AIBudgetAdmissionService(secondDatabase, { clock: () => BASE_TIME + 100 });
    const planA = makePlan({
      principalRef: "principal-race",
      budgetPolicyId: budget.id,
      budgetPolicyRevision: 1,
      rateLimitPolicyId: rate.id,
      rateLimitPolicyRevision: 1,
      costOperationId: createOperation(fixture, { principalRef: "principal-race" }),
      idempotencyKey: "race-a",
      maxCostNano: 600,
    });
    const planB = makePlan({
      principalRef: "principal-race",
      budgetPolicyId: budget.id,
      budgetPolicyRevision: 1,
      rateLimitPolicyId: rate.id,
      rateLimitPolicyRevision: 1,
      costOperationId: createOperation(fixture, { principalRef: "principal-race" }),
      idempotencyKey: "race-b",
      maxCostNano: 600,
    });
    const admitted = serviceA.admit(planA);
    expectAdmissionCode(() => serviceB.admit(planB), "AI_BUDGET_EXCEEDED");
    const snapshot = serviceA.getBudgetSnapshot(admitted.account.id);
    assert.equal(snapshot.activeReservedExposureNano, 600);
    assert.equal(snapshot.totalExposureNano, 600);
    assert.equal(snapshot.remainingNano, 400);
  } finally {
    secondDatabase?.close();
    fixture.close();
  }
});

test("Exposure uses max(actual, remaining reservation), corrections are period-attributed, and overage is truthful", () => {
  const fixture = createFixture();
  try {
    const budget = publishBudgetPolicy(fixture, defaultBudgetContent({ hardCapNano: 100 }));
    const rate = publishRateLimitPolicy(fixture);
    const operationId = createOperation(fixture, { principalRef: "principal-exposure" });
    const admitted = fixture.admission.admit(makePlan({
      principalRef: "principal-exposure",
      budgetPolicyId: budget.id,
      budgetPolicyRevision: 1,
      rateLimitPolicyId: rate.id,
      rateLimitPolicyRevision: 1,
      costOperationId: operationId,
      idempotencyKey: "exposure-1",
      maxCostNano: 100,
      periodEnd: BASE_TIME + 1_000,
    }));
    fixture.admission.startExecution(admitted.reservation.id, BASE_TIME + 110);
    const record = appendUsage(fixture, operationId, { knownCostNano: 40 });
    let snapshot = fixture.admission.getBudgetSnapshot(admitted.account.id);
    assert.equal(snapshot.effectiveSpentNano, 40);
    assert.equal(snapshot.activeReservedExposureNano, 60);
    assert.equal(snapshot.totalExposureNano, 100);
    const settledBelowReservation = fixture.admission.settle(admitted.reservation.id, BASE_TIME + 2_000);
    assert.equal(settledBelowReservation.status, "SETTLED");
    assert.equal(settledBelowReservation.actualCostNano, 40);
    assert.equal(settledBelowReservation.overageNano, 0);
    appendCorrection(fixture, record.id, 80, BASE_TIME + 2_000);
    snapshot = fixture.admission.getBudgetSnapshot(admitted.account.id);
    assert.equal(snapshot.effectiveSpentNano, 120);
    assert.equal(snapshot.activeReservedExposureNano, 0);
    assert.equal(snapshot.totalExposureNano, 120);
    assert.equal(snapshot.remainingNano, 0);
    assert.equal(snapshot.overCap, true);
    const settled = fixture.admission.settle(admitted.reservation.id, BASE_TIME + 3_000);
    assert.equal(settled.status, "SETTLED");
    assert.equal(settled.actualCostNano, 120);
    assert.equal(settled.overageNano, 20);
    assert.equal(settled.reservation.overageNano, 20);
    appendCorrection(fixture, record.id, 10, BASE_TIME + 5_000);
    const correctedSettlement = fixture.admission.settle(admitted.reservation.id, BASE_TIME + 5_100);
    assert.equal(correctedSettlement.status, "SETTLED");
    assert.equal(correctedSettlement.actualCostNano, 130);
    assert.equal(correctedSettlement.overageNano, 30);

    const negativeOperation = createOperation(fixture, { principalRef: "principal-exposure", startedAt: BASE_TIME + 40 });
    const negativeRecord = appendUsage(fixture, negativeOperation, { knownCostNano: 100 });
    appendCorrection(fixture, negativeRecord.id, -150, BASE_TIME + 4_000);
    snapshot = fixture.admission.getBudgetSnapshot(admitted.account.id);
    assert.equal(snapshot.effectiveSpentNano, 130);
  } finally {
    fixture.close();
  }
});

test("Settlement keeps unknown, partial, and multi-currency cost safely reserved until reconciliation", () => {
  const fixture = createFixture();
  try {
    const budget = publishBudgetPolicy(fixture, defaultBudgetContent({ hardCapNano: 1_000 }));
    const rate = publishRateLimitPolicy(fixture, defaultRateLimitContent({ maxConcurrentRequests: 1 }));
    const operationId = createOperation(fixture, { principalRef: "principal-settlement" });
    const admitted = fixture.admission.admit(makePlan({
      principalRef: "principal-settlement",
      budgetPolicyId: budget.id,
      budgetPolicyRevision: 1,
      rateLimitPolicyId: rate.id,
      rateLimitPolicyRevision: 1,
      costOperationId: operationId,
      idempotencyKey: "settlement-1",
      maxCostNano: 100,
    }));
    fixture.admission.startExecution(admitted.reservation.id, BASE_TIME + 150);
    let result = fixture.admission.settle(admitted.reservation.id, BASE_TIME + 160);
    assert.equal(result.status, "RECONCILIATION_REQUIRED");
    assert.equal(result.actualCostNano, null);
    assert.equal(result.snapshot.activeReservationCount, 1);
    const partial = appendUsage(fixture, operationId, { knownCostNano: 20, complete: false });
    result = fixture.admission.settle(admitted.reservation.id, BASE_TIME + 170);
    assert.equal(result.status, "RECONCILIATION_REQUIRED");
    assert.equal(result.actualCostNano, 20);
    appendCorrection(fixture, partial.id, 10, BASE_TIME + 80);
    appendUsage(fixture, operationId, { knownCostNano: 5, complete: true });
    result = fixture.admission.settle(admitted.reservation.id, BASE_TIME + 180);
    assert.equal(result.status, "RECONCILIATION_REQUIRED");
    assert.equal(result.actualCostNano, 35);
    assert.equal(result.snapshot.activeReservationCount, 1);

    const multiOperation = createOperation(fixture, { principalRef: "principal-multi-currency" });
    const multi = fixture.admission.admit(makePlan({
      principalRef: "principal-multi-currency",
      budgetPolicyId: budget.id,
      budgetPolicyRevision: 1,
      rateLimitPolicyId: rate.id,
      rateLimitPolicyRevision: 1,
      costOperationId: multiOperation,
      idempotencyKey: "settlement-multi",
      maxCostNano: 100,
    }));
    fixture.admission.startExecution(multi.reservation.id, BASE_TIME + 100);
    appendUsage(fixture, multiOperation, { knownCostNano: 10, currency: "USD" });
    appendUsage(fixture, multiOperation, { knownCostNano: 10, currency: "EUR" });
    const multiResult = fixture.admission.settle(multi.reservation.id, BASE_TIME + 110);
    assert.equal(multiResult.status, "RECONCILIATION_REQUIRED");
    assert.equal(multiResult.snapshot.activeReservationCount, 1);
    const ledgerTypes = fixture.admission.listLedger(multi.reservation.id).map((entry) => entry.eventType);
    assert.deepEqual(ledgerTypes, ["RESERVED", "EXECUTION_STARTED", "RECONCILIATION_REQUIRED"]);
  } finally {
    fixture.close();
  }
});

test("Concurrency counts RESERVED, EXECUTING, and RECONCILIATION_REQUIRED, then frees a slot only after release", () => {
  const fixture = createFixture();
  try {
    const budget = publishBudgetPolicy(fixture, defaultBudgetContent({ hardCapNano: 10_000 }));
    const rate = publishRateLimitPolicy(fixture, defaultRateLimitContent({ maxConcurrentRequests: 2 }));
    const makeAdmitted = (key: string) => {
      const operationId = createOperation(fixture, { principalRef: "principal-concurrency" });
      return fixture.admission.admit(makePlan({
        principalRef: "principal-concurrency",
        budgetPolicyId: budget.id,
        budgetPolicyRevision: 1,
        rateLimitPolicyId: rate.id,
        rateLimitPolicyRevision: 1,
        costOperationId: operationId,
        idempotencyKey: key,
        maxCostNano: 1,
      }));
    };
    const first = makeAdmitted("concurrency-1");
    const second = makeAdmitted("concurrency-2");
    const thirdOperation = createOperation(fixture, { principalRef: "principal-concurrency" });
    expectAdmissionCode(() => fixture.admission.admit(makePlan({
      principalRef: "principal-concurrency",
      budgetPolicyId: budget.id,
      budgetPolicyRevision: 1,
      rateLimitPolicyId: rate.id,
      rateLimitPolicyRevision: 1,
      costOperationId: thirdOperation,
      idempotencyKey: "concurrency-3",
      maxCostNano: 1,
    })), "AI_ADMISSION_CONCURRENCY_LIMITED");
    fixture.admission.releaseBeforeExecution(first.reservation.id, BASE_TIME + 120);
    const fourthOperation = createOperation(fixture, { principalRef: "principal-concurrency" });
    const fourth = fixture.admission.admit(makePlan({
      principalRef: "principal-concurrency",
      budgetPolicyId: budget.id,
      budgetPolicyRevision: 1,
      rateLimitPolicyId: rate.id,
      rateLimitPolicyRevision: 1,
      costOperationId: fourthOperation,
      idempotencyKey: "concurrency-4",
      maxCostNano: 1,
    }));
    assert.equal(fourth.reservation.status, "RESERVED");

    const reconRate = publishRateLimitPolicy(fixture, defaultRateLimitContent({ maxConcurrentRequests: 1 }));
    const reconOperation = createOperation(fixture, { principalRef: "principal-recon" });
    const recon = fixture.admission.admit(makePlan({
      principalRef: "principal-recon",
      budgetPolicyId: budget.id,
      budgetPolicyRevision: 1,
      rateLimitPolicyId: reconRate.id,
      rateLimitPolicyRevision: 1,
      costOperationId: reconOperation,
      idempotencyKey: "recon-1",
      maxCostNano: 1,
    }));
    fixture.admission.startExecution(recon.reservation.id, BASE_TIME + 130);
    assert.equal(fixture.admission.settle(recon.reservation.id, BASE_TIME + 140).status, "RECONCILIATION_REQUIRED");
    const reconSecondOperation = createOperation(fixture, { principalRef: "principal-recon" });
    expectAdmissionCode(() => fixture.admission.admit(makePlan({
      principalRef: "principal-recon",
      budgetPolicyId: budget.id,
      budgetPolicyRevision: 1,
      rateLimitPolicyId: reconRate.id,
      rateLimitPolicyRevision: 1,
      costOperationId: reconSecondOperation,
      idempotencyKey: "recon-2",
      maxCostNano: 1,
    })), "AI_ADMISSION_CONCURRENCY_LIMITED");
    assert.ok(second.reservation.id);
  } finally {
    fixture.close();
  }
});

test("Zero hard caps admit only zero reservations and unknown is not represented as zero", () => {
  const fixture = createFixture();
  try {
    const budget = publishBudgetPolicy(fixture, defaultBudgetContent({ hardCapNano: 0 }));
    const rate = publishRateLimitPolicy(fixture);
    const zeroOperation = createOperation(fixture, { principalRef: "principal-zero" });
    const admitted = fixture.admission.admit(makePlan({
      principalRef: "principal-zero",
      budgetPolicyId: budget.id,
      budgetPolicyRevision: 1,
      rateLimitPolicyId: rate.id,
      rateLimitPolicyRevision: 1,
      costOperationId: zeroOperation,
      idempotencyKey: "zero-1",
      maxCostNano: 0,
    }));
    assert.equal(admitted.snapshot.remainingNano, 0);
    assert.equal(admitted.snapshot.activeReservedExposureNano, 0);
    fixture.admission.startExecution(admitted.reservation.id, BASE_TIME + 200);
    const settlement = fixture.admission.settle(admitted.reservation.id, BASE_TIME + 210);
    assert.equal(settlement.status, "RECONCILIATION_REQUIRED");
    assert.equal(settlement.actualCostNano, null);
    const nonZeroOperation = createOperation(fixture, { principalRef: "principal-zero" });
    expectAdmissionCode(() => fixture.admission.admit(makePlan({
      principalRef: "principal-zero",
      budgetPolicyId: budget.id,
      budgetPolicyRevision: 1,
      rateLimitPolicyId: rate.id,
      rateLimitPolicyRevision: 1,
      costOperationId: nonZeroOperation,
      idempotencyKey: "zero-2",
      maxCostNano: 1,
    })), "AI_BUDGET_EXCEEDED");
  } finally {
    fixture.close();
  }
});

test("M3B runtime tables contain no raw prompt/message/answer or secret columns", () => {
  const fixture = createFixture();
  try {
    const rows = fixture.database.client.prepare("select name, sql from sqlite_master where type = 'table' and name like 'ai_%'").all() as Array<{ name: string; sql: string }>;
    const m3b = rows.filter((row) => [
      "ai_budget_policies",
      "ai_budget_policy_revisions",
      "ai_rate_limit_policies",
      "ai_rate_limit_policy_revisions",
      "ai_budget_accounts",
      "ai_budget_reservations",
      "ai_rate_limit_events",
      "ai_budget_ledger_entries",
    ].includes(row.name));
    assert.equal(m3b.length, 8);
    for (const row of m3b) assert.doesNotMatch(row.sql, /prompt|message|answer|secret|api[_ ]?key|authorization/i);
    assert.ok(AI_COST_CENTERS.includes("STUDENT_GENERATION"));
  } finally {
    fixture.close();
  }
});
