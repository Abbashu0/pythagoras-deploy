import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../src/server/admin-auth";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import {
  AIProviderGateway,
  AIProviderAdapterError,
  AIProviderAdapterRegistryError,
  AIProviderGatewayError,
  AI_PROVIDER_HTTP_LIMITS,
  ProviderAdapterRegistry,
  StrictOutboundTargetPolicy,
  isDisallowedOutboundAddress,
  redactProviderHeaders,
  type AIModelSelectionPlan,
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
} from "../src/server/ai/gateway";
import {
  AI_MODEL_CONFIG_RESOURCE_TYPE,
  AIModelConfigError,
  SQLiteAIModelConfigRepository,
  normalizeAIModelConfigContent,
} from "../src/server/ai/model-registry";
import {
  AI_PROVIDER_CONFIG_RESOURCE_TYPE,
  SQLiteAIProviderConfigRepository,
} from "../src/server/ai/configuration";
import {
  AI_SECRET_KEY_BYTES,
  createLocalAISecretStore,
  type AISecretActor,
  type LocalEncryptedAISecretStore,
} from "../src/server/ai/secrets";
import { createChangeManagementService } from "../src/server/change-management";
import {
  getContentDatabaseStatus,
  openContentDatabase,
  type ContentDatabase,
} from "../src/server/content";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const TEST_MASTER_KEY = Buffer.alloc(AI_SECRET_KEY_BYTES, 0x4d);

interface Fixture {
  root: string;
  database: ContentDatabase;
  owner: AdminActor;
  admin: AdminActor;
  secrets: LocalEncryptedAISecretStore;
  providers: SQLiteAIProviderConfigRepository;
  models: SQLiteAIModelConfigRepository;
  changes: ReturnType<typeof createChangeManagementService>;
  close(): void;
}

interface ProviderFixture {
  id: string;
  credentialRef: string;
  secret: string;
}

function createFixture(): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-m2-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  const identities = new SQLiteAdminIdentityRepository(database);
  const ownerUser = identities.createInitialOwner({
    id: uuidv7(),
    email: `owner-${uuidv7()}@ai-m2.test`,
    displayName: "AI M2 Owner",
    passwordHash: "fixture-only",
    createdAt: 1_900_100_000_000,
  });
  const adminUser = identities.createAdmin({
    id: uuidv7(),
    email: `admin-${uuidv7()}@ai-m2.test`,
    displayName: "AI M2 Admin",
    passwordHash: "fixture-only",
    createdAt: 1_900_100_000_001,
  });
  let now = 1_900_100_100_000;
  const secrets = createLocalAISecretStore(database, {
    masterKey: TEST_MASTER_KEY,
    clock: () => now++,
  });
  return {
    root,
    database,
    owner: { actorUserId: ownerUser.id, actorRole: "OWNER" },
    admin: { actorUserId: adminUser.id, actorRole: "ADMIN" },
    secrets,
    providers: new SQLiteAIProviderConfigRepository(database),
    models: new SQLiteAIModelConfigRepository(database),
    changes: createChangeManagementService(database),
    close() {
      database.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
    },
  };
}

function fakeSecret(): string {
  return `test-only-${randomBytes(48).toString("base64url")}`;
}

function secretActor(actor: AdminActor): AISecretActor {
  return { type: "ADMIN", actorUserId: actor.actorUserId };
}

function providerContent(
  key: string,
  credentialRef: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    key,
    displayName: `Provider ${key}`,
    baseUrl: "https://provider.example/v1",
    credentialRef,
    enabled: true,
    retentionPolicy: "UNKNOWN" as const,
    trainingPolicy: "UNKNOWN" as const,
    zdrSupported: false,
    zdrRequired: false,
    ...overrides,
  };
}

async function createProvider(
  fixture: Fixture,
  key = `provider-${uuidv7()}`,
  overrides: Record<string, unknown> = {},
): Promise<ProviderFixture> {
  const credentialSecret = fakeSecret();
  const credential = await fixture.secrets.create({
    secret: credentialSecret,
    actor: secretActor(fixture.owner),
  });
  const id = uuidv7();
  const draft = fixture.changes.createChangeSet(
    {
      title: "AI M2 Provider fixture",
      initialItem: {
        resourceType: AI_PROVIDER_CONFIG_RESOURCE_TYPE,
        resourceId: id,
        operation: "CREATE",
        expectedRevision: 0,
        desired: providerContent(key, credential.credentialRef, overrides),
      },
    },
    fixture.owner,
  );
  const submitted = fixture.changes.submit(
    draft.changeSet.id,
    draft.changeSet.revision,
    fixture.owner,
  );
  const approved = fixture.changes.approve(
    submitted.changeSet.id,
    submitted.changeSet.revision,
    fixture.owner,
  );
  fixture.changes.publish(approved.changeSet.id, approved.changeSet.revision, fixture.owner);
  return { id, credentialRef: credential.credentialRef, secret: credentialSecret };
}

function modelContent(
  key: string,
  providerConfigId: string,
  capability: "GENERATION" | "EMBEDDING" | "RERANK",
  adapterKey: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    key,
    displayName: `Model ${key}`,
    providerConfigId,
    providerModelId: `opaque-model-${key}`,
    capability,
    adapterKey,
    enabled: true,
    contextWindowTokens: capability === "GENERATION" ? 4096 : null,
    maxOutputTokens: capability === "GENERATION" ? 512 : null,
    embeddingDimensions: capability === "EMBEDDING" ? 3 : null,
    supportsStreaming: capability === "GENERATION",
    supportsReasoning: false,
    supportsStructuredOutput: false,
    ...overrides,
  };
}

function publishModel(
  fixture: Fixture,
  providerConfigId: string,
  capability: "GENERATION" | "EMBEDDING" | "RERANK",
  adapterKey: string,
  overrides: Record<string, unknown> = {},
): string {
  const id = uuidv7();
  const draft = fixture.changes.createChangeSet(
    {
      title: "AI M2 Model fixture",
      initialItem: {
        resourceType: AI_MODEL_CONFIG_RESOURCE_TYPE,
        resourceId: id,
        operation: "CREATE",
        expectedRevision: 0,
        desired: modelContent(
          `model-${uuidv7()}`,
          providerConfigId,
          capability,
          adapterKey,
          overrides,
        ),
      },
    },
    fixture.owner,
  );
  const submitted = fixture.changes.submit(
    draft.changeSet.id,
    draft.changeSet.revision,
    fixture.owner,
  );
  const approved = fixture.changes.approve(
    submitted.changeSet.id,
    submitted.changeSet.revision,
    fixture.owner,
  );
  fixture.changes.publish(approved.changeSet.id, approved.changeSet.revision, fixture.owner);
  return id;
}

const emptyUsage = (): NormalizedProviderUsage => ({
  inputTokens: null,
  outputTokens: null,
  reasoningTokens: null,
  cacheHitInputTokens: null,
  cacheMissInputTokens: null,
});

class FakeGenerationAdapter implements GenerationProviderAdapter {
  readonly adapterKey: string;
  readonly capability = "GENERATION" as const;
  calls = 0;
  credentials: string[] = [];
  requests: GenerationProviderRequest[] = [];

  constructor(
    private readonly behavior: (
      request: GenerationProviderRequest,
      context: ProviderAdapterExecutionContext,
    ) => AsyncIterable<ProviderGenerationStreamEvent>,
    adapterKey = "test.fake-generation",
  ) {
    this.adapterKey = adapterKey;
  }

  generate(request: GenerationProviderRequest, context: ProviderAdapterExecutionContext): AsyncIterable<ProviderGenerationStreamEvent> {
    this.calls += 1;
    this.credentials.push(context.credential);
    this.requests.push(request);
    return this.behavior(request, context);
  }
}

class FakeEmbeddingAdapter implements EmbeddingProviderAdapter {
  readonly adapterKey = "test.fake-embedding";
  readonly capability = "EMBEDDING" as const;
  calls = 0;

  constructor(
    private readonly behavior: (
      request: EmbeddingProviderRequest,
      context: ProviderAdapterExecutionContext,
    ) => Promise<EmbeddingProviderResult>,
  ) {}

  embed(request: EmbeddingProviderRequest, context: ProviderAdapterExecutionContext): Promise<EmbeddingProviderResult> {
    this.calls += 1;
    return this.behavior(request, context);
  }
}

class FakeRerankerAdapter implements RerankerProviderAdapter {
  readonly adapterKey = "test.fake-rerank";
  readonly capability = "RERANK" as const;
  calls = 0;

  constructor(
    private readonly behavior: (
      request: RerankProviderRequest,
      context: ProviderAdapterExecutionContext,
    ) => Promise<RerankProviderResult>,
  ) {}

  rerank(request: RerankProviderRequest, context: ProviderAdapterExecutionContext): Promise<RerankProviderResult> {
    this.calls += 1;
    return this.behavior(request, context);
  }
}

async function collect(stream: { events: AsyncIterable<GatewayGenerationStreamEvent> }): Promise<GatewayGenerationStreamEvent[]> {
  const events: GatewayGenerationStreamEvent[] = [];
  for await (const event of stream.events) events.push(event);
  return events;
}

function generationRequest(overrides: Partial<GenerationProviderRequest> = {}) {
  return {
    requestId: uuidv7(),
    messages: [{ role: "user" as const, content: "اختبار" }],
    stream: true,
    ...overrides,
  };
}

function expectGatewayCode(code: string) {
  return (error: unknown): boolean =>
    error instanceof AIProviderGatewayError && error.code === code;
}

test("AI M2 migration creates a safe Model Registry table without credential material", () => {
  const fixture = createFixture();
  try {
    assert.equal(getContentDatabaseStatus(fixture.database).migrationsApplied, 14);
    const columns = fixture.database.client
      .prepare("pragma table_info(ai_model_configs)")
      .all() as Array<{ name: string }>;
    assert.ok(columns.some((column) => column.name === "provider_model_id"));
    assert.equal(
      columns.some((column) => ["secret", "api_key", "ciphertext", "master_key", "authorization"].includes(column.name)),
      false,
    );
  } finally {
    fixture.close();
  }
});

test("Model Registry validation keeps one capability per model and bounds capability fields", () => {
  const providerId = uuidv7();
  const base = modelContent("safe-model", providerId, "GENERATION", "test.fake-generation");
  assert.equal(normalizeAIModelConfigContent(base).capability, "GENERATION");
  assert.throws(
    () => normalizeAIModelConfigContent({ ...base, capability: "EMBEDDING", embeddingDimensions: 3 }),
    (error) => error instanceof AIModelConfigError && error.code === "AI_MODEL_CONFIG_INVALID",
  );
  assert.throws(
    () => normalizeAIModelConfigContent({ ...base, maxOutputTokens: 5000 }),
    (error) => error instanceof AIModelConfigError && error.code === "AI_MODEL_CONFIG_INVALID",
  );
  assert.throws(
    () => normalizeAIModelConfigContent({ ...base, adapterKey: "../dynamic-module" }),
    (error) => error instanceof AIModelConfigError && error.code === "AI_MODEL_CONFIG_INVALID",
  );
});

test("Provider Adapter Registry rejects duplicates, missing adapters, and capability mismatches", () => {
  const generation = new FakeGenerationAdapter(async function* () {});
  assert.throws(
    () => new ProviderAdapterRegistry([generation, generation]),
    (error) => error instanceof AIProviderAdapterRegistryError && error.code === "AI_PROVIDER_ADAPTER_DUPLICATE",
  );
  const registry = new ProviderAdapterRegistry([generation]);
  assert.throws(
    () => registry.require("test.missing", "GENERATION"),
    (error) => error instanceof AIProviderAdapterRegistryError && error.code === "AI_PROVIDER_ADAPTER_NOT_FOUND",
  );
  assert.throws(
    () => registry.require("test.fake-generation", "EMBEDDING"),
    (error) => error instanceof AIProviderAdapterRegistryError && error.code === "AI_PROVIDER_ADAPTER_CAPABILITY_MISMATCH",
  );
});

test("Model configuration is governed and publication only mutates the canonical model row", async () => {
  const fixture = createFixture();
  try {
    const provider = await createProvider(fixture);
    const modelId = uuidv7();
    const desired = modelContent("governed-model", provider.id, "GENERATION", "test.fake-generation");
    const draft = fixture.changes.createChangeSet(
      {
        title: "Governed model",
        initialItem: {
          resourceType: AI_MODEL_CONFIG_RESOURCE_TYPE,
          resourceId: modelId,
          operation: "CREATE",
          expectedRevision: 0,
          desired,
        },
      },
      fixture.owner,
    );
    assert.equal(fixture.models.getById(modelId), null);
    assert.deepEqual(draft.items[0].proposedSnapshot, desired);
    assert.equal(JSON.stringify(draft).includes(provider.secret), false);
    const submitted = fixture.changes.submit(draft.changeSet.id, draft.changeSet.revision, fixture.owner);
    const approved = fixture.changes.approve(submitted.changeSet.id, submitted.changeSet.revision, fixture.owner);
    assert.equal(fixture.models.getById(modelId), null);
    fixture.changes.publish(approved.changeSet.id, approved.changeSet.revision, fixture.owner);
    const model = fixture.models.getById(modelId);
    assert.ok(model);
    assert.equal(model.providerConfigId, provider.id);
    assert.equal(model.revision, 1);
    assert.equal(JSON.stringify(draft).includes("api-key"), false);

    assert.throws(
      () => fixture.changes.createChangeSet(
        {
          title: "Immutable model key",
          initialItem: {
            resourceType: AI_MODEL_CONFIG_RESOURCE_TYPE,
            resourceId: modelId,
            expectedRevision: model.revision,
            desired: { ...desired, key: "different-model-key" },
          },
        },
        fixture.owner,
      ),
      /immutable/i,
    );

    const unauthorizedDraft = fixture.changes.createChangeSet(
      {
        title: "Unauthorized model publication",
        initialItem: {
          resourceType: AI_MODEL_CONFIG_RESOURCE_TYPE,
          resourceId: modelId,
          expectedRevision: model.revision,
          desired: { ...desired, displayName: "Updated model" },
        },
      },
      fixture.owner,
    );
    const unauthorizedSubmitted = fixture.changes.submit(unauthorizedDraft.changeSet.id, unauthorizedDraft.changeSet.revision, fixture.owner);
    const unauthorizedApproved = fixture.changes.approve(unauthorizedSubmitted.changeSet.id, unauthorizedSubmitted.changeSet.revision, fixture.owner);
    assert.throws(
      () => fixture.changes.publish(unauthorizedApproved.changeSet.id, unauthorizedApproved.changeSet.revision, fixture.admin),
      /OWNER|authorization/i,
    );
  } finally {
    fixture.close();
  }
});

test("Model publication rejects a missing Provider reference and stale updates conflict", async () => {
  const fixture = createFixture();
  try {
    const missingProviderModel = uuidv7();
    const missingDraft = fixture.changes.createChangeSet(
      {
        title: "Missing provider model",
        initialItem: {
          resourceType: AI_MODEL_CONFIG_RESOURCE_TYPE,
          resourceId: missingProviderModel,
          operation: "CREATE",
          expectedRevision: 0,
          desired: modelContent("missing-provider-model", uuidv7(), "GENERATION", "test.fake-generation"),
        },
      },
      fixture.owner,
    );
    const missingSubmitted = fixture.changes.submit(missingDraft.changeSet.id, missingDraft.changeSet.revision, fixture.owner);
    const missingApproved = fixture.changes.approve(missingSubmitted.changeSet.id, missingSubmitted.changeSet.revision, fixture.owner);
    assert.throws(
      () => fixture.changes.publish(missingApproved.changeSet.id, missingApproved.changeSet.revision, fixture.owner),
      /referenced AI Provider|Provider configuration/i,
    );
    const provider = await createProvider(fixture);
    const modelId = publishModel(fixture, provider.id, "GENERATION", "test.fake-generation");
    const current = fixture.models.getById(modelId);
    assert.ok(current);
    const update = fixture.changes.createChangeSet(
      {
        title: "Model update",
        initialItem: {
          resourceType: AI_MODEL_CONFIG_RESOURCE_TYPE,
          resourceId: modelId,
          expectedRevision: current.revision,
          desired: modelContent("model-update", provider.id, "GENERATION", "test.fake-generation", { key: current.key, displayName: "Updated model" }),
        },
      },
      fixture.owner,
    );
    const submitted = fixture.changes.submit(update.changeSet.id, update.changeSet.revision, fixture.owner);
    const approved = fixture.changes.approve(submitted.changeSet.id, submitted.changeSet.revision, fixture.owner);
    fixture.changes.publish(approved.changeSet.id, approved.changeSet.revision, fixture.owner);
    assert.equal(fixture.models.getById(modelId)?.revision, 2);
  } finally {
    fixture.close();
  }
});

test("Gateway refuses disabled Providers and revoked credentials before any adapter receives plaintext", async () => {
  const fixture = createFixture();
  try {
    const disabledProvider = await createProvider(fixture, `disabled-provider-${uuidv7()}`, { enabled: false });
    const disabledModelId = publishModel(fixture, disabledProvider.id, "GENERATION", "test.fake-generation");
    const activeProvider = await createProvider(fixture);
    const revokedModelId = publishModel(fixture, activeProvider.id, "GENERATION", "test.fake-generation");
    await fixture.secrets.revoke({
      credentialRef: activeProvider.credentialRef,
      actor: secretActor(fixture.owner),
    });
    const adapter = new FakeGenerationAdapter(async function* () {
      yield { type: "STARTED" };
      yield { type: "COMPLETED", finishReason: "STOP", usage: emptyUsage() };
    });
    const gateway = new AIProviderGateway({
      providerConfigs: fixture.providers,
      modelConfigs: fixture.models,
      secrets: fixture.secrets,
      adapters: new ProviderAdapterRegistry([adapter]),
    });
    await assert.rejects(
      () => collect(gateway.generate(
        { capability: "GENERATION", attempts: [disabledModelId] },
        generationRequest(),
      )),
      expectGatewayCode("CONFIGURATION"),
    );
    await assert.rejects(
      () => collect(gateway.generate(
        { capability: "GENERATION", attempts: [revokedModelId] },
        generationRequest(),
      )),
      expectGatewayCode("SECRET_UNAVAILABLE"),
    );
    assert.equal(adapter.calls, 0);
  } finally {
    fixture.close();
  }
});

test("Authentication, invalid-request, and capability failures never trigger silent fallback", async () => {
  const fixture = createFixture();
  try {
    const provider = await createProvider(fixture);
    const primaryId = publishModel(fixture, provider.id, "GENERATION", "test.auth-primary");
    const fallbackId = publishModel(fixture, provider.id, "GENERATION", "test.fake-generation");
    const primary = new FakeGenerationAdapter(async function* () {
      throw new AIProviderAdapterError("AUTHENTICATION", { fallbackEligible: true });
    }, "test.auth-primary");
    const fallback = new FakeGenerationAdapter(async function* () {
      yield { type: "STARTED" };
      yield { type: "COMPLETED", finishReason: "STOP", usage: emptyUsage() };
    });
    const gateway = new AIProviderGateway({
      providerConfigs: fixture.providers,
      modelConfigs: fixture.models,
      secrets: fixture.secrets,
      adapters: new ProviderAdapterRegistry([primary, fallback]),
    });
    const stream = gateway.generate(
      { capability: "GENERATION", attempts: [primaryId, fallbackId] },
      generationRequest(),
    );
    await assert.rejects(() => collect(stream), expectGatewayCode("AUTHENTICATION"));
    assert.equal(fallback.calls, 0);
    assert.equal((await stream.trace).length, 1);

    const embeddingId = publishModel(fixture, provider.id, "EMBEDDING", "test.fake-embedding");
    const mismatchStream = gateway.generate(
      { capability: "GENERATION", attempts: [embeddingId, fallbackId] },
      generationRequest(),
    );
    await assert.rejects(() => collect(mismatchStream), expectGatewayCode("CAPABILITY_MISMATCH"));
    assert.equal(fallback.calls, 0);
  } finally {
    fixture.close();
  }
});

test("Generation Gateway resolves an opaque credential only in request scope and returns normalized events and trace", async () => {
  const fixture = createFixture();
  try {
    const provider = await createProvider(fixture, `provider-${uuidv7()}`);
    const modelId = publishModel(fixture, provider.id, "GENERATION", "test.fake-generation");
    const adapter = new FakeGenerationAdapter(async function* (request) {
      assert.equal(request.providerModelId.startsWith("opaque-model-"), true);
      yield { type: "STARTED", providerRequestId: "provider-request-1" };
      yield { type: "TEXT_DELTA", text: "إجابة" };
      yield {
        type: "USAGE",
        usage: {
          inputTokens: 4,
          outputTokens: null,
          reasoningTokens: null,
          cacheHitInputTokens: null,
          cacheMissInputTokens: null,
        },
      };
      yield {
        type: "COMPLETED",
        finishReason: "STOP",
        usage: {
          inputTokens: 4,
          outputTokens: 2,
          reasoningTokens: null,
          cacheHitInputTokens: null,
          cacheMissInputTokens: null,
        },
        providerRequestId: "provider-request-1",
      };
    });
    const gateway = new AIProviderGateway({
      providerConfigs: fixture.providers,
      modelConfigs: fixture.models,
      secrets: fixture.secrets,
      adapters: new ProviderAdapterRegistry([adapter]),
    }, { gatewayRequestIdFactory: () => "gateway-request-1" });
    const stream = gateway.generate(
      { capability: "GENERATION", attempts: [modelId] },
      generationRequest(),
    );
    const events = await collect(stream);
    const trace = await stream.trace;
    assert.deepEqual(events.map((event) => event.type), ["STARTED", "TEXT_DELTA", "USAGE", "COMPLETED"]);
    assert.equal(events.every((event) => !("providerRequestId" in event)), true);
    assert.equal(adapter.credentials.length, 1);
    assert.equal(adapter.credentials[0], provider.secret);
    assert.equal(trace.length, 1);
    assert.equal(trace[0].status, "SUCCEEDED");
    assert.equal(trace[0].providerRequestId, "provider-request-1");
    assert.equal(JSON.stringify(trace).includes(provider.secret), false);
    assert.equal(JSON.stringify(trace).includes("إجابة"), false);
  } finally {
    fixture.close();
  }
});

test("Gateway requires enabled Model, enabled Provider, active credential, and a matching registered adapter before invocation", async () => {
  const fixture = createFixture();
  try {
    const provider = await createProvider(fixture);
    const disabledModelId = publishModel(fixture, provider.id, "GENERATION", "test.fake-generation", { enabled: false });
    const adapter = new FakeGenerationAdapter(async function* () {});
    const gateway = new AIProviderGateway({
      providerConfigs: fixture.providers,
      modelConfigs: fixture.models,
      secrets: fixture.secrets,
      adapters: new ProviderAdapterRegistry([adapter]),
    });
    const disabledStream = gateway.generate(
      { capability: "GENERATION", attempts: [disabledModelId] },
      generationRequest(),
    );
    await assert.rejects(() => collect(disabledStream), expectGatewayCode("CONFIGURATION"));
    assert.equal(adapter.calls, 0);

    const missingAdapterModelId = publishModel(fixture, provider.id, "GENERATION", "test.missing-adapter");
    const missingAdapterStream = gateway.generate(
      { capability: "GENERATION", attempts: [missingAdapterModelId] },
      generationRequest(),
    );
    await assert.rejects(() => collect(missingAdapterStream), expectGatewayCode("CONFIGURATION"));
    const missingTrace = await missingAdapterStream.trace;
    assert.equal(missingTrace[0].adapterKey, "test.missing-adapter");
  } finally {
    fixture.close();
  }
});

test("Generation fallback uses only eligible failures and records every safe attempt", async () => {
  const fixture = createFixture();
  try {
    const provider = await createProvider(fixture);
    const primaryId = publishModel(fixture, provider.id, "GENERATION", "test.primary");
    const fallbackId = publishModel(fixture, provider.id, "GENERATION", "test.fake-generation");
    const primary = new FakeGenerationAdapter(async function* () {
      yield { type: "STARTED", providerRequestId: "primary-request" };
      throw new AIProviderAdapterError("UNAVAILABLE", { providerRequestId: "primary-request" });
    }, "test.primary");
    const fallback = new FakeGenerationAdapter(async function* () {
      yield { type: "STARTED", providerRequestId: "fallback-request" };
      yield { type: "TEXT_DELTA", text: "الجواب" };
      yield { type: "COMPLETED", finishReason: "STOP", usage: emptyUsage(), providerRequestId: "fallback-request" };
    });
    const gateway = new AIProviderGateway({
      providerConfigs: fixture.providers,
      modelConfigs: fixture.models,
      secrets: fixture.secrets,
      adapters: new ProviderAdapterRegistry([primary, fallback]),
    });
    const stream = gateway.generate(
      { capability: "GENERATION", attempts: [primaryId, fallbackId] },
      generationRequest(),
    );
    const events = await collect(stream);
    assert.deepEqual(events, [
      { type: "STARTED" },
      { type: "TEXT_DELTA", text: "الجواب" },
      { type: "COMPLETED", finishReason: "STOP", usage: emptyUsage() },
    ]);
    assert.equal(events.filter((event) => event.type === "STARTED").length, 1);
    assert.equal(events.every((event) => !("providerRequestId" in event)), true);
    const trace = await stream.trace;
    assert.deepEqual(trace.map((item) => [item.attemptIndex, item.status, item.errorCode]), [
      [0, "FAILED", "UNAVAILABLE"],
      [1, "SUCCEEDED", undefined],
    ]);
    assert.equal(primary.calls, 1);
    assert.equal(fallback.calls, 1);
  } finally {
    fixture.close();
  }
});

test("A fallback that is the first provider to start still emits one provider-neutral STARTED event", async () => {
  const fixture = createFixture();
  try {
    const provider = await createProvider(fixture);
    const primaryId = publishModel(fixture, provider.id, "GENERATION", "test.not-started");
    const fallbackId = publishModel(fixture, provider.id, "GENERATION", "test.fake-generation");
    const primary = new FakeGenerationAdapter(async function* () {
      throw new AIProviderAdapterError("UNAVAILABLE");
    }, "test.not-started");
    const fallback = new FakeGenerationAdapter(async function* () {
      yield { type: "STARTED", providerRequestId: "fallback-only-request" };
      yield { type: "COMPLETED", finishReason: "STOP", usage: emptyUsage(), providerRequestId: "fallback-only-request" };
    });
    const gateway = new AIProviderGateway({
      providerConfigs: fixture.providers,
      modelConfigs: fixture.models,
      secrets: fixture.secrets,
      adapters: new ProviderAdapterRegistry([primary, fallback]),
    });
    const stream = gateway.generate(
      { capability: "GENERATION", attempts: [primaryId, fallbackId] },
      generationRequest(),
    );
    const events = await collect(stream);
    assert.deepEqual(events, [
      { type: "STARTED" },
      { type: "COMPLETED", finishReason: "STOP", usage: emptyUsage() },
    ]);
    assert.equal(events.every((event) => !("providerRequestId" in event)), true);
    const trace = await stream.trace;
    assert.equal(trace[0].providerRequestId, undefined);
    assert.equal(trace[1].providerRequestId, "fallback-only-request");
  } finally {
    fixture.close();
  }
});

test("Cancellation is terminal and partial output does not silently switch models", async () => {
  const fixture = createFixture();
  try {
    const provider = await createProvider(fixture);
    const primaryId = publishModel(fixture, provider.id, "GENERATION", "test.primary-cancel");
    const fallbackId = publishModel(fixture, provider.id, "GENERATION", "test.fake-generation");
    const primary = new FakeGenerationAdapter(async function* (_request, context) {
      yield { type: "STARTED" };
      yield { type: "TEXT_DELTA", text: "partial" };
      await new Promise<void>((resolve) => {
        if (context.signal.aborted) resolve();
        else context.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      throw new AIProviderAdapterError("UNAVAILABLE");
    }, "test.primary-cancel");
    const fallback = new FakeGenerationAdapter(async function* () {
      yield { type: "STARTED" };
      yield { type: "COMPLETED", finishReason: "STOP", usage: emptyUsage() };
    });
    const gateway = new AIProviderGateway({
      providerConfigs: fixture.providers,
      modelConfigs: fixture.models,
      secrets: fixture.secrets,
      adapters: new ProviderAdapterRegistry([primary, fallback]),
    }, { defaultTimeoutMs: 500 });
    const controller = new AbortController();
    const stream = gateway.generate(
      { capability: "GENERATION", attempts: [primaryId, fallbackId] },
      generationRequest(),
      { signal: controller.signal },
    );
    const iterator = stream.events[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.next();
    controller.abort();
    await assert.rejects(() => iterator.next(), expectGatewayCode("CANCELLED"));
    const trace = await stream.trace;
    assert.equal(trace.length, 1);
    assert.equal(trace[0].status, "CANCELLED");
    assert.equal(fallback.calls, 0);
  } finally {
    fixture.close();
  }
});

test("Timeout is distinct from caller cancellation and can fall back before text is emitted", async () => {
  const fixture = createFixture();
  try {
    const provider = await createProvider(fixture);
    const primaryId = publishModel(fixture, provider.id, "GENERATION", "test.primary-timeout");
    const fallbackId = publishModel(fixture, provider.id, "GENERATION", "test.fake-generation");
    const primary = new FakeGenerationAdapter(async function* () {
      throw new AIProviderAdapterError("TIMEOUT", { providerRequestId: "timed-out-request" });
    }, "test.primary-timeout");
    const fallback = new FakeGenerationAdapter(async function* () {
      yield { type: "STARTED" };
      yield { type: "COMPLETED", finishReason: "STOP", usage: emptyUsage() };
    });
    const gateway = new AIProviderGateway({
      providerConfigs: fixture.providers,
      modelConfigs: fixture.models,
      secrets: fixture.secrets,
      adapters: new ProviderAdapterRegistry([primary, fallback]),
    }, { defaultTimeoutMs: 500 });
    const stream = gateway.generate(
      { capability: "GENERATION", attempts: [primaryId, fallbackId] },
      generationRequest(),
    );
    await collect(stream);
    const trace = await stream.trace;
    assert.equal(trace[0].errorCode, "TIMEOUT");
    assert.equal(trace[0].status, "TIMEOUT");
    assert.equal(trace[1].status, "SUCCEEDED");

    const slowModelId = publishModel(fixture, provider.id, "GENERATION", "test.slow-timeout");
    const slow = new FakeGenerationAdapter(async function* (_request, context) {
      yield { type: "STARTED", providerRequestId: "slow-timeout-request" };
      await new Promise<void>((resolve) => {
        if (context.signal.aborted) resolve();
        else context.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      throw new AIProviderAdapterError("UNAVAILABLE");
    }, "test.slow-timeout");
    const slowGateway = new AIProviderGateway({
      providerConfigs: fixture.providers,
      modelConfigs: fixture.models,
      secrets: fixture.secrets,
      adapters: new ProviderAdapterRegistry([slow]),
    }, { defaultTimeoutMs: 10 });
    const slowStream = slowGateway.generate(
      { capability: "GENERATION", attempts: [slowModelId] },
      generationRequest(),
    );
    await assert.rejects(() => collect(slowStream), expectGatewayCode("TIMEOUT"));
    const slowTrace = await slowStream.trace;
    assert.equal(slowTrace[0].status, "TIMEOUT");
    assert.equal(slowTrace[0].providerRequestId, "slow-timeout-request");
  } finally {
    fixture.close();
  }
});

test("Malformed generation events become BAD_RESPONSE and do not expose provider details", async () => {
  const fixture = createFixture();
  try {
    const provider = await createProvider(fixture);
    const modelId = publishModel(fixture, provider.id, "GENERATION", "test.fake-generation");
    const adapter = new FakeGenerationAdapter(async function* () {
      yield { type: "STARTED" };
      yield { type: "COMPLETED", finishReason: "STOP", usage: emptyUsage() };
      yield { type: "TEXT_DELTA", text: "late" };
    });
    const gateway = new AIProviderGateway({
      providerConfigs: fixture.providers,
      modelConfigs: fixture.models,
      secrets: fixture.secrets,
      adapters: new ProviderAdapterRegistry([adapter]),
    });
    const stream = gateway.generate({ capability: "GENERATION", attempts: [modelId] }, generationRequest());
    await assert.rejects(() => collect(stream), expectGatewayCode("BAD_RESPONSE"));
    const trace = await stream.trace;
    assert.equal(trace[0].errorCode, "BAD_RESPONSE");
  } finally {
    fixture.close();
  }
});

test("Embedding Gateway validates cardinality, dimensions, finite vectors, and preserves unknown usage", async () => {
  const fixture = createFixture();
  try {
    const provider = await createProvider(fixture);
    const modelId = publishModel(fixture, provider.id, "EMBEDDING", "test.fake-embedding");
    const adapter = new FakeEmbeddingAdapter(async (request) => {
      assert.deepEqual(request.inputs, ["a", "b"]);
      assert.equal(request.inputType, "DOCUMENT");
      return {
      vectors: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
      dimensions: 3,
      usage: emptyUsage(),
      };
    });
    const gateway = new AIProviderGateway({
      providerConfigs: fixture.providers,
      modelConfigs: fixture.models,
      secrets: fixture.secrets,
      adapters: new ProviderAdapterRegistry([adapter]),
    });
    const result = await gateway.embed(
      { capability: "EMBEDDING", attempts: [modelId] },
      { requestId: uuidv7(), inputType: "DOCUMENT", inputs: ["a", "b"] },
    );
    assert.deepEqual(result.value.vectors[0], [0.1, 0.2, 0.3]);
    assert.equal(result.value.usage.inputTokens, null);
    assert.equal(result.attempts[0].status, "SUCCEEDED");

    const malformed = new FakeEmbeddingAdapter(async () => ({
      vectors: [[0.1, Number.NaN, 0.3]],
      dimensions: 3,
      usage: emptyUsage(),
    }));
    const malformedGateway = new AIProviderGateway({
      providerConfigs: fixture.providers,
      modelConfigs: fixture.models,
      secrets: fixture.secrets,
      adapters: new ProviderAdapterRegistry([malformed]),
    });
    await assert.rejects(
      () => malformedGateway.embed(
        { capability: "EMBEDDING", attempts: [modelId] },
        { requestId: uuidv7(), inputType: "QUERY", inputs: ["a"] },
      ),
      expectGatewayCode("BAD_RESPONSE"),
    );

    const wrongCardinality = new FakeEmbeddingAdapter(async () => ({
      vectors: [[0.1, 0.2, 0.3]],
      dimensions: 3,
      usage: emptyUsage(),
    }));
    const wrongCardinalityGateway = new AIProviderGateway({
      providerConfigs: fixture.providers,
      modelConfigs: fixture.models,
      secrets: fixture.secrets,
      adapters: new ProviderAdapterRegistry([wrongCardinality]),
    });
    await assert.rejects(
      () => wrongCardinalityGateway.embed(
        { capability: "EMBEDDING", attempts: [modelId] },
        { requestId: uuidv7(), inputType: "DOCUMENT", inputs: ["a", "b"] },
      ),
      expectGatewayCode("BAD_RESPONSE"),
    );
  } finally {
    fixture.close();
  }
});

test("Rerank Gateway validates stable candidate IDs, ordered ranks, and finite scores", async () => {
  const fixture = createFixture();
  try {
    const provider = await createProvider(fixture);
    const modelId = publishModel(fixture, provider.id, "RERANK", "test.fake-rerank");
    const adapter = new FakeRerankerAdapter(async () => ({
      results: [
        { candidateId: "b", score: 0.9, rank: 1 },
        { candidateId: "a", score: 0.4, rank: 2 },
      ],
      usage: emptyUsage(),
    }));
    const gateway = new AIProviderGateway({
      providerConfigs: fixture.providers,
      modelConfigs: fixture.models,
      secrets: fixture.secrets,
      adapters: new ProviderAdapterRegistry([adapter]),
    });
    const result = await gateway.rerank(
      { capability: "RERANK", attempts: [modelId] },
      {
        requestId: uuidv7(),
        query: "query",
        candidates: [{ id: "a", text: "A" }, { id: "b", text: "B" }],
        topK: 2,
      },
    );
    assert.deepEqual(result.value.results.map((item) => item.candidateId), ["b", "a"]);
    assert.equal(result.attempts[0].status, "SUCCEEDED");

    const invalid = new FakeRerankerAdapter(async () => ({
      results: [{ candidateId: "missing", score: Number.POSITIVE_INFINITY, rank: 1 }],
      usage: emptyUsage(),
    }));
    const invalidGateway = new AIProviderGateway({
      providerConfigs: fixture.providers,
      modelConfigs: fixture.models,
      secrets: fixture.secrets,
      adapters: new ProviderAdapterRegistry([invalid]),
    });
    await assert.rejects(
      () => invalidGateway.rerank(
        { capability: "RERANK", attempts: [modelId] },
        {
          requestId: uuidv7(),
          query: "query",
          candidates: [{ id: "a", text: "A" }],
          topK: 1,
        },
      ),
      expectGatewayCode("BAD_RESPONSE"),
    );
  } finally {
    fixture.close();
  }
});

test("Strict outbound target policy rejects restricted resolved addresses and redacts sensitive headers", async () => {
  for (const address of [
    "0.0.0.0",
    "10.0.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "192.168.1.1",
    "224.0.0.1",
    "::",
    "::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
  ]) {
    assert.equal(isDisallowedOutboundAddress(address), true, address);
  }
  assert.equal(isDisallowedOutboundAddress("203.0.113.10"), true);
  assert.equal(isDisallowedOutboundAddress("8.8.8.8"), false);
  const policy = new StrictOutboundTargetPolicy({
    resolve: async () => ["127.0.0.1"],
  });
  await assert.rejects(
    () => policy.validate("https://example.test/v1"),
    (error) => error instanceof AIProviderGatewayError && error.code === "CONFIGURATION",
  );
  const validated = await new StrictOutboundTargetPolicy({
    resolve: async () => ["8.8.8.8"],
  }).validate("https://example.test/v1");
  assert.equal(validated.port, 443);
  assert.equal(Buffer.byteLength(validated.url, "utf8") <= AI_PROVIDER_HTTP_LIMITS.maxUrlBytes, true);
  assert.deepEqual(redactProviderHeaders({
    Authorization: "Bearer test-only",
    "x-api-key": "test-only",
    "content-type": "application/json",
  }), {
    Authorization: "[REDACTED]",
    "x-api-key": "[REDACTED]",
    "content-type": "application/json",
  });
});

test("Gateway request validation rejects client-shaped provider selection and unsafe generation bounds", async () => {
  const fixture = createFixture();
  try {
    const provider = await createProvider(fixture);
    const modelId = publishModel(fixture, provider.id, "GENERATION", "test.fake-generation");
    const adapter = new FakeGenerationAdapter(async function* () {
      yield { type: "STARTED" };
      yield { type: "COMPLETED", finishReason: "STOP", usage: emptyUsage() };
    });
    const gateway = new AIProviderGateway({
      providerConfigs: fixture.providers,
      modelConfigs: fixture.models,
      secrets: fixture.secrets,
      adapters: new ProviderAdapterRegistry([adapter]),
    });
    const invalidPlan = { capability: "GENERATION", attempts: [modelId, modelId] } as unknown as AIModelSelectionPlan;
    const stream = gateway.generate(invalidPlan, generationRequest());
    await assert.rejects(() => collect(stream), expectGatewayCode("INVALID_REQUEST"));
    await assert.rejects(
      () => collect(gateway.generate(
        { capability: "GENERATION", attempts: [modelId] },
        generationRequest({ maxOutputTokens: 1000 }),
      )),
      expectGatewayCode("INVALID_REQUEST"),
    );
  } finally {
    fixture.close();
  }
});
