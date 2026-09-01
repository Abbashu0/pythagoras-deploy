import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../src/server/admin-auth";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import type {
  AIProviderAttemptStatus,
  AIProviderAttemptTrace,
  NormalizedProviderUsage,
} from "../src/server/ai/gateway";
import {
  AI_MODEL_CONFIG_RESOURCE_TYPE,
  SQLiteAIModelConfigRepository,
  type AIModelCapability,
} from "../src/server/ai/model-registry";
import {
  AI_PROVIDER_CONFIG_RESOURCE_TYPE,
} from "../src/server/ai/configuration";
import {
  AI_ACCOUNTING_ACTOR_TYPES,
  AI_COST_CENTERS,
  AIAccountingError,
  AIBillingUsageNormalizerRegistry,
  AICostAccountingService,
  AICostCalculator,
  AIGenerationUsageAccumulator,
  AIRateCardResolver,
  AI_RATE_CARD_RESOURCE_TYPE,
  SQLiteAIAccountingRepository,
  SQLiteAIProviderConfigRepository,
  SQLiteAIRateCardModelRevisionRepository,
  SQLiteAIRateCardRepository,
  createLocalAISecretStore,
  normalizeAIRateCardContent,
  type AIBillableUsage,
  type AIBillingUsageNormalizationContext,
  type AIBillingUsageNormalizer,
  type AIRateCardContent,
  type AIRateCardPriceLineContent,
  type ResolvedAIRateCard,
} from "../src/server/ai";
import {
  AI_SECRET_KEY_BYTES,
  type LocalEncryptedAISecretStore,
} from "../src/server/ai/secrets";
import { createChangeManagementService } from "../src/server/change-management";
import {
  getContentDatabaseStatus,
  openContentDatabase,
  type ContentDatabase,
} from "../src/server/content";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const TEST_MASTER_KEY = Buffer.alloc(AI_SECRET_KEY_BYTES, 0x6a);
const BASE_TIME = 1_900_300_000_000;

interface Fixture {
  root: string;
  database: ContentDatabase;
  owner: AdminActor;
  admin: AdminActor;
  secrets: LocalEncryptedAISecretStore;
  providers: SQLiteAIProviderConfigRepository;
  models: SQLiteAIModelConfigRepository;
  rates: SQLiteAIRateCardRepository;
  accounting: SQLiteAIAccountingRepository;
  changes: ReturnType<typeof createChangeManagementService>;
  close(): void;
}

interface ProviderFixture {
  id: string;
  credentialRef: string;
  secret: string;
}

function createFixture(): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-m3a-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  const identities = new SQLiteAdminIdentityRepository(database);
  const ownerUser = identities.createInitialOwner({
    id: uuidv7(),
    email: `owner-${uuidv7()}@ai-m3a.test`,
    displayName: "AI M3A Owner",
    passwordHash: "fixture-only",
    createdAt: BASE_TIME,
  });
  const adminUser = identities.createAdmin({
    id: uuidv7(),
    email: `admin-${uuidv7()}@ai-m3a.test`,
    displayName: "AI M3A Admin",
    passwordHash: "fixture-only",
    createdAt: BASE_TIME + 1,
  });
  let now = BASE_TIME + 100;
  return {
    root,
    database,
    owner: { actorUserId: ownerUser.id, actorRole: "OWNER" },
    admin: { actorUserId: adminUser.id, actorRole: "ADMIN" },
    secrets: createLocalAISecretStore(database, {
      masterKey: TEST_MASTER_KEY,
      clock: () => now++,
    }),
    providers: new SQLiteAIProviderConfigRepository(database),
    models: new SQLiteAIModelConfigRepository(database),
    rates: new SQLiteAIRateCardRepository(database),
    accounting: new SQLiteAIAccountingRepository(database),
    changes: createChangeManagementService(database),
    close() {
      database.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
    },
  };
}

function providerContent(key: string, credentialRef: string) {
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
  };
}

async function createProvider(fixture: Fixture, key = `provider-${uuidv7()}`): Promise<ProviderFixture> {
  const secret = `test-only-${randomBytes(48).toString("base64url")}`;
  const credential = await fixture.secrets.create({
    secret,
    actor: { type: "ADMIN", actorUserId: fixture.owner.actorUserId },
  });
  const id = uuidv7();
  const draft = fixture.changes.createChangeSet({
    title: "AI M3A Provider fixture",
    initialItem: {
      resourceType: AI_PROVIDER_CONFIG_RESOURCE_TYPE,
      resourceId: id,
      operation: "CREATE",
      expectedRevision: 0,
      desired: providerContent(key, credential.credentialRef),
    },
  }, fixture.owner);
  const submitted = fixture.changes.submit(draft.changeSet.id, draft.changeSet.revision, fixture.owner);
  const approved = fixture.changes.approve(submitted.changeSet.id, submitted.changeSet.revision, fixture.owner);
  fixture.changes.publish(approved.changeSet.id, approved.changeSet.revision, fixture.owner);
  return { id, credentialRef: credential.credentialRef, secret };
}

function modelContent(
  key: string,
  providerConfigId: string,
  capability: AIModelCapability,
  overrides: Record<string, unknown> = {},
) {
  return {
    key,
    displayName: `Model ${key}`,
    providerConfigId,
    providerModelId: `opaque-model-${key}`,
    capability,
    adapterKey: `test.${capability.toLowerCase()}`,
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

async function publishModel(
  fixture: Fixture,
  providerConfigId: string,
  capability: AIModelCapability = "GENERATION",
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const id = uuidv7();
  const draft = fixture.changes.createChangeSet({
    title: "AI M3A Model fixture",
    initialItem: {
      resourceType: AI_MODEL_CONFIG_RESOURCE_TYPE,
      resourceId: id,
      operation: "CREATE",
      expectedRevision: 0,
      desired: modelContent(`model-${uuidv7()}`, providerConfigId, capability, overrides),
    },
  }, fixture.owner);
  const submitted = fixture.changes.submit(draft.changeSet.id, draft.changeSet.revision, fixture.owner);
  const approved = fixture.changes.approve(submitted.changeSet.id, submitted.changeSet.revision, fixture.owner);
  fixture.changes.publish(approved.changeSet.id, approved.changeSet.revision, fixture.owner);
  return id;
}

function updateModel(
  fixture: Fixture,
  id: string,
  changes: Record<string, unknown>,
): void {
  const current = fixture.models.getById(id);
  if (!current) throw new Error("Expected a Model configuration for the fixture update.");
  const desired = {
    key: current.key,
    displayName: current.displayName,
    providerConfigId: current.providerConfigId,
    providerModelId: current.providerModelId,
    capability: current.capability,
    adapterKey: current.adapterKey,
    enabled: current.enabled,
    contextWindowTokens: current.contextWindowTokens,
    maxOutputTokens: current.maxOutputTokens,
    embeddingDimensions: current.embeddingDimensions,
    supportsStreaming: current.supportsStreaming,
    supportsReasoning: current.supportsReasoning,
    supportsStructuredOutput: current.supportsStructuredOutput,
    ...changes,
  };
  const draft = fixture.changes.createChangeSet({
    title: "AI M3A Model revision fixture",
    initialItem: {
      resourceType: AI_MODEL_CONFIG_RESOURCE_TYPE,
      resourceId: id,
      operation: "UPDATE",
      expectedRevision: current.revision,
      desired,
    },
  }, fixture.owner);
  const submitted = fixture.changes.submit(draft.changeSet.id, draft.changeSet.revision, fixture.owner);
  const approved = fixture.changes.approve(submitted.changeSet.id, submitted.changeSet.revision, fixture.owner);
  fixture.changes.publish(approved.changeSet.id, approved.changeSet.revision, fixture.owner);
}

function priceLine(
  component: AIRateCardPriceLineContent["component"],
  amountNano: number,
): AIRateCardPriceLineContent {
  return {
    component,
    unit: component === "REQUEST" ? "PER_REQUEST" : "PER_MILLION_TOKENS",
    amountNano,
  };
}

function rateCardContent(
  modelConfigId: string,
  overrides: Partial<AIRateCardContent> = {},
): AIRateCardContent {
  return {
    key: `rate-card-${uuidv7()}`,
    displayName: "Synthetic Rate Card",
    modelConfigId,
    modelConfigRevision: 1,
    currency: "USD",
    billingUsageNormalizerKey: "test.billing-standard",
    effectiveFrom: 0,
    effectiveTo: null,
    enabled: true,
    priceLines: [
      priceLine("STANDARD_INPUT", 7_000_000),
      priceLine("CACHE_HIT_INPUT", 2_000_000),
      priceLine("CACHE_MISS_INPUT", 6_000_000),
      priceLine("OUTPUT", 11_000_000),
      priceLine("REASONING", 13_000_000),
      priceLine("REQUEST", 1_000_000),
    ],
    timeBands: [],
    ...overrides,
  };
}

function publishRateCard(
  fixture: Fixture,
  content: AIRateCardContent,
  actor: AdminActor = fixture.owner,
): string {
  const id = uuidv7();
  const draft = fixture.changes.createChangeSet({
    title: "AI M3A Rate Card fixture",
    initialItem: {
      resourceType: AI_RATE_CARD_RESOURCE_TYPE,
      resourceId: id,
      operation: "CREATE",
      expectedRevision: 0,
      desired: content,
    },
  }, actor);
  const submitted = fixture.changes.submit(draft.changeSet.id, draft.changeSet.revision, actor);
  const approved = fixture.changes.approve(submitted.changeSet.id, submitted.changeSet.revision, fixture.owner);
  fixture.changes.publish(approved.changeSet.id, approved.changeSet.revision, fixture.owner);
  return id;
}

function updateRateCard(fixture: Fixture, id: string, content: AIRateCardContent, expectedRevision: number): void {
  const draft = fixture.changes.createChangeSet({
    title: "AI M3A Rate Card update",
    initialItem: {
      resourceType: AI_RATE_CARD_RESOURCE_TYPE,
      resourceId: id,
      operation: "UPDATE",
      expectedRevision,
      desired: content,
    },
  }, fixture.owner);
  const submitted = fixture.changes.submit(draft.changeSet.id, draft.changeSet.revision, fixture.owner);
  const approved = fixture.changes.approve(submitted.changeSet.id, submitted.changeSet.revision, fixture.owner);
  fixture.changes.publish(approved.changeSet.id, approved.changeSet.revision, fixture.owner);
}

function usage(overrides: Partial<NormalizedProviderUsage> = {}): NormalizedProviderUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    cacheHitInputTokens: null,
    cacheMissInputTokens: null,
    ...overrides,
  };
}

function generationAttempt(modelConfigId: string, providerConfigId: string, overrides: Partial<AIProviderAttemptTrace> = {}): AIProviderAttemptTrace {
  return {
    gatewayRequestId: "gateway-request-1",
    capability: "GENERATION",
    attemptIndex: 0,
    modelConfigId,
    modelConfigRevision: 1,
    providerConfigId,
    providerConfigRevision: 1,
    adapterKey: "test.generation",
    providerModelId: "opaque-model",
    startedAt: BASE_TIME,
    completedAt: BASE_TIME + 100,
    latencyMs: 100,
    status: "SUCCEEDED" as AIProviderAttemptStatus,
    providerRequestId: "provider-request-1",
    ...overrides,
  };
}

class StandardBillingNormalizer implements AIBillingUsageNormalizer {
  readonly key = "test.billing-standard";

  normalize(usageValue: NormalizedProviderUsage, _context: AIBillingUsageNormalizationContext): AIBillableUsage {
    return {
      standardInputTokens: usageValue.inputTokens,
      cacheHitInputTokens: null,
      cacheMissInputTokens: null,
      outputTokens: usageValue.outputTokens,
      reasoningTokens: usageValue.reasoningTokens,
      requestUnits: 1,
    };
  }
}

class CacheAwareBillingNormalizer implements AIBillingUsageNormalizer {
  readonly key = "test.billing-cache-aware";

  normalize(usageValue: NormalizedProviderUsage, _context: AIBillingUsageNormalizationContext): AIBillableUsage {
    return {
      standardInputTokens: null,
      cacheHitInputTokens: usageValue.cacheHitInputTokens,
      cacheMissInputTokens: usageValue.cacheMissInputTokens,
      outputTokens: usageValue.outputTokens,
      reasoningTokens: usageValue.reasoningTokens,
      requestUnits: 1,
    };
  }
}

function resolvedRateCard(overrides: Partial<ResolvedAIRateCard> = {}): ResolvedAIRateCard {
  return {
    rateCardId: uuidv7(),
    rateCardRevision: 1,
    rateCardRevisionId: uuidv7(),
    modelConfigId: uuidv7(),
    modelConfigRevision: 1,
    currency: "USD",
    billingUsageNormalizerKey: "test.billing-standard",
    effectiveFrom: 0,
    effectiveTo: null,
    pricingRuleId: "DEFAULT",
    pricingRuleKind: "DEFAULT",
    timeZone: null,
    priceLines: [priceLine("STANDARD_INPUT", 7_000_000)],
    ...overrides,
  };
}

test("AI M3A migration creates normalized accounting tables without raw content or secrets", () => {
  const fixture = createFixture();
  try {
    assert.equal(getContentDatabaseStatus(fixture.database).migrationsApplied, 14);
    for (const table of [
      "ai_rate_cards",
      "ai_rate_card_revisions",
      "ai_rate_card_price_lines",
      "ai_rate_card_time_bands",
      "ai_cost_operations",
      "ai_usage_cost_records",
      "ai_cost_corrections",
    ]) {
      assert.ok(fixture.database.client.prepare("select name from sqlite_master where type='table' and name=?").get(table));
      const columns = fixture.database.client.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>;
      assert.equal(columns.some((column) => ["secret", "api_key", "ciphertext", "prompt", "message", "answer", "message_text", "answer_text"].includes(column.name)), false);
    }
  } finally {
    fixture.close();
  }
});

test("Rate Cards are governed, target exact published Model revisions, and preserve historical revisions", async () => {
  const fixture = createFixture();
  try {
    const provider = await createProvider(fixture);
    const modelId = await publishModel(fixture, provider.id);
    const originalModel = fixture.models.getById(modelId);
    assert.ok(originalModel);
    updateModel(fixture, modelId, { providerModelId: "opaque-model-revision-2" });
    assert.equal(fixture.models.getById(modelId)?.revision, 2);
    const historicalModel = new SQLiteAIRateCardModelRevisionRepository(fixture.database).get(modelId, 1);
    assert.equal(historicalModel?.providerModelId, originalModel.providerModelId);
    const firstContent = rateCardContent(modelId, { key: "historical-rate-card", effectiveFrom: BASE_TIME, effectiveTo: BASE_TIME + 1_000 });
    const id = uuidv7();
    const draft = fixture.changes.createChangeSet({
      title: "Governed Rate Card",
      initialItem: {
        resourceType: AI_RATE_CARD_RESOURCE_TYPE,
        resourceId: id,
        operation: "CREATE",
        expectedRevision: 0,
        desired: firstContent,
      },
    }, fixture.owner);
    assert.equal(fixture.rates.getById(id), null);
    const submitted = fixture.changes.submit(draft.changeSet.id, draft.changeSet.revision, fixture.owner);
    const approved = fixture.changes.approve(submitted.changeSet.id, submitted.changeSet.revision, fixture.owner);
    assert.equal(fixture.rates.getById(id), null);
    fixture.changes.publish(approved.changeSet.id, approved.changeSet.revision, fixture.owner);
    assert.equal(fixture.rates.getCurrentRevision(id)?.revision, 1);

    const secondContent = rateCardContent(modelId, {
      key: firstContent.key,
      effectiveFrom: BASE_TIME + 1_000,
      effectiveTo: null,
      priceLines: firstContent.priceLines.map((line) => line.component === "OUTPUT" ? { ...line, amountNano: 22_000_000 } : line),
    });
    updateRateCard(fixture, id, secondContent, 1);
    const oldRevision = fixture.rates.getRevision(id, 1);
    const newRevision = fixture.rates.getRevision(id, 2);
    assert.equal(oldRevision?.priceLines.find((line) => line.component === "OUTPUT")?.amountNano, 11_000_000);
    assert.equal(newRevision?.priceLines.find((line) => line.component === "OUTPUT")?.amountNano, 22_000_000);

    const resolver = new AIRateCardResolver(
      fixture.rates,
      new SQLiteAIRateCardModelRevisionRepository(fixture.database),
    );
    assert.equal(resolver.resolve({ modelConfigId: modelId, modelConfigRevision: 1, at: BASE_TIME + 500 }).rateCardRevision, 1);
    assert.equal(resolver.resolve({ modelConfigId: modelId, modelConfigRevision: 1, at: BASE_TIME + 1_500 }).rateCardRevision, 2);
    assert.throws(
      () => resolver.resolve({ modelConfigId: modelId, modelConfigRevision: 99, at: BASE_TIME + 1_500 }),
      (error) => error instanceof AIAccountingError && error.code === "AI_MODEL_REVISION_NOT_FOUND",
    );
    assert.equal(JSON.stringify(draft).includes(provider.secret), false);
  } finally {
    fixture.close();
  }
});

test("Rate Card publication rejects overlapping windows and invalid recurring bands", async () => {
  const fixture = createFixture();
  try {
    const provider = await createProvider(fixture);
    const modelId = await publishModel(fixture, provider.id);
    const first = rateCardContent(modelId, { key: "window-one", effectiveFrom: BASE_TIME, effectiveTo: BASE_TIME + 1_000 });
    publishRateCard(fixture, first);
    const overlapping = rateCardContent(modelId, { key: "window-two", effectiveFrom: BASE_TIME + 500, effectiveTo: BASE_TIME + 1_500 });
    const overlappingId = uuidv7();
    const draft = fixture.changes.createChangeSet({
      title: "Overlapping Rate Card",
      initialItem: {
        resourceType: AI_RATE_CARD_RESOURCE_TYPE,
        resourceId: overlappingId,
        operation: "CREATE",
        expectedRevision: 0,
        desired: overlapping,
      },
    }, fixture.owner);
    const submitted = fixture.changes.submit(draft.changeSet.id, draft.changeSet.revision, fixture.owner);
    const approved = fixture.changes.approve(submitted.changeSet.id, submitted.changeSet.revision, fixture.owner);
    assert.throws(
      () => fixture.changes.publish(approved.changeSet.id, approved.changeSet.revision, fixture.owner),
      /overlap|Rate Card/i,
    );
    assert.equal(fixture.rates.getById(overlappingId), null);

    assert.throws(
      () => normalizeAIRateCardContent(rateCardContent(modelId, {
        key: "invalid-band",
        timeBands: [{
          timeZone: "UTC",
          daysOfWeekMask: 1,
          startMinute: 1_380,
          endMinute: 60,
          priceLines: [priceLine("OUTPUT", 2_000_000)],
        }],
      })),
      (error) => error instanceof AIAccountingError && error.code === "AI_RATE_CARD_INVALID",
    );
    assert.throws(
      () => normalizeAIRateCardContent(rateCardContent(modelId, {
        key: "invalid-zone",
        timeBands: [{
          timeZone: "Not/An_IANA_Zone",
          daysOfWeekMask: 1,
          startMinute: 60,
          endMinute: 120,
          priceLines: [priceLine("OUTPUT", 2_000_000)],
        }],
      })),
      (error) => error instanceof AIAccountingError && error.code === "AI_RATE_CARD_INVALID",
    );
    assert.throws(
      () => normalizeAIRateCardContent(rateCardContent(modelId, {
        key: "overlapping-bands",
        timeBands: [
          { timeZone: "UTC", daysOfWeekMask: 1, startMinute: 60, endMinute: 120, priceLines: [priceLine("OUTPUT", 2_000_000)] },
          { timeZone: "UTC", daysOfWeekMask: 1, startMinute: 119, endMinute: 180, priceLines: [priceLine("OUTPUT", 3_000_000)] },
        ],
      })),
      (error) => error instanceof AIAccountingError && error.code === "AI_RATE_CARD_INVALID",
    );
  } finally {
    fixture.close();
  }
});

test("Rate Card resolution uses one exact effective revision and configured timezone bands", async () => {
  const fixture = createFixture();
  try {
    const provider = await createProvider(fixture);
    const modelId = await publishModel(fixture, provider.id);
    const id = publishRateCard(fixture, rateCardContent(modelId, {
      key: "timezone-rate-card",
      effectiveFrom: 0,
      priceLines: [priceLine("OUTPUT", 11_000_000)],
      timeBands: [{
        timeZone: "America/New_York",
        daysOfWeekMask: 1,
        startMinute: 9 * 60,
        endMinute: 11 * 60,
        priceLines: [priceLine("OUTPUT", 22_000_000)],
      }],
    }));
    const resolver = new AIRateCardResolver(fixture.rates, new SQLiteAIRateCardModelRevisionRepository(fixture.database));
    const mondayTenAmNewYork = Date.UTC(2024, 0, 1, 15, 0);
    const mondayNoonNewYork = Date.UTC(2024, 0, 1, 17, 0);
    const tuesdayTenAmNewYork = Date.UTC(2024, 0, 2, 15, 0);
    const inBand = resolver.resolve({ modelConfigId: modelId, modelConfigRevision: 1, at: mondayTenAmNewYork });
    assert.equal(inBand.rateCardId, id);
    assert.equal(inBand.pricingRuleKind, "TIME_BAND");
    assert.equal(inBand.priceLines[0].amountNano, 22_000_000);
    assert.equal(resolver.resolve({ modelConfigId: modelId, modelConfigRevision: 1, at: mondayNoonNewYork }).pricingRuleKind, "DEFAULT");
    assert.equal(resolver.resolve({ modelConfigId: modelId, modelConfigRevision: 1, at: tuesdayTenAmNewYork }).pricingRuleKind, "DEFAULT");
    publishRateCard(fixture, rateCardContent(modelId, {
      key: "ambiguous-eur-rate-card",
      currency: "EUR",
      effectiveFrom: 0,
    }));
    assert.throws(
      () => resolver.resolve({ modelConfigId: modelId, modelConfigRevision: 1, at: mondayNoonNewYork }),
      (error) => error instanceof AIAccountingError && error.code === "AI_RATE_CARD_AMBIGUOUS",
    );
    const modelWithoutRateCard = await publishModel(fixture, provider.id);
    assert.throws(
      () => resolver.resolve({ modelConfigId: modelWithoutRateCard, modelConfigRevision: 1, at: BASE_TIME }),
      (error) => error instanceof AIAccountingError && error.code === "AI_RATE_CARD_NOT_FOUND",
    );
  } finally {
    fixture.close();
  }
});

test("Cost calculator uses exact nano arithmetic, ceiling division, zero, unknown, and overflow rules", () => {
  const calculator = new AICostCalculator();
  const rateCard = resolvedRateCard({
    priceLines: [priceLine("STANDARD_INPUT", 7_000_000), priceLine("REQUEST", 0)],
  });
  const exact = calculator.calculate(rateCard, {
    standardInputTokens: 1_000_001,
    cacheHitInputTokens: null,
    cacheMissInputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    requestUnits: 0,
  });
  assert.equal(exact.knownCostNano, 7_000_007);
  assert.equal(exact.completeness, "COMPLETE");
  assert.equal(calculator.calculate(rateCard, {
    standardInputTokens: 0,
    cacheHitInputTokens: null,
    cacheMissInputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    requestUnits: 0,
  }).knownCostNano, 0);
  const partial = calculator.calculate(rateCard, {
    standardInputTokens: null,
    cacheHitInputTokens: null,
    cacheMissInputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    requestUnits: 0,
  });
  assert.equal(partial.completeness, "PARTIAL");
  assert.deepEqual(partial.missingComponents, ["STANDARD_INPUT"]);
  const unpricedRateCard = resolvedRateCard({ priceLines: [priceLine("OUTPUT", 1_000_000)] });
  assert.throws(
    () => calculator.calculate(unpricedRateCard, {
      standardInputTokens: 1,
      cacheHitInputTokens: null,
      cacheMissInputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      requestUnits: 0,
    }),
    (error) => error instanceof AIAccountingError && error.code === "AI_RATE_CARD_INCOMPLETE",
  );
  assert.throws(
    () => calculator.calculate(rateCard, {
      standardInputTokens: Number.MAX_SAFE_INTEGER,
      cacheHitInputTokens: null,
      cacheMissInputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      requestUnits: 0,
    }),
    (error) => error instanceof AIAccountingError && error.code === "AI_COST_OVERFLOW",
  );
});

test("Billing normalizers are explicit and cache quantities are not charged through raw input twice", () => {
  const registry = new AIBillingUsageNormalizerRegistry([
    new StandardBillingNormalizer(),
    new CacheAwareBillingNormalizer(),
  ]);
  const context: AIBillingUsageNormalizationContext = {
    modelConfigId: uuidv7(),
    modelConfigRevision: 1,
    providerConfigId: uuidv7(),
    providerConfigRevision: 1,
    capability: "GENERATION",
    providerModelId: "opaque-model",
  };
  const normalized = registry.normalize("test.billing-cache-aware", usage({
    inputTokens: 100,
    cacheHitInputTokens: 40,
    cacheMissInputTokens: 60,
    outputTokens: 20,
    reasoningTokens: 5,
  }), context);
  assert.equal(normalized.standardInputTokens, null);
  assert.equal(normalized.cacheHitInputTokens, 40);
  assert.equal(normalized.cacheMissInputTokens, 60);
  assert.equal(normalized.requestUnits, 1);
  assert.throws(
    () => registry.require("test.missing-normalizer"),
    (error) => error instanceof AIAccountingError && error.code === "AI_BILLING_NORMALIZER_NOT_FOUND",
  );
  assert.throws(
    () => registry.normalize("test.billing-standard", usage({ inputTokens: -1 }), context),
    (error) => error instanceof AIAccountingError && error.code === "AI_BILLING_USAGE_INVALID",
  );
});

test("Accounting records retain immutable attempt metadata and corrections add deltas without rewriting history", async () => {
  const fixture = createFixture();
  try {
    const provider = await createProvider(fixture);
    const modelId = await publishModel(fixture, provider.id);
    const rateCardId = publishRateCard(fixture, rateCardContent(modelId, {
      key: "accounting-rate-card",
      effectiveFrom: 0,
      priceLines: [priceLine("STANDARD_INPUT", 7_000_000), priceLine("OUTPUT", 11_000_000), priceLine("REQUEST", 1_000_000)],
    }));
    const rateResolver = new AIRateCardResolver(fixture.rates, new SQLiteAIRateCardModelRevisionRepository(fixture.database));
    const normalizers = new AIBillingUsageNormalizerRegistry([new StandardBillingNormalizer()]);
    const service = new AICostAccountingService({
      rateCardResolver: rateResolver,
      billingNormalizers: normalizers,
      costCalculator: new AICostCalculator(),
      accounting: fixture.accounting,
    });
    const operation = service.createOperation({
      costCenter: "STUDENT_GENERATION",
      idempotencyKey: "accounting-test-1",
      opaquePrincipalRef: null,
      subjectKey: "arabic",
      conversationId: null,
      responseId: null,
      jobId: null,
      evalRunId: null,
      knowledgeRevision: null,
      status: "OPEN",
      startedAt: BASE_TIME,
      completedAt: null,
    });
    assert.equal(JSON.stringify(operation).includes("prompt"), false);
    const attempt = generationAttempt(modelId, provider.id);
    const recorded = service.recordAttempt({
      operationId: operation.id,
      attempt,
      normalizedUsage: usage({ inputTokens: 1_000_001, outputTokens: 20 }),
      capability: "GENERATION",
      providerModelId: "opaque-model",
      at: BASE_TIME + 10,
    });
    assert.equal(recorded.record.rateCardId, rateCardId);
    assert.equal(recorded.record.rateCardRevisionId, recorded.rateCard.rateCardRevisionId);
    assert.equal(recorded.record.knownCostNano, 8_000_227);
    assert.equal(recorded.record.costCompleteness, "COMPLETE");
    const original = fixture.accounting.getUsageCostRecord(recorded.record.id);
    assert.equal(original?.knownCostNano, recorded.record.knownCostNano);
    const correction = service.appendCorrection({
      originalRecordId: recorded.record.id,
      currency: "USD",
      deltaCostNano: 500,
      reasonCode: "PROVIDER_RECONCILIATION",
      actorType: "ADMIN",
      actorUserId: fixture.owner.actorUserId,
      createdAt: BASE_TIME + 20,
    });
    assert.equal(correction.deltaCostNano, 500);
    assert.equal(fixture.accounting.getUsageCostRecord(recorded.record.id)?.knownCostNano, 8_000_227);
    assert.deepEqual(fixture.accounting.getOperationCostSummary(operation.id).totals, [{ currency: "USD", totalNano: 8_000_727 }]);
    assert.throws(
      () => service.appendCorrection({
        originalRecordId: recorded.record.id,
        currency: "EUR",
        deltaCostNano: 1,
        reasonCode: "WRONG_CURRENCY",
        actorType: "SYSTEM",
        actorUserId: null,
        createdAt: BASE_TIME + 30,
      }),
      (error) => error instanceof AIAccountingError && error.code === "AI_ACCOUNTING_CONFLICT",
    );
    service.completeOperation(operation.id, "OPEN", "COMPLETED", BASE_TIME + 40);
    assert.equal(fixture.accounting.getOperation(operation.id)?.status, "COMPLETED");
  } finally {
    fixture.close();
  }
});

test("Accounting queries keep currencies separate and expose cost-center/model/provider/subject dimensions", async () => {
  const fixture = createFixture();
  try {
    const provider = await createProvider(fixture);
    const modelId = await publishModel(fixture, provider.id);
    const usdId = publishRateCard(fixture, rateCardContent(modelId, { key: "usd-query-card", effectiveFrom: 0, effectiveTo: BASE_TIME + 100 }));
    const eurId = publishRateCard(fixture, rateCardContent(modelId, { key: "eur-query-card", currency: "EUR", effectiveFrom: BASE_TIME + 100, effectiveTo: null }));
    const revisionUsd = fixture.rates.getCurrentRevision(usdId);
    const revisionEur = fixture.rates.getCurrentRevision(eurId);
    assert.ok(revisionUsd);
    assert.ok(revisionEur);
    const operation = fixture.accounting.createOperation({
      id: uuidv7(),
      content: {
        costCenter: "KNOWLEDGE_INDEXING",
        idempotencyKey: null,
        opaquePrincipalRef: null,
        subjectKey: "arabic",
        conversationId: null,
        responseId: null,
        jobId: null,
        evalRunId: null,
        knowledgeRevision: 1,
        status: "OPEN",
        startedAt: BASE_TIME,
        completedAt: null,
      },
    });
    const baseRecord = {
      operationId: operation.id,
      gatewayRequestId: null,
      attemptIndex: null,
      capability: "EMBEDDING" as const,
      modelConfigId: modelId,
      modelConfigRevision: 1,
      providerConfigId: provider.id,
      providerConfigRevision: 1,
      providerRequestId: null,
      rateCardId: usdId,
      rateCardRevision: revisionUsd.revision,
      rateCardRevisionId: revisionUsd.revisionId,
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
      knownCostNano: 100,
      costCompleteness: "COMPLETE" as const,
      costBasis: "RATE_CARD" as const,
      attemptStatus: "SUCCEEDED" as const,
      startedAt: BASE_TIME,
      completedAt: BASE_TIME + 1,
      latencyMs: 1,
    };
    fixture.accounting.appendUsageCostRecord({ id: uuidv7(), content: baseRecord, createdAt: BASE_TIME + 1 });
    fixture.accounting.appendUsageCostRecord({
      id: uuidv7(),
      content: { ...baseRecord, rateCardId: eurId, rateCardRevision: revisionEur.revision, rateCardRevisionId: revisionEur.revisionId, currency: "EUR", knownCostNano: 200 },
      createdAt: BASE_TIME + 2,
    });
    assert.deepEqual(fixture.accounting.getOperationCostSummary(operation.id).totals, [
      { currency: "EUR", totalNano: 200 },
      { currency: "USD", totalNano: 100 },
    ]);
    assert.deepEqual(fixture.accounting.listTotalsByPeriod({ from: BASE_TIME, to: BASE_TIME + 100, dimension: "costCenter" }), [
      { dimensionValue: "KNOWLEDGE_INDEXING", currency: "EUR", totalNano: 200 },
      { dimensionValue: "KNOWLEDGE_INDEXING", currency: "USD", totalNano: 100 },
    ]);
    assert.deepEqual(fixture.accounting.listTotalsByPeriod({ from: BASE_TIME, to: BASE_TIME + 100, dimension: "model" }).map((item) => item.dimensionValue), [modelId, modelId]);
  } finally {
    fixture.close();
  }
});

test("Generation usage accumulator uses maximum best-known snapshots and never sums cumulative usage", () => {
  const accumulator = new AIGenerationUsageAccumulator();
  accumulator.observeGatewayEvent({ type: "USAGE", usage: usage({ inputTokens: 100, outputTokens: null }) });
  accumulator.observeGatewayEvent({ type: "COMPLETED", finishReason: "STOP", usage: usage({ inputTokens: 100, outputTokens: 20 }) });
  accumulator.observe(usage({ inputTokens: 120, outputTokens: 10 }));
  accumulator.observe(usage({ inputTokens: 100, outputTokens: 30 }));
  assert.deepEqual(accumulator.snapshot(), {
    inputTokens: 120,
    outputTokens: 30,
    reasoningTokens: null,
    cacheHitInputTokens: null,
    cacheMissInputTokens: null,
  });
});
