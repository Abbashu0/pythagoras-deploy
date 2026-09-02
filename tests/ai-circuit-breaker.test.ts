import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../src/server/admin-auth";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import {
  AICircuitBreakerError,
  AICircuitBreakerService,
  AI_CIRCUIT_BREAKER_POLICY_RESOURCE_TYPE,
  AIProviderAdapterError,
  AIProviderGateway,
  AIProviderGatewayError,
  ProviderAdapterRegistry,
  SQLiteAICircuitBreakerPolicyRepository,
  SQLiteAIProviderConfigRepository,
  SQLiteAIModelConfigRepository,
  AI_PROVIDER_ATTEMPT_STATUSES,
  type AICircuitAttemptPermit,
  type AICircuitTarget,
  type EmbeddingProviderAdapter,
  type EmbeddingProviderRequest,
  type EmbeddingProviderResult,
  type GenerationProviderAdapter,
  type GenerationProviderRequest,
  type GatewayGenerationStreamEvent,
  type NormalizedProviderUsage,
  type ProviderAdapterExecutionContext,
  type ProviderGenerationStreamEvent,
  type RerankerProviderAdapter,
  type RerankProviderRequest,
  type RerankProviderResult,
} from "../src/server/ai";
import {
  AI_SECRET_KEY_BYTES,
  createLocalAISecretStore,
  type LocalEncryptedAISecretStore,
} from "../src/server/ai/secrets";
import { createChangeManagementService } from "../src/server/change-management";
import {
  aiModelConfigs,
  aiProviderConfigs,
} from "../src/server/content/schema";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const BASE_TIME = 1_901_000_000_000;
const TEST_MASTER_KEY = Buffer.alloc(AI_SECRET_KEY_BYTES, 0x4d);

interface Fixture {
  root: string;
  database: ContentDatabase;
  owner: AdminActor;
  admin: AdminActor;
  secrets: LocalEncryptedAISecretStore;
  policies: SQLiteAICircuitBreakerPolicyRepository;
  providers: SQLiteAIProviderConfigRepository;
  models: SQLiteAIModelConfigRepository;
  changes: ReturnType<typeof createChangeManagementService>;
  circuit: AICircuitBreakerService;
  policyId: string;
  setNow(value: number): void;
  close(): void;
}

interface Route {
  providerConfigId: string;
  providerConfigRevision: number;
  modelConfigId: string;
  modelConfigRevision: number;
  adapterKey: string;
  capability: "GENERATION" | "EMBEDDING" | "RERANK";
  secretVersion: number;
  credentialRef: string;
}

function createFixture(policyOverrides: Partial<{
  failureThreshold: number;
  openDurationMs: number;
  halfOpenProbeLeaseMs: number;
  enabled: boolean;
}> = {}): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-circuit-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  const identities = new SQLiteAdminIdentityRepository(database);
  const ownerUser = identities.createInitialOwner({
    id: uuidv7(),
    email: `owner-${uuidv7()}@ai-circuit.test`,
    displayName: "AI Circuit Owner",
    passwordHash: "fixture-only",
    createdAt: BASE_TIME,
  });
  const adminUser = identities.createAdmin({
    id: uuidv7(),
    email: `admin-${uuidv7()}@ai-circuit.test`,
    displayName: "AI Circuit Admin",
    passwordHash: "fixture-only",
    createdAt: BASE_TIME + 1,
  });
  const owner: AdminActor = { actorUserId: ownerUser.id, actorRole: "OWNER" };
  const admin: AdminActor = { actorUserId: adminUser.id, actorRole: "ADMIN" };
  let now = BASE_TIME + 100;
  const secrets = createLocalAISecretStore(database, {
    masterKey: TEST_MASTER_KEY,
    clock: () => now++,
  });
  const policies = new SQLiteAICircuitBreakerPolicyRepository(database);
  const policyId = uuidv7();
  policies.create({
    id: policyId,
    actor: owner,
    now: BASE_TIME,
    content: {
      key: `circuit-policy-${uuidv7()}`,
      displayName: "Circuit fixture policy",
      failureThreshold: 3,
      openDurationMs: 1_000,
      halfOpenProbeLeaseMs: 100,
      enabled: true,
      ...policyOverrides,
    },
  });
  return {
    root,
    database,
    owner,
    admin,
    secrets,
    policies,
    providers: new SQLiteAIProviderConfigRepository(database),
    models: new SQLiteAIModelConfigRepository(database),
    changes: createChangeManagementService(database),
    circuit: new AICircuitBreakerService(database, {
      policyRepository: policies,
      clock: () => now,
      probeOwnerFactory: () => `probe-owner-${uuidv7()}`,
      probeTokenFactory: () => `probe-token-${uuidv7()}`,
    }),
    policyId,
    setNow(value: number) {
      now = value;
    },
    close() {
      database.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
    },
  };
}

async function createRoute(fixture: Fixture, capability: Route["capability"], adapterKey: string): Promise<Route> {
  const secret = await fixture.secrets.create({
    secret: `fixture-secret-${uuidv7()}-${"x".repeat(48)}`,
    actor: { type: "ADMIN", actorUserId: fixture.owner.actorUserId },
  });
  const providerConfigId = uuidv7();
  fixture.database.db.insert(aiProviderConfigs).values({
    id: providerConfigId,
    key: `circuit-provider-${uuidv7()}`,
    displayName: "Circuit fixture provider",
    baseUrl: "https://provider.example/v1",
    credentialRef: secret.credentialRef,
    enabled: true,
    retentionPolicy: "UNKNOWN",
    trainingPolicy: "UNKNOWN",
    zdrSupported: false,
    zdrRequired: false,
    createdAt: BASE_TIME + 10,
    updatedAt: BASE_TIME + 10,
    createdBy: fixture.owner.actorUserId,
    updatedBy: fixture.owner.actorUserId,
    revision: 1,
  }).run();
  const modelConfigId = uuidv7();
  fixture.database.db.insert(aiModelConfigs).values({
    id: modelConfigId,
    key: `circuit-model-${uuidv7()}`,
    displayName: "Circuit fixture model",
    providerConfigId,
    providerModelId: `fixture-model-${uuidv7()}`,
    capability,
    adapterKey,
    enabled: true,
    contextWindowTokens: capability === "GENERATION" ? 4_096 : null,
    maxOutputTokens: capability === "GENERATION" ? 512 : null,
    embeddingDimensions: capability === "EMBEDDING" ? 3 : null,
    supportsStreaming: capability === "GENERATION",
    supportsReasoning: false,
    supportsStructuredOutput: false,
    createdAt: BASE_TIME + 20,
    updatedAt: BASE_TIME + 20,
    createdBy: fixture.owner.actorUserId,
    updatedBy: fixture.owner.actorUserId,
    revision: 1,
  }).run();
  return {
    providerConfigId,
    providerConfigRevision: 1,
    modelConfigId,
    modelConfigRevision: 1,
    adapterKey,
    capability,
    secretVersion: secret.secretVersion,
    credentialRef: secret.credentialRef,
  };
}

function target(fixture: Fixture, route: Route, secretVersion = route.secretVersion): AICircuitTarget {
  return {
    policyId: fixture.policyId,
    policyRevision: 1,
    modelConfigId: route.modelConfigId,
    modelConfigRevision: route.modelConfigRevision,
    providerConfigId: route.providerConfigId,
    providerConfigRevision: route.providerConfigRevision,
    capability: route.capability,
    adapterKey: route.adapterKey,
    secretVersion,
  };
}

function granted(fixture: Fixture, route: Route, at: number, secretVersion?: number): AICircuitAttemptPermit {
  const decision = fixture.circuit.acquirePermit({ target: target(fixture, route, secretVersion), at });
  assert.equal(decision.kind, "GRANTED");
  return decision.permit;
}

function openCircuit(fixture: Fixture, route: Route, at: number, errorCode: "AUTHENTICATION" | "UNAVAILABLE" = "AUTHENTICATION"): void {
  const permit = granted(fixture, route, at);
  assert.equal(fixture.circuit.recordFailure({ permit, errorCode, at }), "APPLIED");
  if (errorCode === "UNAVAILABLE") {
    const second = granted(fixture, route, at + 1);
    assert.equal(fixture.circuit.recordFailure({ permit: second, errorCode, at: at + 1 }), "APPLIED");
    const third = granted(fixture, route, at + 2);
    assert.equal(fixture.circuit.recordFailure({ permit: third, errorCode, at: at + 2 }), "APPLIED");
  }
}

function emptyUsage(): NormalizedProviderUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    cacheHitInputTokens: null,
    cacheMissInputTokens: null,
  };
}

async function collect(stream: { events: AsyncIterable<GatewayGenerationStreamEvent> }): Promise<GatewayGenerationStreamEvent[]> {
  const events: GatewayGenerationStreamEvent[] = [];
  for await (const event of stream.events) events.push(event);
  return events;
}

function generationRequest() {
  return {
    requestId: `gateway-${uuidv7()}`,
    messages: [{ role: "user" as const, content: "اختبار" }],
    stream: true as const,
  };
}

function createGateway(
  fixture: Fixture,
  adapters: readonly (GenerationProviderAdapter | EmbeddingProviderAdapter | RerankerProviderAdapter)[],
): AIProviderGateway {
  return new AIProviderGateway({
    providerConfigs: fixture.providers,
    modelConfigs: fixture.models,
    secrets: fixture.secrets,
    adapters: new ProviderAdapterRegistry(adapters),
    circuitBreaker: fixture.circuit,
  });
}

class FakeGenerationAdapter implements GenerationProviderAdapter {
  readonly capability = "GENERATION" as const;
  calls = 0;

  constructor(
    readonly adapterKey: string,
    private readonly behavior: (context: ProviderAdapterExecutionContext) => AsyncIterable<ProviderGenerationStreamEvent>,
  ) {}

  generate(_request: GenerationProviderRequest, context: ProviderAdapterExecutionContext): AsyncIterable<ProviderGenerationStreamEvent> {
    this.calls += 1;
    return this.behavior(context);
  }
}

class FakeEmbeddingAdapter implements EmbeddingProviderAdapter {
  readonly capability = "EMBEDDING" as const;
  calls = 0;

  constructor(readonly adapterKey: string) {}

  embed(_request: EmbeddingProviderRequest, _context: ProviderAdapterExecutionContext): Promise<EmbeddingProviderResult> {
    this.calls += 1;
    return Promise.resolve({ vectors: [[1, 0, 0]], dimensions: 3, usage: emptyUsage(), providerRequestId: "embedding-provider-request" });
  }
}

class FakeRerankerAdapter implements RerankerProviderAdapter {
  readonly capability = "RERANK" as const;
  calls = 0;

  constructor(readonly adapterKey: string) {}

  rerank(request: RerankProviderRequest, _context: ProviderAdapterExecutionContext): Promise<RerankProviderResult> {
    this.calls += 1;
    return Promise.resolve({
      results: [{ candidateId: request.candidates[0]!.id, score: 1, rank: 1 }],
      usage: emptyUsage(),
      providerRequestId: "rerank-provider-request",
    });
  }
}

test("Circuit Breaker Policy is governed, revisioned, and approval alone does not publish", () => {
  const fixture = createFixture();
  try {
    const policyId = uuidv7();
    const desired = {
      key: `governed-circuit-${uuidv7()}`,
      displayName: "Governed Circuit Policy",
      failureThreshold: 4,
      openDurationMs: 2_000,
      halfOpenProbeLeaseMs: 250,
      enabled: true,
    };
    const draft = fixture.changes.createChangeSet({
      title: "Circuit policy governance fixture",
      initialItem: {
        resourceType: AI_CIRCUIT_BREAKER_POLICY_RESOURCE_TYPE,
        resourceId: policyId,
        operation: "CREATE",
        expectedRevision: 0,
        desired,
      },
    }, fixture.owner);
    const submitted = fixture.changes.submit(draft.changeSet.id, draft.changeSet.revision, fixture.owner);
    const approved = fixture.changes.approve(submitted.changeSet.id, submitted.changeSet.revision, fixture.owner);
    assert.equal(new SQLiteAICircuitBreakerPolicyRepository(fixture.database).getById(policyId), null);
    assert.throws(() => fixture.changes.publish(approved.changeSet.id, approved.changeSet.revision, fixture.admin), /OWNER|authorization/i);
    fixture.changes.publish(approved.changeSet.id, approved.changeSet.revision, fixture.owner);
    const policies = new SQLiteAICircuitBreakerPolicyRepository(fixture.database);
    assert.equal(policies.getCurrentRevision(policyId)?.revision, 1);

    const update = fixture.changes.createChangeSet({
      title: "Circuit policy revision fixture",
      initialItem: {
        resourceType: AI_CIRCUIT_BREAKER_POLICY_RESOURCE_TYPE,
        resourceId: policyId,
        operation: "UPDATE",
        expectedRevision: 1,
        desired: { ...desired, failureThreshold: 5 },
      },
    }, fixture.owner);
    const updateSubmitted = fixture.changes.submit(update.changeSet.id, update.changeSet.revision, fixture.owner);
    const updateApproved = fixture.changes.approve(updateSubmitted.changeSet.id, updateSubmitted.changeSet.revision, fixture.owner);
    assert.equal(policies.getCurrentRevision(policyId)?.revision, 1);
    fixture.changes.publish(updateApproved.changeSet.id, updateApproved.changeSet.revision, fixture.owner);
    assert.equal(policies.getCurrentRevision(policyId)?.revision, 2);
    assert.equal(policies.listRevisions().filter((revision) => revision.circuitPolicyId === policyId).length, 2);
  } finally {
    fixture.close();
  }
});

test("Circuit lifecycle uses durable state, threshold opening, single half-open probe, and fenced outcomes", async () => {
  const fixture = createFixture();
  let secondDatabase: ContentDatabase | null = null;
  try {
    const route = await createRoute(fixture, "GENERATION", "test.circuit.lifecycle");
    const first = granted(fixture, route, BASE_TIME + 100);
    assert.equal(fixture.circuit.recordFailure({ permit: first, errorCode: "UNAVAILABLE", at: BASE_TIME + 100 }), "APPLIED");
    const second = granted(fixture, route, BASE_TIME + 101);
    assert.equal(fixture.circuit.recordFailure({ permit: second, errorCode: "UNAVAILABLE", at: BASE_TIME + 101 }), "APPLIED");
    const third = granted(fixture, route, BASE_TIME + 102);
    assert.equal(fixture.circuit.recordFailure({ permit: third, errorCode: "UNAVAILABLE", at: BASE_TIME + 102 }), "APPLIED");
    const opened = fixture.circuit.getSnapshot(target(fixture, route));
    assert.equal(opened?.state, "OPEN");
    assert.equal(opened?.consecutiveFailures, 3);
    assert.equal(opened?.stateGeneration, 2);

    const beforeCooldown = fixture.circuit.acquirePermit({ target: target(fixture, route), at: BASE_TIME + 1_101 });
    assert.deepEqual(beforeCooldown, {
      kind: "DENIED",
      reason: "OPEN",
      targetHash: opened!.targetHash,
      stateGeneration: 2,
    });
    secondDatabase = openContentDatabase({ dataDirectory: fixture.root, migrationsDirectory });
    const secondCircuit = new AICircuitBreakerService(secondDatabase, {
      policyRepository: new SQLiteAICircuitBreakerPolicyRepository(secondDatabase),
      clock: () => BASE_TIME + 1_102,
      probeOwnerFactory: () => `second-owner-${uuidv7()}`,
      probeTokenFactory: () => `second-token-${uuidv7()}`,
    });
    const probeA = fixture.circuit.acquirePermit({ target: target(fixture, route), at: BASE_TIME + 1_102 });
    const probeB = secondCircuit.acquirePermit({ target: target(fixture, route), at: BASE_TIME + 1_102 });
    assert.equal(probeA.kind, "GRANTED");
    assert.equal(probeA.permit.mode, "PROBE");
    assert.deepEqual(probeB, {
      kind: "DENIED",
      reason: "HALF_OPEN_BUSY",
      targetHash: opened!.targetHash,
      stateGeneration: 3,
    });
    assert.equal(fixture.circuit.recordSuccess(probeA.permit, BASE_TIME + 1_103), "APPLIED");
    assert.equal(fixture.circuit.getSnapshot(target(fixture, route))?.state, "CLOSED");

    const late = granted(fixture, route, BASE_TIME + 2_000);
    const currentA = granted(fixture, route, BASE_TIME + 2_001);
    const currentB = granted(fixture, route, BASE_TIME + 2_002);
    const currentC = granted(fixture, route, BASE_TIME + 2_003);
    assert.equal(fixture.circuit.recordFailure({ permit: currentA, errorCode: "UNAVAILABLE", at: BASE_TIME + 2_001 }), "APPLIED");
    assert.equal(fixture.circuit.recordFailure({ permit: currentB, errorCode: "UNAVAILABLE", at: BASE_TIME + 2_002 }), "APPLIED");
    assert.equal(fixture.circuit.recordFailure({ permit: currentC, errorCode: "UNAVAILABLE", at: BASE_TIME + 2_003 }), "APPLIED");
    assert.equal(fixture.circuit.recordSuccess(late, BASE_TIME + 2_004), "STALE_OUTCOME_IGNORED");
    assert.equal(fixture.circuit.getSnapshot(target(fixture, route))?.state, "OPEN");

    const probeOne = fixture.circuit.acquirePermit({ target: target(fixture, route), at: BASE_TIME + 3_004 });
    assert.equal(probeOne.kind, "GRANTED");
    const probeTwo = fixture.circuit.acquirePermit({ target: target(fixture, route), at: BASE_TIME + 3_104 });
    assert.equal(probeTwo.kind, "GRANTED");
    assert.equal(probeTwo.permit.mode, "PROBE");
    assert.equal(fixture.circuit.recordSuccess(probeOne.permit, BASE_TIME + 3_105), "STALE_OUTCOME_IGNORED");
    assert.equal(fixture.circuit.getSnapshot(target(fixture, route))?.state, "HALF_OPEN");
    assert.equal(fixture.circuit.recordSuccess(probeTwo.permit, BASE_TIME + 3_106), "APPLIED");
  } finally {
    secondDatabase?.close();
    fixture.close();
  }
});

test("Authentication opens immediately, neutral probe outcomes relinquish ownership, and secret rotation isolates state", async () => {
  const fixture = createFixture({ failureThreshold: 5 });
  try {
    const route = await createRoute(fixture, "GENERATION", "test.circuit.authentication");
    const originalTarget = target(fixture, route);
    const permit = granted(fixture, route, BASE_TIME + 200);
    assert.equal(fixture.circuit.recordFailure({ permit, errorCode: "AUTHENTICATION", at: BASE_TIME + 200 }), "APPLIED");
    const opened = fixture.circuit.getSnapshot(originalTarget);
    assert.equal(opened?.state, "OPEN");
    assert.equal(opened?.consecutiveFailures, 1);
    assert.equal(opened?.lastErrorCode, "AUTHENTICATION");

    const probe = fixture.circuit.acquirePermit({ target: originalTarget, at: BASE_TIME + 1_200 });
    assert.equal(probe.kind, "GRANTED");
    assert.equal(fixture.circuit.recordNeutral(probe.permit, BASE_TIME + 1_201), "APPLIED");
    const neutralState = fixture.circuit.getSnapshot(originalTarget);
    assert.equal(neutralState?.state, "OPEN");
    assert.equal(neutralState?.consecutiveFailures, 1);
    const retryProbe = fixture.circuit.acquirePermit({ target: originalTarget, at: BASE_TIME + 1_201 });
    assert.equal(retryProbe.kind, "GRANTED");
    assert.equal(retryProbe.permit.mode, "PROBE");

    const gatewayRoute = await createRoute(fixture, "GENERATION", "test.circuit.authentication-gateway");
    const gatewayAuthentication = new FakeGenerationAdapter(gatewayRoute.adapterKey, async function* () {
      throw new AIProviderAdapterError("AUTHENTICATION");
    });
    const authenticationGateway = createGateway(fixture, [gatewayAuthentication]);
    const authenticationStream = authenticationGateway.generate({ capability: "GENERATION", attempts: [gatewayRoute.modelConfigId] }, generationRequest(), {
      circuitPolicy: { policyId: fixture.policyId, policyRevision: 1 },
    });
    await assert.rejects(() => collect(authenticationStream), (error: unknown) => error instanceof AIProviderGatewayError && error.code === "AUTHENTICATION");
    assert.equal(gatewayAuthentication.calls, 1);
    assert.equal(fixture.circuit.getSnapshot(target(fixture, gatewayRoute))?.state, "OPEN");

    const rotated = await fixture.secrets.rotate({
      credentialRef: route.credentialRef,
      secret: `rotated-fixture-secret-${uuidv7()}-${"y".repeat(48)}`,
      actor: { type: "ADMIN", actorUserId: fixture.owner.actorUserId },
    });
    assert.equal(rotated.secretVersion, 2);
    const rotatedTarget = target(fixture, route, rotated.secretVersion);
    const rotatedPermit = fixture.circuit.acquirePermit({ target: rotatedTarget, at: BASE_TIME + 1_300 });
    assert.equal(rotatedPermit.kind, "GRANTED");
    assert.equal(rotatedPermit.permit.mode, "NORMAL");
    assert.equal(fixture.circuit.getSnapshot(rotatedTarget)?.state, "CLOSED");
    assert.notEqual(fixture.circuit.getSnapshot(originalTarget)?.targetHash, fixture.circuit.getSnapshot(rotatedTarget)?.targetHash);
  } finally {
    fixture.close();
  }
});

test("Circuit snapshots and events are safe operational views and persist across a new service instance", async () => {
  const fixture = createFixture();
  let reopened: AICircuitBreakerService | null = null;
  let secondDatabase: ContentDatabase | null = null;
  try {
    const route = await createRoute(fixture, "GENERATION", "test.circuit.persistence");
    const circuitTarget = target(fixture, route);
    openCircuit(fixture, route, BASE_TIME + 300);
    const snapshot = fixture.circuit.getSnapshot(circuitTarget);
    assert.ok(snapshot);
    assert.equal("probeToken" in snapshot, false);
    assert.equal("probeOwner" in snapshot, false);
    assert.equal(JSON.stringify(snapshot).includes("TOP_SECRET_STUDENT_PROMPT"), false);
    const events = fixture.circuit.listRecentEvents({ providerConfigId: route.providerConfigId });
    assert.ok(events.length >= 1);
    assert.equal(JSON.stringify(events).includes("TOP_SECRET_STUDENT_PROMPT"), false);

    secondDatabase = openContentDatabase({ dataDirectory: fixture.root, migrationsDirectory });
    reopened = new AICircuitBreakerService(secondDatabase, {
      policyRepository: new SQLiteAICircuitBreakerPolicyRepository(secondDatabase),
      clock: () => BASE_TIME + 301,
    });
    assert.equal(reopened.getSnapshot(circuitTarget)?.state, "OPEN");
    assert.equal(reopened.listOpenCircuits({ modelConfigId: route.modelConfigId }).length, 1);
    assert.equal(reopened.listHalfOpenCircuits().length, 0);
  } finally {
    secondDatabase?.close();
    fixture.close();
  }
});

test("Gateway gates Generation, Embedding, and Rerank without invoking open routes", async () => {
  const fixture = createFixture({ failureThreshold: 1 });
  try {
    const generationRoute = await createRoute(fixture, "GENERATION", "test.circuit.gateway-generation");
    const embeddingRoute = await createRoute(fixture, "EMBEDDING", "test.circuit.gateway-embedding");
    const rerankRoute = await createRoute(fixture, "RERANK", "test.circuit.gateway-rerank");
    const generation = new FakeGenerationAdapter(generationRoute.adapterKey, async function* () {
      yield { type: "STARTED" };
      yield { type: "COMPLETED", finishReason: "STOP", usage: emptyUsage() };
    });
    const embedding = new FakeEmbeddingAdapter(embeddingRoute.adapterKey);
    const reranker = new FakeRerankerAdapter(rerankRoute.adapterKey);
    const gateway = createGateway(fixture, [generation, embedding, reranker]);
    openCircuit(fixture, generationRoute, BASE_TIME + 400);
    openCircuit(fixture, embeddingRoute, BASE_TIME + 400);
    openCircuit(fixture, rerankRoute, BASE_TIME + 400);
    const options = { circuitPolicy: { policyId: fixture.policyId, policyRevision: 1 } };

    const generationStream = gateway.generate({ capability: "GENERATION", attempts: [generationRoute.modelConfigId] }, generationRequest(), options);
    await assert.rejects(() => collect(generationStream), (error: unknown) => error instanceof AIProviderGatewayError && error.code === "CIRCUIT_OPEN");
    const generationTrace = await generationStream.trace;
    assert.equal(generation.calls, 0);
    assert.equal(generationTrace[0]?.status, "SKIPPED");
    assert.equal(generationTrace[0]?.providerInvoked, false);
    assert.equal(generationTrace[0]?.errorCode, "CIRCUIT_OPEN");
    assert.equal(generationTrace[0]?.providerRequestId, undefined);

    await assert.rejects(() => gateway.embed({ capability: "EMBEDDING", attempts: [embeddingRoute.modelConfigId] }, {
      requestId: "embedding-request",
      inputs: ["نص"],
      inputType: "QUERY",
    }, options), (error: unknown) => {
      return error instanceof AIProviderGatewayError && error.code === "CIRCUIT_OPEN" && error.attempts[0]?.providerInvoked === false;
    });
    await assert.rejects(() => gateway.rerank({ capability: "RERANK", attempts: [rerankRoute.modelConfigId] }, {
      requestId: "rerank-request",
      query: "سؤال",
      candidates: [{ id: "candidate-1", text: "إجابة" }],
      topK: 1,
    }, options), (error: unknown) => {
      return error instanceof AIProviderGatewayError && error.code === "CIRCUIT_OPEN" && error.attempts[0]?.providerInvoked === false;
    });
    assert.equal(embedding.calls, 0);
    assert.equal(reranker.calls, 0);
  } finally {
    fixture.close();
  }
});

test("Circuit-aware Generation fallback skips the primary and preserves one Product stream", async () => {
  const fixture = createFixture({ failureThreshold: 1 });
  try {
    const primaryRoute = await createRoute(fixture, "GENERATION", "test.circuit.gateway-primary");
    const fallbackRoute = await createRoute(fixture, "GENERATION", "test.circuit.gateway-fallback");
    const primary = new FakeGenerationAdapter(primaryRoute.adapterKey, async function* () {
      yield { type: "STARTED", providerRequestId: "must-not-be-used" };
      yield { type: "COMPLETED", finishReason: "STOP", usage: emptyUsage() };
    });
    const fallback = new FakeGenerationAdapter(fallbackRoute.adapterKey, async function* () {
      yield { type: "STARTED", providerRequestId: "fallback-request" };
      yield { type: "TEXT_DELTA", text: "الجواب" };
      yield { type: "COMPLETED", finishReason: "STOP", usage: emptyUsage(), providerRequestId: "fallback-request" };
    });
    openCircuit(fixture, primaryRoute, BASE_TIME + 500);
    const gateway = createGateway(fixture, [primary, fallback]);
    const stream = gateway.generate({ capability: "GENERATION", attempts: [primaryRoute.modelConfigId, fallbackRoute.modelConfigId] }, generationRequest(), {
      circuitPolicy: { policyId: fixture.policyId, policyRevision: 1 },
    });
    assert.deepEqual(await collect(stream), [
      { type: "STARTED" },
      { type: "TEXT_DELTA", text: "الجواب" },
      { type: "COMPLETED", finishReason: "STOP", usage: emptyUsage() },
    ]);
    const traces = await stream.trace;
    assert.deepEqual(traces.map((trace) => [trace.status, trace.providerInvoked, trace.errorCode]), [
      ["SKIPPED", false, "CIRCUIT_OPEN"],
      ["SUCCEEDED", true, undefined],
    ]);
    assert.equal(primary.calls, 0);
    assert.equal(fallback.calls, 1);
  } finally {
    fixture.close();
  }
});

test("All circuits open returns CIRCUIT_OPEN without Provider calls, while policy-disabled routes bypass safely", async () => {
  const fixture = createFixture({ failureThreshold: 1 });
  const disabledFixture = createFixture({ failureThreshold: 1, enabled: false });
  try {
    const firstRoute = await createRoute(fixture, "GENERATION", "test.circuit.all-open-a");
    const secondRoute = await createRoute(fixture, "GENERATION", "test.circuit.all-open-b");
    const first = new FakeGenerationAdapter(firstRoute.adapterKey, async function* () {});
    const second = new FakeGenerationAdapter(secondRoute.adapterKey, async function* () {});
    openCircuit(fixture, firstRoute, BASE_TIME + 600);
    openCircuit(fixture, secondRoute, BASE_TIME + 600);
    const gateway = createGateway(fixture, [first, second]);
    const stream = gateway.generate({ capability: "GENERATION", attempts: [firstRoute.modelConfigId, secondRoute.modelConfigId] }, generationRequest(), {
      circuitPolicy: { policyId: fixture.policyId, policyRevision: 1 },
    });
    await assert.rejects(() => collect(stream), (error: unknown) => error instanceof AIProviderGatewayError && error.code === "CIRCUIT_OPEN");
    const traces = await stream.trace;
    assert.equal(traces.length, 2);
    assert.equal(traces.every((trace) => trace.status === "SKIPPED" && trace.providerInvoked === false), true);
    assert.equal(first.calls + second.calls, 0);

    const disabledRoute = await createRoute(disabledFixture, "GENERATION", "test.circuit.disabled");
    const disabledAdapter = new FakeGenerationAdapter(disabledRoute.adapterKey, async function* () {
      yield { type: "STARTED" };
      yield { type: "COMPLETED", finishReason: "STOP", usage: emptyUsage() };
    });
    const disabledGateway = createGateway(disabledFixture, [disabledAdapter]);
    const disabledStream = disabledGateway.generate({ capability: "GENERATION", attempts: [disabledRoute.modelConfigId] }, generationRequest(), {
      circuitPolicy: { policyId: disabledFixture.policyId, policyRevision: 1 },
    });
    await collect(disabledStream);
    assert.equal(disabledAdapter.calls, 1);
    assert.equal(disabledFixture.circuit.getSnapshot(target(disabledFixture, disabledRoute)), null);
  } finally {
    disabledFixture.close();
    fixture.close();
  }
});

test("Provider failures count only after invocation, partial Generation output still blocks fallback, and neutral failures do not trip the circuit", async () => {
  const fixture = createFixture({ failureThreshold: 3 });
  try {
    const partialRoute = await createRoute(fixture, "GENERATION", "test.circuit.partial");
    const fallbackRoute = await createRoute(fixture, "GENERATION", "test.circuit.partial-fallback");
    const partial = new FakeGenerationAdapter(partialRoute.adapterKey, async function* () {
      yield { type: "STARTED" };
      yield { type: "TEXT_DELTA", text: "جزء" };
      throw new AIProviderAdapterError("UNAVAILABLE");
    });
    const fallback = new FakeGenerationAdapter(fallbackRoute.adapterKey, async function* () {
      yield { type: "STARTED" };
      yield { type: "COMPLETED", finishReason: "STOP", usage: emptyUsage() };
    });
    const gateway = createGateway(fixture, [partial, fallback]);
    const options = { circuitPolicy: { policyId: fixture.policyId, policyRevision: 1 } };
    const partialStream = gateway.generate({ capability: "GENERATION", attempts: [partialRoute.modelConfigId, fallbackRoute.modelConfigId] }, generationRequest(), options);
    await assert.rejects(() => collect(partialStream), (error: unknown) => error instanceof AIProviderGatewayError && error.code === "UNAVAILABLE");
    assert.equal(fallback.calls, 0);
    const partialTrace = (await partialStream.trace)[0]!;
    assert.equal(partialTrace.providerInvoked, true);
    assert.equal(fixture.circuit.getSnapshot(target(fixture, partialRoute))?.consecutiveFailures, 1);

    const neutralRoute = await createRoute(fixture, "GENERATION", "test.circuit.neutral");
    const neutral = new FakeGenerationAdapter(neutralRoute.adapterKey, async function* () {
      throw new AIProviderAdapterError("CANCELLED");
    });
    const neutralGateway = createGateway(fixture, [neutral]);
    const neutralStream = neutralGateway.generate({ capability: "GENERATION", attempts: [neutralRoute.modelConfigId] }, generationRequest(), options);
    await assert.rejects(() => collect(neutralStream), (error: unknown) => error instanceof AIProviderGatewayError && error.code === "CANCELLED");
    assert.equal(neutral.calls, 1);
    assert.equal(fixture.circuit.getSnapshot(target(fixture, neutralRoute))?.consecutiveFailures, 0);
  } finally {
    fixture.close();
  }
});

test("Gateway circuit policy is optional, invalid local requests do not create circuit state, and attempt status vocabulary includes SKIPPED", async () => {
  const fixture = createFixture({ failureThreshold: 1 });
  try {
    assert.equal(AI_PROVIDER_ATTEMPT_STATUSES.includes("SKIPPED"), true);
    const route = await createRoute(fixture, "GENERATION", "test.circuit.optional");
    const adapter = new FakeGenerationAdapter(route.adapterKey, async function* () {
      yield { type: "STARTED" };
      yield { type: "COMPLETED", finishReason: "STOP", usage: emptyUsage() };
    });
    const gateway = createGateway(fixture, [adapter]);
    await collect(gateway.generate({ capability: "GENERATION", attempts: [route.modelConfigId] }, generationRequest()));
    assert.equal(adapter.calls, 1);
    assert.equal(fixture.circuit.getSnapshot(target(fixture, route)), null);

    const withoutCircuit = new AIProviderGateway({
      providerConfigs: fixture.providers,
      modelConfigs: fixture.models,
      secrets: fixture.secrets,
      adapters: new ProviderAdapterRegistry([adapter]),
    });
    const configuredWithoutService = withoutCircuit.generate({ capability: "GENERATION", attempts: [route.modelConfigId] }, generationRequest(), {
      circuitPolicy: { policyId: fixture.policyId, policyRevision: 1 },
    });
    await assert.rejects(() => collect(configuredWithoutService), (error: unknown) => error instanceof AIProviderGatewayError && error.code === "CONFIGURATION");
    assert.equal(adapter.calls, 1);

    const invalidStream = gateway.generate({ capability: "GENERATION", attempts: [route.modelConfigId] }, {
      requestId: "invalid-request",
      messages: [],
      stream: true,
    });
    await assert.rejects(() => collect(invalidStream), (error: unknown) => error instanceof AIProviderGatewayError && error.code === "INVALID_REQUEST");
    assert.equal(fixture.circuit.getSnapshot(target(fixture, route)), null);
  } finally {
    fixture.close();
  }
});

test("Circuit target validation rejects non-UUID identities and state/event views never expose probe credentials", () => {
  const fixture = createFixture();
  try {
    assert.throws(() => fixture.circuit.acquirePermit({
      target: {
        policyId: "../policy",
        policyRevision: 1,
        modelConfigId: uuidv7(),
        modelConfigRevision: 1,
        providerConfigId: uuidv7(),
        providerConfigRevision: 1,
        capability: "GENERATION",
        adapterKey: "test.adapter",
        secretVersion: 1,
      },
      at: BASE_TIME,
    }), (error: unknown) => error instanceof AICircuitBreakerError && error.code === "AI_CIRCUIT_TARGET_INVALID");
  } finally {
    fixture.close();
  }
});
