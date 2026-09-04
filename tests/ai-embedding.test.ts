import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";
import { eq } from "drizzle-orm";

import type { AdminActor } from "../src/server/admin-auth/contracts";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import {
  AIBudgetAdmissionService,
} from "../src/server/ai/admission";
import {
  AIProviderGateway,
  AIProviderAdapterError,
  ProviderAdapterRegistry,
  type EmbeddingProviderAdapter,
  type EmbeddingProviderRequest,
  type EmbeddingProviderResult,
  type ProviderAdapterExecutionContext,
} from "../src/server/ai/gateway";
import {
  AICostAccountingService,
  AICostCalculator,
  AIBillingUsageNormalizerRegistry,
  AIRateCardResolver,
  SQLiteAIAccountingRepository,
  SQLiteAIRateCardModelRevisionRepository,
  SQLiteAIRateCardRepository,
} from "../src/server/ai/economics";
import {
  AIEmbeddingError,
  AIEmbeddingProjectionHealthService,
  AIEmbeddingProjectionRecoveryService,
  AIEmbeddingProjectionService,
  AI_EMBEDDING_JOB_KIND,
  AI_EMBEDDING_JOB_PAYLOAD_VERSION,
  AI_EMBEDDING_MAX_BATCH_SIZE,
  AI_EMBEDDING_MAX_DIMENSIONS,
  AI_EMBEDDING_VECTOR_CODEC_KEY,
  AI_EMBEDDING_VECTOR_CODEC_REVISION,
  AI_EMBEDDING_VECTOR_INDEX_ADAPTER_KEY,
  Float32LEEmbeddingVectorCodec,
  SQLiteAIEmbeddingProjectionRepository,
  SQLiteAIVectorIndexAdapter,
  type AIEmbeddingPendingTerminalProjection,
  createAIEmbeddingJobHandler,
  createSQLiteAIEmbeddingCostEstimator,
  type AIEmbeddingVector,
} from "../src/server/ai/embedding";
import {
  AIJobError,
  AIJobHandlerRegistry,
  AIJobQueueService,
} from "../src/server/ai/operations/jobs";
import { AIWorker } from "../src/server/ai/operations/worker";
import {
  AIChunkProjectionBuilder,
  AIRetrievalProjectionHealthService,
  SQLiteAIRetrievalProjectionRepository,
} from "../src/server/ai/retrieval";
import {
  AI_SECRET_KEY_BYTES,
  createLocalAISecretStore,
  type LocalEncryptedAISecretStore,
} from "../src/server/ai/secrets";
import {
  SQLiteAIModelConfigRepository,
} from "../src/server/ai/model-registry";
import {
  SQLiteAIProviderConfigRepository,
} from "../src/server/ai/configuration";
import {
  SQLiteAIBudgetPolicyRepository,
} from "../src/server/ai/budget";
import {
  SQLiteAIRateLimitPolicyRepository,
} from "../src/server/ai/rate-limits";
import { createCanonicalContentRepository } from "../src/server/canonical-content/service";
import type {
  AIKnowledgePackageDocument,
  AIKnowledgeSourceContent,
} from "../src/server/ai/knowledge";
import {
  SQLiteAIKnowledgePackageRepository,
  SQLiteAIKnowledgeSourceRepository,
} from "../src/server/ai/knowledge";
import type { ContentDatabase } from "../src/server/content";
import { openContentDatabase } from "../src/server/content";
import {
  aiCostOperations,
  aiEmbeddingProjectionRevisions,
  aiEmbeddingVectors,
  aiJobs,
  questionPackages,
  questionPrimaryVariants,
  questionVariants,
  questions,
} from "../src/server/content/schema";
import type { CanonicalRichDocument } from "../src/server/questions/contracts";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const masterKey = Buffer.alloc(AI_SECRET_KEY_BYTES, 0x5a);

type EmbeddingBehavior = (request: EmbeddingProviderRequest, context: ProviderAdapterExecutionContext) => Promise<EmbeddingProviderResult>;

class FakeEmbeddingAdapter implements EmbeddingProviderAdapter {
  readonly adapterKey = "test.fake-embedding";
  readonly capability = "EMBEDDING" as const;
  calls = 0;
  requests: EmbeddingProviderRequest[] = [];
  credentials: string[] = [];
  behavior: EmbeddingBehavior;

  constructor(behavior?: EmbeddingBehavior) {
    this.behavior = behavior ?? (async (request) => ({
      vectors: request.inputs.map((_, index) => index % 3 === 0 ? [1, 0, 0] : index % 3 === 1 ? [0, 1, 0] : [1, 1, 0]),
      dimensions: 3,
      usage: {
        inputTokens: request.inputs.reduce((sum, input) => sum + Buffer.byteLength(input, "utf8"), 0),
        outputTokens: null,
        reasoningTokens: null,
        cacheHitInputTokens: null,
        cacheMissInputTokens: null,
      },
    }));
  }

  embed(request: EmbeddingProviderRequest, context: ProviderAdapterExecutionContext): Promise<EmbeddingProviderResult> {
    this.calls += 1;
    this.requests.push(request);
    this.credentials.push(context.credential);
    return this.behavior(request, context);
  }
}

interface EmbeddingFixture {
  root: string;
  now: number;
  setNow(value: number): void;
  database: ContentDatabase;
  owner: AdminActor;
  secrets: LocalEncryptedAISecretStore;
  sourceRepository: SQLiteAIKnowledgeSourceRepository;
  packageRepository: SQLiteAIKnowledgePackageRepository;
  providers: SQLiteAIProviderConfigRepository;
  models: SQLiteAIModelConfigRepository;
  modelId: string;
  providerId: string;
  credentialRef: string;
  budgetPolicyId: string;
  rateLimitPolicyId: string;
  fake: FakeEmbeddingAdapter;
  embedding: AIEmbeddingProjectionService;
  embeddingRepository: SQLiteAIEmbeddingProjectionRepository;
  vectorIndex: SQLiteAIVectorIndexAdapter;
  health: AIEmbeddingProjectionHealthService;
  jobs: AIJobQueueService;
  worker: AIWorker;
  close(): void;
}

async function fixture(options: { budgetCapNano?: number; behavior?: EmbeddingBehavior; terminalReconciliationBatchSize?: number } = {}): Promise<EmbeddingFixture> {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-m7b-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  const canonical = createCanonicalContentRepository(database);
  canonical.bootstrap();
  const identities = new SQLiteAdminIdentityRepository(database);
  const ownerUser = identities.createInitialOwner({ id: uuidv7(), email: `owner-${uuidv7()}@m7b.test`, displayName: "M7B Owner", passwordHash: "fixture", createdAt: 1_900_300_000_000 });
  const owner: AdminActor = { actorUserId: ownerUser.id, actorRole: "OWNER" };
  let now = 1_900_300_100_000;
  const secrets = createLocalAISecretStore(database, { masterKey, clock: () => now });
  const secret = `m7b-secret-${uuidv7()}`;
  const credential = await secrets.create({ secret, actor: { type: "ADMIN", actorUserId: owner.actorUserId } });
  const providers = new SQLiteAIProviderConfigRepository(database);
  const providerId = uuidv7();
  providers.create({
    id: providerId,
    content: {
      key: `m7b-provider-${uuidv7()}`,
      displayName: "M7B Provider",
      baseUrl: "https://provider.example/v1",
      credentialRef: credential.credentialRef,
      enabled: true,
      retentionPolicy: "UNKNOWN",
      trainingPolicy: "UNKNOWN",
      zdrSupported: false,
      zdrRequired: false,
    },
    actor: owner,
    now: now - 3_000,
  });
  const models = new SQLiteAIModelConfigRepository(database);
  const modelId = uuidv7();
  models.create({
    id: modelId,
    content: {
      key: `m7b-model-${uuidv7()}`,
      displayName: "M7B Embedding Model",
      providerConfigId: providerId,
      providerModelId: "m7b-embedding-test",
      capability: "EMBEDDING",
      adapterKey: "test.fake-embedding",
      enabled: true,
      contextWindowTokens: null,
      maxOutputTokens: null,
      embeddingDimensions: 3,
      supportsStreaming: false,
      supportsReasoning: false,
      supportsStructuredOutput: false,
    },
    actor: owner,
    now: now - 2_000,
  });
  const budgetPolicyId = uuidv7();
  new SQLiteAIBudgetPolicyRepository(database).create({
    id: budgetPolicyId,
    content: {
      key: `m7b-budget-${uuidv7()}`,
      displayName: "M7B Budget",
      currency: "USD",
      costCenter: "KNOWLEDGE_INDEXING",
      hardCapNano: options.budgetCapNano ?? 1_000_000_000,
      enabled: true,
    },
    actor: owner,
    now: now - 1_500,
  });
  const rateLimitPolicyId = uuidv7();
  new SQLiteAIRateLimitPolicyRepository(database).create({
    id: rateLimitPolicyId,
    content: {
      key: `m7b-rate-${uuidv7()}`,
      displayName: "M7B Rate Limit",
      windowMs: 60_000,
      maxRequests: 100,
      maxConcurrentRequests: 100,
      enabled: true,
    },
    actor: owner,
    now: now - 1_000,
  });
  const rateCards = new SQLiteAIRateCardRepository(database);
  rateCards.create({
    id: uuidv7(),
    content: {
      key: `m7b-rate-card-${uuidv7()}`,
      displayName: "M7B Rate Card",
      modelConfigId: modelId,
      modelConfigRevision: 1,
      currency: "USD",
      billingUsageNormalizerKey: "m7b.embedding",
      effectiveFrom: 0,
      effectiveTo: null,
      enabled: true,
      priceLines: [
        { component: "STANDARD_INPUT", unit: "PER_MILLION_TOKENS", amountNano: 1_000_000 },
        { component: "REQUEST", unit: "PER_REQUEST", amountNano: 100 },
      ],
      timeBands: [],
    },
    actor: owner,
    now: now - 500,
  });
  assert.equal(rateCards.listResolutionRevisions({ modelConfigId: modelId, modelConfigRevision: 1, at: now }).length, 1);
  const accountingRepository = new SQLiteAIAccountingRepository(database);
  const accounting = new AICostAccountingService({
    rateCardResolver: new AIRateCardResolver(rateCards, new SQLiteAIRateCardModelRevisionRepository(database)),
    billingNormalizers: new AIBillingUsageNormalizerRegistry([{
      key: "m7b.embedding",
      normalize: (usage) => ({
        standardInputTokens: usage.inputTokens,
        cacheHitInputTokens: usage.cacheHitInputTokens,
        cacheMissInputTokens: usage.cacheMissInputTokens,
        outputTokens: usage.outputTokens,
        reasoningTokens: usage.reasoningTokens,
        requestUnits: 1,
      }),
    }]),
    costCalculator: new AICostCalculator(),
    accounting: accountingRepository,
  });
  const fake = new FakeEmbeddingAdapter(options.behavior);
  const adapters = new ProviderAdapterRegistry([fake]);
  const gateway = new AIProviderGateway({ providerConfigs: providers, modelConfigs: models, secrets, adapters }, { clock: () => now });
  // Keep the registry explicit so the Worker and M7B Job handler share one closed registry.
  const jobHandlers = new AIJobHandlerRegistry();
  const jobQueue = new AIJobQueueService(database, jobHandlers, { clock: () => now });
  const embeddingRepository = new SQLiteAIEmbeddingProjectionRepository(database);
  const admission = new AIBudgetAdmissionService(database);
  const embedding = new AIEmbeddingProjectionService(database, {
    models,
    providers,
    secrets,
    adapters,
    gateway,
    jobs: jobQueue,
    admission,
    accounting,
    costEstimator: createSQLiteAIEmbeddingCostEstimator(new AIRateCardResolver(rateCards, new SQLiteAIRateCardModelRevisionRepository(database))),
    projections: embeddingRepository,
    clock: () => now,
  });
  jobHandlers.register(createAIEmbeddingJobHandler(embedding));
  const vectorIndex = new SQLiteAIVectorIndexAdapter(database, { isRevisionSearchable: (revision) => embedding.isRevisionSearchable(revision) });
  const health = new AIEmbeddingProjectionHealthService(database, { projections: embeddingRepository, vectorIndex, models });
  const terminalRecovery = new AIEmbeddingProjectionRecoveryService({ projections: embeddingRepository, admission, accounting });
  const worker = new AIWorker({ jobs: jobQueue, handlers: jobHandlers, terminalReconciler: terminalRecovery, terminalReconciliationBatchSize: options.terminalReconciliationBatchSize, workerId: `m7b-worker-${uuidv7()}`, clock: () => now });
  return {
    root,
    now,
    setNow(value: number) { now = value; },
    database,
    owner,
    secrets,
    sourceRepository: new SQLiteAIKnowledgeSourceRepository(database),
    packageRepository: new SQLiteAIKnowledgePackageRepository(database),
    providers,
    models,
    modelId,
    providerId,
    credentialRef: credential.credentialRef,
    budgetPolicyId,
    rateLimitPolicyId,
    fake,
    embedding,
    embeddingRepository,
    vectorIndex,
    health,
    jobs: jobQueue,
    worker,
    close() {
      database.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
    },
  };
}

function paragraph(text: string): CanonicalRichDocument {
  return { type: "doc", version: 1, blocks: [{ id: uuidv7(), type: "paragraph", spans: [{ text }] }] };
}

function sourceContent(subjectKey = "arabic", overrides: Partial<AIKnowledgeSourceContent> = {}): AIKnowledgeSourceContent {
  return {
    key: `m7b-source-${subjectKey}-${uuidv7()}`,
    subjectKey,
    sourceType: "OFFICIAL_TEXTBOOK",
    displayName: `M7B ${subjectKey} source`,
    language: "ar",
    edition: "fixture",
    authorityName: "Pythagoras",
    authorityType: "TEST",
    trustTier: "OFFICIAL",
    rightsStatus: "CLEARED",
    rightsBasis: "OWNED",
    licenseName: null,
    attribution: "M7B synthetic fixture",
    rightsNotes: null,
    sourceUrl: "https://example.test/m7b-source",
    sourceAssetId: null,
    enabled: true,
    preparationMethod: "DETERMINISTIC",
    producerKey: "m7b-fixture",
    producerRevision: "1",
    ...overrides,
  };
}

function knowledgeDocument(text: string, order: number): AIKnowledgePackageDocument {
  return { packageRevisionId: "pending", documentId: uuidv7(), displayOrder: order, title: `M7B document ${order}`, provenance: { pageStart: order, section: `M7B section ${order}` }, content: paragraph(text) };
}

function createKnowledge(fixtureValue: EmbeddingFixture, texts: string[], subjectKey = "arabic") {
  const sourceId = uuidv7();
  fixtureValue.sourceRepository.create({ id: sourceId, content: sourceContent(subjectKey), actor: fixtureValue.owner, now: fixtureValue.now - 300 });
  const packageId = uuidv7();
  fixtureValue.packageRepository.create({
    id: packageId,
    content: { key: `m7b-package-${subjectKey}-${uuidv7()}`, subjectKey, title: `M7B ${subjectKey} package`, language: "ar", contentRevision: 1, sourceId, sourceRevision: 1, artifactRef: "a".repeat(64), artifactSha256: "a".repeat(64), artifactByteSize: 1 },
    documents: texts.map((text, index) => knowledgeDocument(text, index + 1)),
    assets: [],
    actor: fixtureValue.owner,
    now: fixtureValue.now - 200,
  });
  const result = new AIChunkProjectionBuilder(fixtureValue.database).build({ originKind: "KNOWLEDGE_PACKAGE", originId: packageId, subjectKey, batchSize: 50 });
  const set = new SQLiteAIRetrievalProjectionRepository(fixtureValue.database).getSet({ originKind: "KNOWLEDGE_PACKAGE", originId: packageId, subjectKey, strategyKey: "structured-rich-v1", normalizerKey: "retrieval-text-v1" });
  assert.ok(set);
  return { packageId, sourceId, m7aRevisionId: result.projectionRevisionId, chunkProjectionSetId: set.id };
}

function updateKnowledge(fixtureValue: EmbeddingFixture, packageId: string, contentRevision: number, texts: string[]): void {
  const current = fixtureValue.packageRepository.getById(packageId)!;
  fixtureValue.packageRepository.appendRevision({
    id: packageId,
    expectedRevision: current.package.currentRevision,
    content: { ...current.revision, contentRevision, artifactRef: "b".repeat(64), artifactSha256: "b".repeat(64), artifactByteSize: 1 },
    documents: texts.map((text, index) => knowledgeDocument(text, index + 1)),
    assets: [],
    actor: fixtureValue.owner,
    now: fixtureValue.now,
  });
}

function createQuestionOrigin(fixtureValue: EmbeddingFixture, text: string) {
  const packageId = uuidv7();
  fixtureValue.database.db.insert(questionPackages).values({
    id: packageId,
    packageKey: `m7b-question-${uuidv7()}`,
    title: "M7B Question Package",
    subjectKey: "arabic",
    language: "ar",
    contentRevision: 1,
    bankBrowseMode: "ALL_PACKAGE_QUESTIONS",
    bankBrowseEntryKey: `m7b-question-entry-${uuidv7()}`,
    bankBrowseEntryLabel: "M7B Question",
    bankBrowseEntryOrder: 999,
    sourceAssetId: null,
    createdAt: fixtureValue.now,
    updatedAt: fixtureValue.now,
    updatedBy: fixtureValue.owner.actorUserId,
    revision: 1,
  }).run();
  const questionId = uuidv7();
  const variantId = uuidv7();
  fixtureValue.database.db.insert(questions).values({ id: questionId, packageId, displayOrder: 1, sharedAnswer: paragraph("جواب السؤال"), createdAt: fixtureValue.now, updatedAt: fixtureValue.now, updatedBy: fixtureValue.owner.actorUserId, revision: 1 }).run();
  fixtureValue.database.db.insert(questionVariants).values({ id: variantId, questionId, displayOrder: 1, content: paragraph(text), createdAt: fixtureValue.now, updatedAt: fixtureValue.now, updatedBy: fixtureValue.owner.actorUserId, revision: 1 }).run();
  fixtureValue.database.db.insert(questionPrimaryVariants).values({ questionId, variantId }).run();
  const m7a = new AIChunkProjectionBuilder(fixtureValue.database).build({ originKind: "QUESTION_PACKAGE", originId: packageId, subjectKey: "arabic" });
  const set = new SQLiteAIRetrievalProjectionRepository(fixtureValue.database).getSet({ originKind: "QUESTION_PACKAGE", originId: packageId, subjectKey: "arabic", strategyKey: "structured-rich-v1", normalizerKey: "retrieval-text-v1" });
  assert.ok(set);
  return { packageId, questionId, m7aRevisionId: m7a.projectionRevisionId, chunkProjectionSetId: set.id };
}

function buildInput(fixtureValue: EmbeddingFixture, chunkProjectionSetId: string, overrides: Partial<{ subjectKey: string; modelConfigId: string; batchSize: number; maxAttempts: number; budgetPolicyId: string; rateLimitPolicyId: string }> = {}) {
  return {
    subjectKey: overrides.subjectKey ?? "arabic",
    chunkProjectionSetId,
    modelConfigId: overrides.modelConfigId ?? fixtureValue.modelId,
    budgetPolicyId: overrides.budgetPolicyId ?? fixtureValue.budgetPolicyId,
    budgetPolicyRevision: 1,
    rateLimitPolicyId: overrides.rateLimitPolicyId ?? fixtureValue.rateLimitPolicyId,
    rateLimitPolicyRevision: 1,
    budgetPeriod: { startAt: fixtureValue.now - 100_000, endAt: fixtureValue.now + 100_000 },
    batchSize: overrides.batchSize,
    maxAttempts: overrides.maxAttempts,
  };
}

function createModel(fixtureValue: EmbeddingFixture, capability: "GENERATION" | "EMBEDDING" | "RERANK", overrides: Record<string, unknown> = {}): string {
  const id = uuidv7();
  fixtureValue.models.create({
    id,
    content: {
      key: `m7b-extra-model-${uuidv7()}`,
      displayName: "M7B extra model",
      providerConfigId: fixtureValue.providerId,
      providerModelId: `m7b-extra-provider-model-${uuidv7()}`,
      capability,
      adapterKey: capability === "EMBEDDING" ? "test.fake-embedding" : "test.unregistered",
      enabled: true,
      contextWindowTokens: capability === "GENERATION" ? 4096 : null,
      maxOutputTokens: capability === "GENERATION" ? 512 : null,
      embeddingDimensions: capability === "EMBEDDING" ? 3 : null,
      supportsStreaming: capability === "GENERATION",
      supportsReasoning: false,
      supportsStructuredOutput: false,
      ...overrides,
    } as never,
    actor: fixtureValue.owner,
    now: fixtureValue.now,
  });
  return id;
}

function vectorFor(fixtureValue: EmbeddingFixture, projectionRevisionId: string, chunkProjectionRevisionId: string, chunkId: string, values: readonly number[] = [1, 0, 0]): AIEmbeddingVector {
  const encoded = new Float32LEEmbeddingVectorCodec().encode(values, values.length);
  return {
    embeddingProjectionRevisionId: projectionRevisionId,
    chunkProjectionRevisionId,
    chunkId,
    subjectKey: "arabic",
    dimensions: values.length,
    vectorBlob: encoded.blob,
    vectorHash: encoded.hash,
    norm: encoded.norm,
    createdAt: fixtureValue.now,
  };
}

interface TerminalBacklogItem {
  jobId: string;
  projectionRevisionId: string;
  costOperationId: string;
}

function createTerminalEmbeddingBacklog(fixtureValue: EmbeddingFixture, count: number): { items: TerminalBacklogItem[]; seed: TerminalBacklogItem } {
  const source = createKnowledge(fixtureValue, ["terminal backlog seed"]);
  const seed = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId, { maxAttempts: 1 }));
  const seedJob = fixtureValue.database.db.select().from(aiJobs).where(eq(aiJobs.id, seed.jobId!)).get();
  const seedRevision = fixtureValue.database.db.select().from(aiEmbeddingProjectionRevisions).where(eq(aiEmbeddingProjectionRevisions.id, seed.embeddingProjectionRevisionId)).get();
  const seedOperation = fixtureValue.database.db.select().from(aiCostOperations).where(eq(aiCostOperations.id, seed.costOperationId!)).get();
  assert.ok(seedJob);
  assert.ok(seedRevision);
  assert.ok(seedOperation);
  fixtureValue.jobs.cancelPending(seed.jobId!, fixtureValue.now);
  const items: TerminalBacklogItem[] = [{ jobId: seed.jobId!, projectionRevisionId: seed.embeddingProjectionRevisionId, costOperationId: seed.costOperationId! }];
  const payloadJson = "{}";
  const payloadHash = createHash("sha256").update(payloadJson).digest("hex");
  for (let index = 0; index < count; index += 1) {
    const jobId = uuidv7();
    const costOperationId = uuidv7();
    const projectionRevisionId = uuidv7();
    const createdAt = fixtureValue.now + index + 1;
    const status = index % 2 === 0 ? "CANCELLED" as const : "DEAD_LETTER" as const;
    fixtureValue.database.db.insert(aiCostOperations).values({
      ...seedOperation,
      id: costOperationId,
      idempotencyKey: `m7b-backlog-${costOperationId}`,
      jobId,
      status: "OPEN",
      startedAt: fixtureValue.now,
      completedAt: null,
    }).run();
    fixtureValue.database.db.insert(aiJobs).values({
      ...seedJob,
      id: jobId,
      payloadJson,
      payloadHash,
      dedupeKey: `m7b-backlog-${jobId}`,
      costOperationId,
      status,
      attemptCount: 0,
      maxAttempts: 1,
      leaseOwner: null,
      leaseToken: null,
      leaseGeneration: 0,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
      lastErrorCode: "AI_TEST_TERMINAL",
      cancellationRequestedAt: status === "CANCELLED" ? createdAt : null,
      createdAt,
      updatedAt: createdAt,
      completedAt: createdAt,
    }).run();
    fixtureValue.database.db.insert(aiEmbeddingProjectionRevisions).values({
      ...seedRevision,
      id: projectionRevisionId,
      revision: seedRevision.revision + index + 1,
      inputFingerprint: createHash("sha256").update(`m7b-terminal-backlog-${index}`).digest("hex"),
      status: "BUILDING",
      isCurrent: false,
      sourceCursor: { kind: "START" },
      batchCount: 0,
      vectorCount: 0,
      jobId,
      costOperationId,
      startedAt: fixtureValue.now,
      updatedAt: createdAt,
      readyAt: null,
      failedAt: null,
      safeErrorCode: null,
    }).run();
    items.push({ jobId, projectionRevisionId, costOperationId });
  }
  return { items, seed: items[0] };
}

function createRestartRecoveryWorker(database: ContentDatabase, now: number, batchSize: number): AIWorker {
  const accountingRepository = new SQLiteAIAccountingRepository(database);
  const accounting: Pick<AICostAccountingService, "getOperation" | "completeOperation"> = {
    getOperation: (id) => accountingRepository.getOperation(id),
    completeOperation: (id, expectedStatus, status, completedAt) => accountingRepository.updateOperationStatus({ id, expectedStatus, status, completedAt }),
  };
  const admission = new AIBudgetAdmissionService(database);
  const projections = new SQLiteAIEmbeddingProjectionRepository(database);
  const handlers = new AIJobHandlerRegistry();
  const jobs = new AIJobQueueService(database, handlers, { clock: () => now });
  const recovery = new AIEmbeddingProjectionRecoveryService({ projections, admission, accounting });
  return new AIWorker({ jobs, handlers, terminalReconciler: recovery, terminalReconciliationBatchSize: batchSize, workerId: `m7b-restarted-worker-${uuidv7()}`, clock: () => now });
}

test("M7B uses the exact current/fresh M7A revision, one model, and a durable reference-only Job", async () => {
  const fixtureValue = await fixture();
  try {
    const source = createKnowledge(fixtureValue, ["السجل الأول", "السجل الثاني"]);
    const result = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId));
    assert.equal(result.status, "BUILDING");
    const job = fixtureValue.jobs.getJob(result.jobId!);
    assert.ok(job);
    assert.equal(job.kind, AI_EMBEDDING_JOB_KIND);
    assert.equal(job.payloadVersion, AI_EMBEDDING_JOB_PAYLOAD_VERSION);
    assert.equal(job.costCenter, "KNOWLEDGE_INDEXING");
    assert.equal(job.payloadJson.includes("السجل الأول"), false);
    assert.equal(job.payloadJson.includes("vectorBlob"), false);
    assert.equal(job.payloadJson.includes("credential"), false);
    const revision = fixtureValue.embeddingRepository.getRevision(result.embeddingProjectionRevisionId)!;
    assert.equal(revision.chunkProjectionRevisionId, source.m7aRevisionId);
    assert.equal(revision.modelConfigRevision, 1);
    assert.equal(revision.providerConfigRevision, 1);
    assert.equal(revision.dimensions, 3);
    assert.equal(revision.vectorCodecKey, AI_EMBEDDING_VECTOR_CODEC_KEY);
    assert.equal(revision.vectorCodecRevision, AI_EMBEDDING_VECTOR_CODEC_REVISION);
    assert.equal(revision.vectorIndexAdapterKey, AI_EMBEDDING_VECTOR_INDEX_ADAPTER_KEY);
    assert.equal(fixtureValue.database.db.select().from(aiEmbeddingVectors).all().length, 0);
  } finally { fixtureValue.close(); }
});

test("M7B embeds bounded batches in exact Chunk order and completes accounting/settlement", async () => {
  const fixtureValue = await fixture();
  try {
    const texts = Array.from({ length: 70 }, (_, index) => `مقطع ${index + 1}`);
    const source = createKnowledge(fixtureValue, texts);
    const result = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId, { batchSize: 32 }));
    const workerResult = await fixtureValue.worker.runOnce(fixtureValue.now);
    assert.equal(workerResult.completedJobId, result.jobId);
    assert.equal(fixtureValue.fake.calls, 3);
    assert.deepEqual(fixtureValue.fake.requests.map((request) => request.inputs.length), [32, 32, 6]);
    assert.deepEqual(fixtureValue.fake.requests.flatMap((request) => [...request.inputs]), texts);
    const revision = fixtureValue.embeddingRepository.getRevision(result.embeddingProjectionRevisionId)!;
    assert.equal(revision.status, "READY");
    assert.equal(revision.isCurrent, true);
    assert.equal(revision.vectorCount, 70);
    assert.equal(fixtureValue.database.db.select().from(aiEmbeddingVectors).all().length, 70);
    const operation = new SQLiteAIAccountingRepository(fixtureValue.database).getOperation(revision.costOperationId)!;
    assert.equal(operation.costCenter, "KNOWLEDGE_INDEXING");
    assert.equal(operation.status, "COMPLETED");
    const reservation = fixtureValue.database.client.prepare("select status from ai_budget_reservations where operation_id=?").get(revision.costOperationId) as { status: string };
    assert.equal(reservation.status, "SETTLED");
  } finally { fixtureValue.close(); }
});

test("exact compatible READY reuse and Job dedupe make a rebuild a zero-Provider-call operation", async () => {
  const fixtureValue = await fixture();
  try {
    const source = createKnowledge(fixtureValue, ["إعادة استخدام"]);
    const first = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId));
    await fixtureValue.worker.runOnce(fixtureValue.now);
    const calls = fixtureValue.fake.calls;
    const second = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId));
    assert.equal(second.reused, true);
    assert.equal(second.embeddingProjectionRevisionId, first.embeddingProjectionRevisionId);
    assert.equal(fixtureValue.fake.calls, calls);
    assert.equal(fixtureValue.database.db.select().from(aiJobs).all().filter((job) => job.kind === AI_EMBEDDING_JOB_KIND).length, 1);
  } finally { fixtureValue.close(); }
});

test("M7A MISSING/BUILDING/STALE prerequisites fail before any Provider call", async () => {
  const fixtureValue = await fixture();
  try {
    const sourceId = uuidv7();
    fixtureValue.sourceRepository.create({ id: sourceId, content: sourceContent(), actor: fixtureValue.owner, now: fixtureValue.now - 300 });
    const packageId = uuidv7();
    fixtureValue.packageRepository.create({ id: packageId, content: { key: `m7b-prereq-${uuidv7()}`, subjectKey: "arabic", title: "Prerequisite", language: "ar", contentRevision: 1, sourceId, sourceRevision: 1, artifactRef: "a".repeat(64), artifactSha256: "a".repeat(64), artifactByteSize: 1 }, documents: [knowledgeDocument("مادة", 1)], assets: [], actor: fixtureValue.owner, now: fixtureValue.now - 200 });
    const m7a = new AIChunkProjectionBuilder(fixtureValue.database);
    const m7aSession = m7a.startBuild({ originKind: "KNOWLEDGE_PACKAGE", originId: packageId, subjectKey: "arabic" });
    const m7aSet = new SQLiteAIRetrievalProjectionRepository(fixtureValue.database).getSet({ originKind: "KNOWLEDGE_PACKAGE", originId: packageId, subjectKey: "arabic", strategyKey: "structured-rich-v1", normalizerKey: "retrieval-text-v1" });
    assert.ok(m7aSet);
    assert.throws(() => fixtureValue.embedding.startBuild(buildInput(fixtureValue, uuidv7())), (error) => error instanceof AIEmbeddingError && error.code === "AI_EMBEDDING_M7A_NOT_READY");
    assert.throws(() => fixtureValue.embedding.startBuild(buildInput(fixtureValue, m7aSet.id)), (error) => error instanceof AIEmbeddingError && error.code === "AI_EMBEDDING_M7A_NOT_READY");
    m7a.processNextBatch(m7aSession.projectionRevision.id);
    m7a.finalize(m7aSession.projectionRevision.id);
    const source = { packageId, sourceId, chunkProjectionSetId: m7aSet.id };
    const started = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId));
    const currentSource = fixtureValue.sourceRepository.getById(source.sourceId)!;
    fixtureValue.sourceRepository.appendRevision({ id: source.sourceId, expectedRevision: currentSource.currentRevision, content: sourceContent("arabic", { key: currentSource.key, enabled: false, rightsStatus: "RESTRICTED", rightsBasis: null }), actor: fixtureValue.owner, now: fixtureValue.now });
    const workerResult = await fixtureValue.worker.runOnce(fixtureValue.now);
    assert.equal(workerResult.completedJobId, null);
    assert.equal(fixtureValue.fake.calls, 0);
    assert.equal(fixtureValue.embeddingRepository.getRevision(started.embeddingProjectionRevisionId)?.status, "FAILED");
  } finally { fixtureValue.close(); }
});

test("M7B validates embedding capability, enabled state, dimensions, and registered adapter before scheduling work", async () => {
  const fixtureValue = await fixture();
  try {
    const source = createKnowledge(fixtureValue, ["تهيئة النموذج"]);
    const generationId = createModel(fixtureValue, "GENERATION");
    const rerankId = createModel(fixtureValue, "RERANK");
    const missingDimensionsId = createModel(fixtureValue, "EMBEDDING", { embeddingDimensions: null });
    const missingAdapterId = createModel(fixtureValue, "EMBEDDING", { adapterKey: "test.missing-embedding" });
    for (const modelConfigId of [generationId, rerankId, missingDimensionsId, missingAdapterId]) {
      assert.throws(() => fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId, { modelConfigId })), (error) => error instanceof AIEmbeddingError && ["AI_EMBEDDING_MODEL_INVALID", "AI_EMBEDDING_ADAPTER_INVALID"].includes(error.code));
    }
    const current = fixtureValue.models.getById(fixtureValue.modelId)!;
    fixtureValue.models.update({ id: current.id, expectedRevision: current.revision, content: { ...current, enabled: false }, actor: fixtureValue.owner, now: fixtureValue.now });
    assert.throws(() => fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId)), (error) => error instanceof AIEmbeddingError && error.code === "AI_EMBEDDING_MODEL_INVALID");
  } finally { fixtureValue.close(); }
});

test("the embedding service creates a single-model Gateway plan and never mixes a fallback model", async () => {
  const fixtureValue = await fixture({ behavior: async () => { throw new AIProviderAdapterError("UNAVAILABLE", { retryable: false }); } });
  try {
    const source = createKnowledge(fixtureValue, ["بدون بديل"]);
    const secondModelId = createModel(fixtureValue, "EMBEDDING");
    const result = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId));
    await fixtureValue.worker.runOnce(fixtureValue.now);
    assert.equal(fixtureValue.fake.calls, 1);
    assert.equal(fixtureValue.embeddingRepository.getRevision(result.embeddingProjectionRevisionId)?.status, "FAILED");
    assert.equal(fixtureValue.jobs.listRecent(20).filter((job) => job.kind === AI_EMBEDDING_JOB_KIND).length, 1);
    assert.notEqual(secondModelId, fixtureValue.modelId);
  } finally { fixtureValue.close(); }
});

test("Float32 little-endian codec is deterministic, bounded, finite, and rejects zero/overflow vectors", () => {
  const codec = new Float32LEEmbeddingVectorCodec();
  const first = codec.encode([1, -2, 0.5], 3);
  const second = codec.encode([1, -2, 0.5], 3);
  assert.deepEqual([...first.blob], [...second.blob]);
  assert.equal(first.hash, second.hash);
  assert.deepEqual(codec.decode(first.blob, 3), [1, -2, 0.5]);
  assert.throws(() => codec.encode([0, 0, 0], 3), (error) => error instanceof AIEmbeddingError && error.code === "AI_EMBEDDING_VECTOR_INVALID");
  assert.throws(() => codec.encode([Number.NaN, 0, 1], 3), (error) => error instanceof AIEmbeddingError && error.code === "AI_EMBEDDING_VECTOR_INVALID");
  assert.throws(() => codec.encode([Number.MAX_VALUE, 0, 1], 3), (error) => error instanceof AIEmbeddingError && error.code === "AI_EMBEDDING_VECTOR_INVALID");
  assert.throws(() => codec.encode([1, 2], 3), (error) => error instanceof AIEmbeddingError && error.code === "AI_EMBEDDING_VECTOR_INVALID");
  assert.throws(() => codec.encode([1], AI_EMBEDDING_MAX_DIMENSIONS + 1), (error) => error instanceof AIEmbeddingError && error.code === "AI_EMBEDDING_VECTOR_INVALID");
});

test("local exact vector search uses cosine ordering, deterministic ties, subject scope, and live source rights", async () => {
  const fixtureValue = await fixture();
  try {
    fixtureValue.fake.behavior = async (request) => ({
      vectors: request.inputs.map((input) => input.includes("first") ? [1, 0, 0] : input.includes("second") ? [0, 1, 0] : input.includes("third") ? [1, 1, 0] : [1, 0, 0]),
      dimensions: 3,
      usage: { inputTokens: request.inputs.length, outputTokens: null, reasoningTokens: null, cacheHitInputTokens: null, cacheMissInputTokens: null },
    });
    const arabic = createKnowledge(fixtureValue, ["first vector", "second vector", "third vector"]);
    const arabicBuild = fixtureValue.embedding.startBuild(buildInput(fixtureValue, arabic.chunkProjectionSetId));
    await fixtureValue.worker.runOnce(fixtureValue.now);
    const arabicResults = fixtureValue.vectorIndex.search({ subjectKey: "arabic", embeddingProjectionRevisionId: arabicBuild.embeddingProjectionRevisionId, queryVector: [1, 0, 0], limit: 3 });
    assert.equal(arabicResults.length, 3);
    assert.equal(arabicResults[0].cosineSimilarity, 1);
    assert.equal(arabicResults[0].text.includes("first"), true);
    assert.equal(arabicResults[1].cosineSimilarity > arabicResults[2].cosineSimilarity, true);
    assert.deepEqual(arabicResults.map((item) => item.rank), [1, 2, 3]);

    const ties = createKnowledge(fixtureValue, ["tie-a", "tie-b"]);
    const tiesBuild = fixtureValue.embedding.startBuild(buildInput(fixtureValue, ties.chunkProjectionSetId));
    await fixtureValue.worker.runOnce(fixtureValue.now);
    const tieResults = fixtureValue.vectorIndex.search({ subjectKey: "arabic", embeddingProjectionRevisionId: tiesBuild.embeddingProjectionRevisionId, queryVector: [1, 0, 0], limit: 2 });
    assert.equal(tieResults.length, 2);
    assert.equal(tieResults[0].cosineSimilarity, tieResults[1].cosineSimilarity);
    assert.equal(tieResults[0].chunkId.localeCompare(tieResults[1].chunkId) < 0, true);

    const biology = createKnowledge(fixtureValue, ["biology vector"], "biology");
    const biologyBuild = fixtureValue.embedding.startBuild(buildInput(fixtureValue, biology.chunkProjectionSetId, { subjectKey: "biology" }));
    await fixtureValue.worker.runOnce(fixtureValue.now);
    assert.throws(() => fixtureValue.vectorIndex.search({ subjectKey: "arabic", embeddingProjectionRevisionId: biologyBuild.embeddingProjectionRevisionId, queryVector: [1, 0, 0] }), (error) => error instanceof AIEmbeddingError && error.code === "AI_EMBEDDING_SUBJECT_INVALID");
    assert.throws(() => fixtureValue.vectorIndex.search({ subjectKey: "unknown", embeddingProjectionRevisionId: arabicBuild.embeddingProjectionRevisionId, queryVector: [1, 0, 0] }), (error) => error instanceof AIEmbeddingError && error.code === "AI_EMBEDDING_SUBJECT_INVALID");
    assert.throws(() => fixtureValue.vectorIndex.search({ subjectKey: "arabic", embeddingProjectionRevisionId: arabicBuild.embeddingProjectionRevisionId, queryVector: [1, 0] }), (error) => error instanceof AIEmbeddingError && error.code === "AI_EMBEDDING_VECTOR_INVALID");
    assert.throws(() => fixtureValue.vectorIndex.search({ subjectKey: "arabic", embeddingProjectionRevisionId: arabicBuild.embeddingProjectionRevisionId, queryVector: [0, 0, 0] }), (error) => error instanceof AIEmbeddingError && error.code === "AI_EMBEDDING_VECTOR_INVALID");
    assert.throws(() => fixtureValue.vectorIndex.search({ subjectKey: "arabic", embeddingProjectionRevisionId: arabicBuild.embeddingProjectionRevisionId, queryVector: [Number.POSITIVE_INFINITY, 0, 1] }), (error) => error instanceof AIEmbeddingError && error.code === "AI_EMBEDDING_VECTOR_INVALID");

    const source = fixtureValue.sourceRepository.getById(arabic.sourceId)!;
    fixtureValue.sourceRepository.appendRevision({ id: arabic.sourceId, expectedRevision: source.currentRevision, content: sourceContent("arabic", { key: source.key, enabled: false, rightsStatus: "RESTRICTED", rightsBasis: null }), actor: fixtureValue.owner, now: fixtureValue.now });
    assert.deepEqual(fixtureValue.vectorIndex.search({ subjectKey: "arabic", embeddingProjectionRevisionId: arabicBuild.embeddingProjectionRevisionId, queryVector: [1, 0, 0] }), []);
    const restricted = fixtureValue.sourceRepository.getById(arabic.sourceId)!;
    fixtureValue.sourceRepository.appendRevision({ id: arabic.sourceId, expectedRevision: restricted.currentRevision, content: sourceContent("arabic", { key: source.key, enabled: true, rightsStatus: "CLEARED", rightsBasis: "OWNED" }), actor: fixtureValue.owner, now: fixtureValue.now });
    assert.equal(fixtureValue.vectorIndex.search({ subjectKey: "arabic", embeddingProjectionRevisionId: arabicBuild.embeddingProjectionRevisionId, queryVector: [1, 0, 0] }).length, 3);
  } finally { fixtureValue.close(); }
});

test("vector ownership is exact, replay is idempotent, conflicts do not overwrite, and incomplete coverage cannot become READY", async () => {
  const fixtureValue = await fixture();
  try {
    const source = createKnowledge(fixtureValue, ["ملكية دقيقة"]);
    const started = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId));
    const embeddingRevision = fixtureValue.embeddingRepository.getRevision(started.embeddingProjectionRevisionId)!;
    const m7aChunk = new SQLiteAIRetrievalProjectionRepository(fixtureValue.database).listChunks(source.m7aRevisionId)[0];
    assert.ok(m7aChunk);
    const valid = vectorFor(fixtureValue, embeddingRevision.id, source.m7aRevisionId, m7aChunk.chunkId);
    assert.equal(fixtureValue.vectorIndex.persistBatch({ projectionRevisionId: embeddingRevision.id, vectors: [valid] }).insertedVectors, 1);
    assert.equal(fixtureValue.vectorIndex.persistBatch({ projectionRevisionId: embeddingRevision.id, vectors: [valid] }).insertedVectors, 0);
    assert.throws(() => fixtureValue.vectorIndex.persistBatch({ projectionRevisionId: embeddingRevision.id, vectors: [vectorFor(fixtureValue, embeddingRevision.id, source.m7aRevisionId, m7aChunk.chunkId, [0, 1, 0])] }), (error) => error instanceof AIEmbeddingError && error.code === "AI_EMBEDDING_VECTOR_CONFLICT");
    for (const mismatch of [
      { subjectKey: "biology" },
      { chunkProjectionRevisionId: uuidv7() },
      { chunkId: uuidv7() },
      { dimensions: 4 },
    ]) {
      const candidate = "dimensions" in mismatch
        ? vectorFor(fixtureValue, embeddingRevision.id, source.m7aRevisionId, m7aChunk.chunkId, [1, 0, 0, 0])
        : { ...valid, ...mismatch } as AIEmbeddingVector;
      assert.throws(() => fixtureValue.vectorIndex.persistBatch({ projectionRevisionId: embeddingRevision.id, vectors: [candidate] }), (error) => error instanceof AIEmbeddingError && error.code === "AI_EMBEDDING_VECTOR_OWNERSHIP");
    }
    const coverage = fixtureValue.vectorIndex.getCoverage({ projectionRevisionId: embeddingRevision.id, chunkProjectionRevisionId: source.m7aRevisionId, chunkCount: 1 });
    assert.equal(coverage.complete, true);

    const incompleteSource = createKnowledge(fixtureValue, ["نقص واحد", "نقص اثنان"]);
    const incomplete = fixtureValue.embedding.startBuild(buildInput(fixtureValue, incompleteSource.chunkProjectionSetId));
    const incompleteRevision = fixtureValue.embeddingRepository.getRevision(incomplete.embeddingProjectionRevisionId)!;
    const incompleteChunks = new SQLiteAIRetrievalProjectionRepository(fixtureValue.database).listChunks(incompleteSource.m7aRevisionId);
    const firstVector = vectorFor(fixtureValue, incompleteRevision.id, incompleteSource.m7aRevisionId, incompleteChunks[0].chunkId);
    fixtureValue.vectorIndex.persistBatch({ projectionRevisionId: incompleteRevision.id, vectors: [firstVector] });
    fixtureValue.embeddingRepository.advanceBatch({ revisionId: incompleteRevision.id, sourceCursor: { kind: "DONE" }, batchCount: 1, vectorCount: 1, now: fixtureValue.now });
    assert.equal(fixtureValue.vectorIndex.getCoverage({ projectionRevisionId: incompleteRevision.id, chunkProjectionRevisionId: incompleteSource.m7aRevisionId, chunkCount: 2 }).missingVectorCount, 1);
    assert.throws(() => fixtureValue.embeddingRepository.finalizeReady(incompleteRevision.id, fixtureValue.now), /coverage|activate|embedding/i);
  } finally { fixtureValue.close(); }
});

test("Embedding Projection Set/Revision lifecycle and READY demotion are enforced by SQLite", async () => {
  const fixtureValue = await fixture();
  try {
    const source = createKnowledge(fixtureValue, ["دورة الحياة"]);
    const building = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId));
    const set = fixtureValue.embeddingRepository.getSetById(building.embeddingProjectionSetId)!;
    const revision = fixtureValue.embeddingRepository.getRevision(building.embeddingProjectionRevisionId)!;
    for (const [column, value] of [
      ["subject_key", "biology"],
      ["chunk_projection_set_id", uuidv7()],
      ["model_config_id", uuidv7()],
      ["vector_codec_revision", 2],
      ["vector_index_adapter_key", "another-index"],
      ["created_at", fixtureValue.now + 1],
    ] as Array<[string, string | number]>) {
      assert.throws(() => fixtureValue.database.client.prepare(`update ai_embedding_projection_sets set ${column}=? where id=?`).run(value, set.id), /immutable/i);
    }
    for (const [column, value] of [
      ["chunk_projection_revision_id", uuidv7()],
      ["chunk_count", revision.chunkCount + 1],
      ["model_config_revision", 2],
      ["provider_config_revision", 2],
      ["dimensions", 4],
      ["input_fingerprint", "b".repeat(64)],
      ["job_id", uuidv7()],
      ["started_at", fixtureValue.now + 1],
    ] as Array<[string, string | number]>) {
      assert.throws(() => fixtureValue.database.client.prepare(`update ai_embedding_projection_revisions set ${column}=? where id=?`).run(value, revision.id), /immutable|lifecycle/i);
    }

    await fixtureValue.worker.runOnce(fixtureValue.now);
    const ready = fixtureValue.embeddingRepository.getRevision(revision.id)!;
    assert.equal(ready.status, "READY");
    assert.throws(() => fixtureValue.database.client.prepare("update ai_embedding_projection_revisions set status='FAILED', is_current=0, failed_at=?, updated_at=?, safe_error_code='DIRECT_FAILURE' where id=?").run(fixtureValue.now, fixtureValue.now, ready.id), /lifecycle/i);
    assert.throws(() => fixtureValue.database.client.prepare("update ai_embedding_projection_revisions set status='BUILDING', is_current=0, ready_at=null, updated_at=? where id=?").run(fixtureValue.now, ready.id), /lifecycle/i);
    assert.equal(fixtureValue.embeddingRepository.getCurrentRevision(set.id)?.id, ready.id);

    const failedSource = createKnowledge(fixtureValue, ["Revision فاشلة"]);
    const failed = fixtureValue.embedding.startBuild(buildInput(fixtureValue, failedSource.chunkProjectionSetId));
    fixtureValue.embeddingRepository.markFailed(failed.embeddingProjectionRevisionId, "AI_EMBEDDING_PROJECTION_FAILED", fixtureValue.now);
    fixtureValue.jobs.cancelPending(failed.jobId!, fixtureValue.now);
    assert.throws(() => fixtureValue.database.client.prepare("update ai_embedding_projection_revisions set status='BUILDING', failed_at=null, safe_error_code=null, updated_at=? where id=?").run(fixtureValue.now, failed.embeddingProjectionRevisionId), /lifecycle/i);
    assert.throws(() => fixtureValue.database.client.prepare("update ai_embedding_projection_revisions set status='READY', is_current=1, failed_at=null, ready_at=?, source_cursor=? where id=?").run(fixtureValue.now, JSON.stringify({ kind: "DONE" }), failed.embeddingProjectionRevisionId), /lifecycle/i);

    const oldSnapshot = { ...ready };
    updateKnowledge(fixtureValue, source.packageId, 2, ["دورة الحياة الجديدة"]);
    new AIChunkProjectionBuilder(fixtureValue.database).build({ originKind: "KNOWLEDGE_PACKAGE", originId: source.packageId, subjectKey: "arabic" });
    const next = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId));
    await fixtureValue.worker.runOnce(fixtureValue.now);
    const demoted = fixtureValue.embeddingRepository.getRevision(ready.id)!;
    assert.equal(demoted.status, "READY");
    assert.equal(demoted.isCurrent, false);
    assert.deepEqual({ ...demoted, isCurrent: oldSnapshot.isCurrent }, oldSnapshot);
    assert.equal(fixtureValue.embeddingRepository.getCurrentRevision(next.embeddingProjectionSetId)?.id, next.embeddingProjectionRevisionId);
  } finally { fixtureValue.close(); }
});

test("READY embedding vectors reject direct update/delete and historical READY metadata remains stable", async () => {
  const fixtureValue = await fixture();
  try {
    const source = createKnowledge(fixtureValue, ["لا تعدل المتجه"]);
    const result = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId));
    await fixtureValue.worker.runOnce(fixtureValue.now);
    const revision = fixtureValue.embeddingRepository.getRevision(result.embeddingProjectionRevisionId)!;
    const vector = fixtureValue.vectorIndex.getVector({ projectionRevisionId: revision.id, chunkProjectionRevisionId: revision.chunkProjectionRevisionId, chunkId: new SQLiteAIRetrievalProjectionRepository(fixtureValue.database).listChunks(source.m7aRevisionId)[0].chunkId })!;
    assert.throws(() => fixtureValue.database.client.prepare("update ai_embedding_vectors set vector_hash=? where embedding_projection_revision_id=? and chunk_projection_revision_id=? and chunk_id=?").run("b".repeat(64), vector.embeddingProjectionRevisionId, vector.chunkProjectionRevisionId, vector.chunkId), /immutable/i);
    assert.throws(() => fixtureValue.database.client.prepare("delete from ai_embedding_vectors where embedding_projection_revision_id=? and chunk_projection_revision_id=? and chunk_id=?").run(vector.embeddingProjectionRevisionId, vector.chunkProjectionRevisionId, vector.chunkId), /READY|immutable/i);
    assert.equal(fixtureValue.embeddingRepository.getCurrentRevision(result.embeddingProjectionSetId)?.id, revision.id);
  } finally { fixtureValue.close(); }
});

test("Model/Provider revision changes stop a BUILDING projection and do not mix vector spaces", async () => {
  for (const changed of ["model", "provider"] as const) {
    const fixtureValue = await fixture();
    try {
      const source = createKnowledge(fixtureValue, [`تغيير ${changed}`]);
      const result = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId));
      if (changed === "model") {
        const model = fixtureValue.models.getById(fixtureValue.modelId)!;
        fixtureValue.models.update({ id: model.id, expectedRevision: model.revision, content: { ...model, displayName: "Model revision 2" }, actor: fixtureValue.owner, now: fixtureValue.now });
      } else {
        const provider = fixtureValue.providers.getById(fixtureValue.providerId)!;
        fixtureValue.providers.update({ id: provider.id, expectedRevision: provider.revision, content: { ...provider, displayName: "Provider revision 2" }, actor: fixtureValue.owner, now: fixtureValue.now });
      }
      const workerResult = await fixtureValue.worker.runOnce(fixtureValue.now);
      assert.equal(workerResult.completedJobId, null);
      assert.equal(fixtureValue.fake.calls, 0);
      assert.equal(fixtureValue.embeddingRepository.getRevision(result.embeddingProjectionRevisionId)?.status, "FAILED");
      assert.equal(fixtureValue.health.getHealth({ embeddingProjectionSetId: result.embeddingProjectionSetId }).status, "FAILED");
    } finally { fixtureValue.close(); }
  }
});

test("Secret rotation changes only the request credential, not the pinned embedding space", async () => {
  const fixtureValue = await fixture();
  try {
    const source = createKnowledge(fixtureValue, ["دوران السر"]);
    const result = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId));
    const newSecret = `m7b-rotated-${uuidv7()}`;
    await fixtureValue.secrets.rotate({ credentialRef: fixtureValue.credentialRef, secret: newSecret, actor: { type: "ADMIN", actorUserId: fixtureValue.owner.actorUserId } });
    await fixtureValue.worker.runOnce(fixtureValue.now);
    const revision = fixtureValue.embeddingRepository.getRevision(result.embeddingProjectionRevisionId)!;
    assert.equal(revision.status, "READY");
    assert.equal(revision.modelConfigRevision, 1);
    assert.equal(revision.providerConfigRevision, 1);
    assert.equal(fixtureValue.fake.credentials.every((credential) => credential === newSecret), true);
  } finally { fixtureValue.close(); }
});

test("retryable Provider failure keeps the Embedding Projection BUILDING and later retry resumes it", async () => {
  let first = true;
  const fixtureValue = await fixture({ behavior: async (request) => {
    if (first) {
      first = false;
      throw new AIProviderAdapterError("UNAVAILABLE", { retryable: true });
    }
    return {
      vectors: request.inputs.map(() => [1, 0, 0]),
      dimensions: 3,
      usage: { inputTokens: request.inputs.length, outputTokens: null, reasoningTokens: null, cacheHitInputTokens: null, cacheMissInputTokens: null },
    };
  }});
  try {
    const source = createKnowledge(fixtureValue, ["محاولة أولى", "محاولة ثانية"]);
    const result = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId, { maxAttempts: 2 }));
    await fixtureValue.worker.runOnce(fixtureValue.now);
    assert.equal(fixtureValue.fake.calls, 1);
    assert.equal(fixtureValue.embeddingRepository.getRevision(result.embeddingProjectionRevisionId)?.status, "BUILDING");
    const retryJob = fixtureValue.jobs.getJob(result.jobId!)!;
    assert.equal(retryJob.status, "RETRY_WAIT");
    fixtureValue.now = retryJob.scheduledAt;
    fixtureValue.setNow(retryJob.scheduledAt);
    await fixtureValue.worker.runOnce(retryJob.scheduledAt);
    assert.equal(fixtureValue.fake.calls, 2);
    assert.equal(fixtureValue.embeddingRepository.getRevision(result.embeddingProjectionRevisionId)?.status, "READY");
    const reservation = fixtureValue.database.client.prepare("select status from ai_budget_reservations where operation_id=?").get(result.costOperationId) as { status: string };
    assert.equal(reservation.status, "RECONCILIATION_REQUIRED");
  } finally { fixtureValue.close(); }
});

test("budget denial fails closed with zero Provider calls", async () => {
  const fixtureValue = await fixture({ budgetCapNano: 0 });
  try {
    const source = createKnowledge(fixtureValue, ["ميزانية صفر"]);
    const result = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId));
    await fixtureValue.worker.runOnce(fixtureValue.now);
    assert.equal(fixtureValue.fake.calls, 0);
    assert.equal(fixtureValue.embeddingRepository.getRevision(result.embeddingProjectionRevisionId)?.status, "FAILED");
    assert.equal(new SQLiteAIAccountingRepository(fixtureValue.database).getOperation(result.costOperationId!)?.status, "FAILED");
  } finally { fixtureValue.close(); }
});

test("durable embedding Job lease recovery resumes from the persisted cursor", async () => {
  const fixtureValue = await fixture();
  try {
    const source = createKnowledge(fixtureValue, ["استئناف بعد انتهاء القفل"]);
    const result = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId));
    const abandoned = fixtureValue.jobs.claimNext({ workerId: "abandoned-worker", supportedKinds: [AI_EMBEDDING_JOB_KIND], now: fixtureValue.now });
    assert.ok(abandoned);
    fixtureValue.now = abandoned.job.leaseExpiresAt! + 1;
    fixtureValue.setNow(fixtureValue.now);
    const recoveryTick = await fixtureValue.worker.runOnce(fixtureValue.now);
    assert.equal(recoveryTick.claimedJobId, null);
    const retryJob = fixtureValue.jobs.getJob(result.jobId!)!;
    fixtureValue.now = retryJob.scheduledAt;
    fixtureValue.setNow(retryJob.scheduledAt);
    const recovered = await fixtureValue.worker.runOnce(retryJob.scheduledAt);
    assert.equal(recovered.completedJobId, result.jobId);
    assert.equal(fixtureValue.embeddingRepository.getRevision(result.embeddingProjectionRevisionId)?.status, "READY");
    assert.equal(fixtureValue.jobs.listAttempts(result.jobId!).length, 2);
    assert.equal(fixtureValue.jobs.listAttempts(result.jobId!)[0].outcome, "LEASE_EXPIRED");
    assert.equal(fixtureValue.fake.calls, 1);
  } finally { fixtureValue.close(); }
});

test("terminal maxAttempts=1 lease recovery fails the embedding projection and cost operation", async () => {
  const fixtureValue = await fixture();
  try {
    const source = createKnowledge(fixtureValue, ["terminal lease expiry"]);
    const result = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId, { maxAttempts: 1 }));
    const claimed = fixtureValue.jobs.claimNext({ workerId: "terminal-expiry-worker", supportedKinds: [AI_EMBEDDING_JOB_KIND], now: fixtureValue.now });
    assert.ok(claimed);
    const expiredAt = claimed.job.leaseExpiresAt! + 1;
    fixtureValue.now = expiredAt;
    fixtureValue.setNow(expiredAt);
    const recovery = await fixtureValue.worker.runOnce(expiredAt);
    assert.equal(recovery.recoveredJobs, 1);
    assert.equal(fixtureValue.jobs.getJob(result.jobId!)?.status, "DEAD_LETTER");
    assert.equal(fixtureValue.embeddingRepository.getRevision(result.embeddingProjectionRevisionId)?.status, "FAILED");
    assert.equal(new SQLiteAIAccountingRepository(fixtureValue.database).getOperation(result.costOperationId!)?.status, "FAILED");
    assert.equal((fixtureValue.database.client.prepare("select count(*) as count from ai_embedding_vectors where embedding_projection_revision_id=?").get(result.embeddingProjectionRevisionId) as { count: number }).count, 0);

    const failedRevision = fixtureValue.embeddingRepository.getRevision(result.embeddingProjectionRevisionId)!;
    await fixtureValue.worker.runOnce(expiredAt);
    assert.deepEqual(fixtureValue.embeddingRepository.getRevision(result.embeddingProjectionRevisionId), failedRevision);
    assert.equal(fixtureValue.fake.calls, 0);
  } finally { fixtureValue.close(); }
});

test("final lease loss after Provider usage writes zero vectors and terminally reconciles cost/admission", async () => {
  const fixtureValue = await fixture();
  try {
    fixtureValue.fake.behavior = async (request) => {
      fixtureValue.jobs.recoverExpiredLeases(fixtureValue.now + 200_000);
      return {
        vectors: request.inputs.map(() => [1, 0, 0]),
        dimensions: 3,
        usage: { inputTokens: request.inputs.length, outputTokens: null, reasoningTokens: null, cacheHitInputTokens: null, cacheMissInputTokens: null },
      };
    };
    const source = createKnowledge(fixtureValue, ["usage before lease loss"]);
    const result = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId, { maxAttempts: 1 }));
    const workerResult = await fixtureValue.worker.runOnce(fixtureValue.now);
    assert.equal(workerResult.completedJobId, null);
    assert.equal(fixtureValue.fake.calls, 1);
    assert.equal(fixtureValue.jobs.getJob(result.jobId!)?.status, "DEAD_LETTER");
    assert.equal(fixtureValue.embeddingRepository.getRevision(result.embeddingProjectionRevisionId)?.status, "FAILED");
    assert.equal(new SQLiteAIAccountingRepository(fixtureValue.database).listUsageCostRecords(result.costOperationId!).length, 1);
    assert.equal(new SQLiteAIAccountingRepository(fixtureValue.database).getOperation(result.costOperationId!)?.status, "FAILED");
    assert.equal((fixtureValue.database.client.prepare("select count(*) as count from ai_embedding_vectors where embedding_projection_revision_id=?").get(result.embeddingProjectionRevisionId) as { count: number }).count, 0);
    assert.equal((fixtureValue.database.client.prepare("select status from ai_budget_reservations where operation_id=?").get(result.costOperationId!) as { status: string }).status, "SETTLED");

    const failedRevision = fixtureValue.embeddingRepository.getRevision(result.embeddingProjectionRevisionId)!;
    await fixtureValue.worker.runOnce(fixtureValue.now);
    assert.deepEqual(fixtureValue.embeddingRepository.getRevision(result.embeddingProjectionRevisionId), failedRevision);
    assert.equal(fixtureValue.fake.calls, 1);
  } finally { fixtureValue.close(); }
});

test("cancelled embedding Jobs reconcile BUILDING projections without invoking a Provider", async () => {
  const fixtureValue = await fixture();
  try {
    const source = createKnowledge(fixtureValue, ["cancelled embedding"]);
    const result = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId));
    fixtureValue.jobs.cancelPending(result.jobId!, fixtureValue.now);
    await fixtureValue.worker.runOnce(fixtureValue.now);
    assert.equal(fixtureValue.jobs.getJob(result.jobId!)?.status, "CANCELLED");
    assert.equal(fixtureValue.embeddingRepository.getRevision(result.embeddingProjectionRevisionId)?.status, "FAILED");
    assert.equal(new SQLiteAIAccountingRepository(fixtureValue.database).getOperation(result.costOperationId!)?.status, "FAILED");
    assert.equal((fixtureValue.database.client.prepare("select count(*) as count from ai_budget_reservations where operation_id=?").get(result.costOperationId!) as { count: number }).count, 0);
    assert.equal(fixtureValue.fake.calls, 0);
  } finally { fixtureValue.close(); }
});

test("bounded terminal recovery drains older embedding backlog instead of rescanning reconciled terminal Jobs", async () => {
  const fixtureValue = await fixture({ terminalReconciliationBatchSize: 25 });
  try {
    const backlog = createTerminalEmbeddingBacklog(fixtureValue, 150);
    const accounting = new SQLiteAIAccountingRepository(fixtureValue.database);
    const alreadyReconciledAt = fixtureValue.now + 10_000;
    for (const item of backlog.items.slice(-10)) {
      fixtureValue.embeddingRepository.markFailed(item.projectionRevisionId, "AI_TEST_ALREADY_RECONCILED", alreadyReconciledAt);
      accounting.updateOperationStatus({ id: item.costOperationId, expectedStatus: "OPEN", status: "FAILED", completedAt: alreadyReconciledAt });
    }

    let totalReconciled = 0;
    for (let tick = 0; tick < 20; tick += 1) {
      const result = await fixtureValue.worker.runOnce(fixtureValue.now);
      totalReconciled += result.terminalReconciliation?.reconciled ?? 0;
      if (backlog.items.every((item) => fixtureValue.embeddingRepository.getRevision(item.projectionRevisionId)?.status === "FAILED")) break;
    }
    assert.equal(totalReconciled, 141);
    assert.equal(backlog.items.every((item) => fixtureValue.embeddingRepository.getRevision(item.projectionRevisionId)?.status === "FAILED"), true);
    assert.equal(backlog.items.every((item) => accounting.getOperation(item.costOperationId)?.status === "FAILED"), true);
    assert.equal(backlog.items.every((item) => accounting.listUsageCostRecords(item.costOperationId).length === 0), true);
    assert.equal(fixtureValue.fake.calls, 0);

    const emptyTick = await fixtureValue.worker.runOnce(fixtureValue.now);
    assert.deepEqual(emptyTick.terminalReconciliation, { scanned: 0, reconciled: 0, skipped: 0 });
  } finally { fixtureValue.close(); }
});

test("terminal embedding backlog recovery resumes from durable unresolved state after process restart", async () => {
  const fixtureValue = await fixture({ terminalReconciliationBatchSize: 25 });
  let databaseReopened = false;
  let reopened: ContentDatabase | null = null;
  try {
    const backlog = createTerminalEmbeddingBacklog(fixtureValue, 60);
    const firstTick = await fixtureValue.worker.runOnce(fixtureValue.now);
    assert.equal(firstTick.terminalReconciliation?.reconciled, 25);
    assert.ok(backlog.items.some((item) => fixtureValue.embeddingRepository.getRevision(item.projectionRevisionId)?.status === "BUILDING"));
    const root = fixtureValue.root;
    fixtureValue.database.close();
    databaseReopened = true;
    reopened = openContentDatabase({ dataDirectory: root, migrationsDirectory });
    const restartedWorker = createRestartRecoveryWorker(reopened, fixtureValue.now + 20_000, 25);
    for (let tick = 0; tick < 10; tick += 1) {
      await restartedWorker.runOnce(fixtureValue.now + 20_000);
      const remaining = new SQLiteAIEmbeddingProjectionRepository(reopened);
      if (backlog.items.every((item) => remaining.getRevision(item.projectionRevisionId)?.status === "FAILED")) break;
    }
    const restartedRepository = new SQLiteAIEmbeddingProjectionRepository(reopened);
    assert.equal(backlog.items.every((item) => restartedRepository.getRevision(item.projectionRevisionId)?.status === "FAILED"), true);
    const restartedAccounting = new SQLiteAIAccountingRepository(reopened);
    assert.equal(backlog.items.every((item) => restartedAccounting.getOperation(item.costOperationId)?.status === "FAILED"), true);
    assert.equal(backlog.items.every((item) => restartedAccounting.listUsageCostRecords(item.costOperationId).length === 0), true);
  } finally {
    if (!databaseReopened) fixtureValue.close();
    reopened?.close();
    if (databaseReopened) rmSync(fixtureValue.root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  }
});

test("malformed embedding Job payload does not block relational terminal reconciliation", async () => {
  const fixtureValue = await fixture();
  try {
    const source = createKnowledge(fixtureValue, ["malformed terminal payload"]);
    const result = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId));
    fixtureValue.jobs.cancelPending(result.jobId!, fixtureValue.now);
    const payloadJson = "{}";
    fixtureValue.database.client.prepare("update ai_jobs set payload_json=?, payload_hash=? where id=?").run(payloadJson, createHash("sha256").update(payloadJson).digest("hex"), result.jobId);
    const tick = await fixtureValue.worker.runOnce(fixtureValue.now);
    assert.equal(tick.terminalReconciliation?.reconciled, 1);
    assert.equal(fixtureValue.embeddingRepository.getRevision(result.embeddingProjectionRevisionId)?.status, "FAILED");
    assert.equal(new SQLiteAIAccountingRepository(fixtureValue.database).getOperation(result.costOperationId!)?.status, "FAILED");
    assert.equal(fixtureValue.fake.calls, 0);
  } finally { fixtureValue.close(); }
});

test("unrelated terminal Jobs do not poison the bounded embedding recovery batch", async () => {
  const fixtureValue = await fixture({ terminalReconciliationBatchSize: 25 });
  try {
    const backlog = createTerminalEmbeddingBacklog(fixtureValue, 2);
    const template = fixtureValue.database.db.select().from(aiJobs).where(eq(aiJobs.id, backlog.seed.jobId)).get();
    assert.ok(template);
    const unrelatedId = uuidv7();
    const payloadJson = "{}";
    fixtureValue.database.db.insert(aiJobs).values({
      ...template,
      id: unrelatedId,
      kind: "ai.unrelated-terminal",
      payloadJson,
      payloadHash: createHash("sha256").update(payloadJson).digest("hex"),
      dedupeKey: `m7b-unrelated-${unrelatedId}`,
      costOperationId: null,
      status: "DEAD_LETTER",
      attemptCount: 0,
      leaseOwner: null,
      leaseToken: null,
      leaseGeneration: 0,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
      lastErrorCode: "AI_TEST_UNRELATED",
      cancellationRequestedAt: null,
      completedAt: fixtureValue.now,
    }).run();
    const tick = await fixtureValue.worker.runOnce(fixtureValue.now);
    assert.equal(tick.terminalReconciliation?.reconciled, 3);
    assert.equal(backlog.items.every((item) => fixtureValue.embeddingRepository.getRevision(item.projectionRevisionId)?.status === "FAILED"), true);
    assert.equal(fixtureValue.jobs.getJob(unrelatedId)?.status, "DEAD_LETTER");
    assert.equal(fixtureValue.fake.calls, 0);
  } finally { fixtureValue.close(); }
});

test("one unreconcilable embedding item is skipped without blocking the rest of its batch", async () => {
  const fixtureValue = await fixture({ terminalReconciliationBatchSize: 25 });
  try {
    const backlog = createTerminalEmbeddingBacklog(fixtureValue, 2);
    const realRepository = fixtureValue.embeddingRepository;
    const pending = backlog.items.map((item): AIEmbeddingPendingTerminalProjection => {
      const job = fixtureValue.jobs.getJob(item.jobId)!;
      assert.ok(job.status === "CANCELLED" || job.status === "DEAD_LETTER");
      return {
        revision: realRepository.getRevision(item.projectionRevisionId)!,
        job: {
          id: job.id,
          kind: job.kind,
          payloadVersion: job.payloadVersion,
          status: job.status,
          costOperationId: job.costOperationId,
        },
      };
    });
    const realAccounting = new SQLiteAIAccountingRepository(fixtureValue.database);
    const accounting: Pick<AICostAccountingService, "getOperation" | "completeOperation"> = {
      getOperation: (id) => id === backlog.items[0].costOperationId ? null : realAccounting.getOperation(id),
      completeOperation: (id, expectedStatus, status, completedAt) => realAccounting.updateOperationStatus({ id, expectedStatus, status, completedAt }),
    };
    const recovery = new AIEmbeddingProjectionRecoveryService({
      projections: {
        listRevisionsByJobId: realRepository.listRevisionsByJobId.bind(realRepository),
        listPendingTerminalReconciliations: (limit) => pending.slice(0, limit),
        markFailed: realRepository.markFailed.bind(realRepository),
      },
      admission: new AIBudgetAdmissionService(fixtureValue.database),
      accounting,
    });
    const result = recovery.reconcilePending({ limit: 2, now: fixtureValue.now });
    assert.deepEqual(result, { scanned: 2, reconciled: 1, skipped: 1 });
    assert.equal(realRepository.getRevision(backlog.items[0].projectionRevisionId)?.status, "BUILDING");
    assert.equal(realRepository.getRevision(backlog.items[1].projectionRevisionId)?.status, "FAILED");
    assert.equal(realRepository.getRevision(backlog.items[2].projectionRevisionId)?.status, "BUILDING");
    assert.equal(fixtureValue.fake.calls, 0);
  } finally { fixtureValue.close(); }
});

test("a stale worker cannot persist vectors after Provider return, while actual usage remains accounted", async () => {
  const fixtureValue = await fixture();
  try {
    fixtureValue.fake.behavior = async (request) => {
      fixtureValue.jobs.recoverExpiredLeases(fixtureValue.now + 200_000);
      return {
        vectors: request.inputs.map(() => [1, 0, 0]),
        dimensions: 3,
        usage: { inputTokens: request.inputs.length, outputTokens: null, reasoningTokens: null, cacheHitInputTokens: null, cacheMissInputTokens: null },
      };
    };
    const source = createKnowledge(fixtureValue, ["استدعاء سابق"]);
    const result = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId));
    const firstWorker = await fixtureValue.worker.runOnce(fixtureValue.now);
    assert.equal(firstWorker.completedJobId, null);
    assert.equal(fixtureValue.fake.calls, 1);
    assert.equal(fixtureValue.embeddingRepository.getRevision(result.embeddingProjectionRevisionId)?.status, "BUILDING");
    assert.equal((fixtureValue.database.client.prepare("select count(*) as count from ai_embedding_vectors where embedding_projection_revision_id=?").get(result.embeddingProjectionRevisionId) as { count: number }).count, 0);
    assert.equal(new SQLiteAIAccountingRepository(fixtureValue.database).listUsageCostRecords(result.costOperationId!).length, 1);
    const retryJob = fixtureValue.jobs.getJob(result.jobId!)!;
    fixtureValue.fake.behavior = async (request) => ({
      vectors: request.inputs.map(() => [1, 0, 0]),
      dimensions: 3,
      usage: { inputTokens: request.inputs.length, outputTokens: null, reasoningTokens: null, cacheHitInputTokens: null, cacheMissInputTokens: null },
    });
    fixtureValue.now = retryJob.scheduledAt;
    fixtureValue.setNow(retryJob.scheduledAt);
    const resumed = await fixtureValue.worker.runOnce(retryJob.scheduledAt);
    assert.equal(resumed.completedJobId, result.jobId);
    assert.equal(fixtureValue.embeddingRepository.getRevision(result.embeddingProjectionRevisionId)?.status, "READY");
    assert.equal(fixtureValue.fake.calls, 2);
  } finally { fixtureValue.close(); }
});

test("M7A replacement makes the old embedding projection STALE and a new revision rebuilds it", async () => {
  const fixtureValue = await fixture();
  try {
    const source = createKnowledge(fixtureValue, ["نسخة M7A قديمة"]);
    const first = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId));
    await fixtureValue.worker.runOnce(fixtureValue.now);
    updateKnowledge(fixtureValue, source.packageId, 2, ["نسخة M7A جديدة"]);
    assert.equal(fixtureValue.health.getHealth({ embeddingProjectionSetId: first.embeddingProjectionSetId }).status, "STALE");
    assert.deepEqual(fixtureValue.vectorIndex.search({ subjectKey: "arabic", embeddingProjectionRevisionId: first.embeddingProjectionRevisionId, queryVector: [1, 0, 0] }), []);
    const rebuiltM7A = new AIChunkProjectionBuilder(fixtureValue.database).build({ originKind: "KNOWLEDGE_PACKAGE", originId: source.packageId, subjectKey: "arabic" });
    assert.equal(fixtureValue.health.getHealth({ embeddingProjectionSetId: first.embeddingProjectionSetId }).status, "STALE");
    const second = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId));
    assert.notEqual(second.embeddingProjectionRevisionId, first.embeddingProjectionRevisionId);
    await fixtureValue.worker.runOnce(fixtureValue.now);
    assert.equal(fixtureValue.embeddingRepository.getRevision(second.embeddingProjectionRevisionId)?.chunkProjectionRevisionId, rebuiltM7A.projectionRevisionId);
    assert.equal(fixtureValue.embeddingRepository.getRevision(second.embeddingProjectionRevisionId)?.status, "READY");
    assert.equal(fixtureValue.embeddingRepository.getCurrentRevision(first.embeddingProjectionSetId)?.id, second.embeddingProjectionRevisionId);
    assert.throws(() => fixtureValue.vectorIndex.search({ subjectKey: "arabic", embeddingProjectionRevisionId: first.embeddingProjectionRevisionId, queryVector: [1, 0, 0] }), (error) => error instanceof AIEmbeddingError && error.code === "AI_EMBEDDING_PROJECTION_NOT_FOUND");
    assert.ok(fixtureValue.vectorIndex.search({ subjectKey: "arabic", embeddingProjectionRevisionId: second.embeddingProjectionRevisionId, queryVector: [1, 0, 0] }).length > 0);
  } finally { fixtureValue.close(); }
});

test("active vector search fails closed when Model or Provider configuration becomes stale", async () => {
  for (const changed of ["model", "provider"] as const) {
    const fixtureValue = await fixture();
    try {
      const source = createKnowledge(fixtureValue, [`search freshness ${changed}`]);
      const result = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId));
      await fixtureValue.worker.runOnce(fixtureValue.now);
      assert.ok(fixtureValue.vectorIndex.search({ subjectKey: "arabic", embeddingProjectionRevisionId: result.embeddingProjectionRevisionId, queryVector: [1, 0, 0] }).length > 0);
      if (changed === "model") {
        const model = fixtureValue.models.getById(fixtureValue.modelId)!;
        fixtureValue.models.update({ id: model.id, expectedRevision: model.revision, content: { ...model, displayName: "Stale search Model" }, actor: fixtureValue.owner, now: fixtureValue.now });
      } else {
        const provider = fixtureValue.providers.getById(fixtureValue.providerId)!;
        fixtureValue.providers.update({ id: provider.id, expectedRevision: provider.revision, content: { ...provider, displayName: "Stale search Provider" }, actor: fixtureValue.owner, now: fixtureValue.now });
      }
      assert.deepEqual(fixtureValue.vectorIndex.search({ subjectKey: "arabic", embeddingProjectionRevisionId: result.embeddingProjectionRevisionId, queryVector: [1, 0, 0] }), []);
      assert.equal(fixtureValue.health.getHealth({ embeddingProjectionSetId: result.embeddingProjectionSetId }).status, "STALE");
    } finally { fixtureValue.close(); }
  }
});

test("getHealthForRevision evaluates the requested exact revision, not the current sibling", async () => {
  const fixtureValue = await fixture();
  try {
    const source = createKnowledge(fixtureValue, ["exact revision health one"]);
    const first = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId));
    await fixtureValue.worker.runOnce(fixtureValue.now);
    updateKnowledge(fixtureValue, source.packageId, 2, ["exact revision health two"]);
    new AIChunkProjectionBuilder(fixtureValue.database).build({ originKind: "KNOWLEDGE_PACKAGE", originId: source.packageId, subjectKey: "arabic" });
    const second = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId));
    await fixtureValue.worker.runOnce(fixtureValue.now);

    const firstHealth = fixtureValue.health.getHealthForRevision(first.embeddingProjectionRevisionId);
    const secondHealth = fixtureValue.health.getHealthForRevision(second.embeddingProjectionRevisionId);
    assert.equal(firstHealth.embeddingProjectionRevisionId, first.embeddingProjectionRevisionId);
    assert.equal(firstHealth.status, "STALE");
    assert.equal(secondHealth.embeddingProjectionRevisionId, second.embeddingProjectionRevisionId);
    assert.equal(secondHealth.status, "READY");

    const defaultHealth = new AIEmbeddingProjectionHealthService(fixtureValue.database, { projections: fixtureValue.embeddingRepository, models: fixtureValue.models });
    assert.equal(defaultHealth.getHealth({ embeddingProjectionSetId: second.embeddingProjectionSetId }).status, "READY");
  } finally { fixtureValue.close(); }
});

test("a failed newer embedding revision leaves the previous READY revision untouched", async () => {
  const fixtureValue = await fixture();
  try {
    const source = createKnowledge(fixtureValue, ["semantic revision one"]);
    const first = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId));
    await fixtureValue.worker.runOnce(fixtureValue.now);
    const oldReady = fixtureValue.embeddingRepository.getRevision(first.embeddingProjectionRevisionId)!;
    updateKnowledge(fixtureValue, source.packageId, 2, ["semantic revision two"]);
    new AIChunkProjectionBuilder(fixtureValue.database).build({ originKind: "KNOWLEDGE_PACKAGE", originId: source.packageId, subjectKey: "arabic" });
    fixtureValue.fake.behavior = async () => { throw new AIProviderAdapterError("AUTHENTICATION"); };
    const failed = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId));
    await fixtureValue.worker.runOnce(fixtureValue.now);
    assert.equal(fixtureValue.embeddingRepository.getRevision(failed.embeddingProjectionRevisionId)?.status, "FAILED");
    const stillReady = fixtureValue.embeddingRepository.getRevision(oldReady.id)!;
    assert.deepEqual(stillReady, oldReady);
    assert.equal(fixtureValue.embeddingRepository.getCurrentRevision(first.embeddingProjectionSetId)?.id, oldReady.id);
  } finally { fixtureValue.close(); }
});

test("Question-origin semantic vectors retain explicit Pythagoras trust and no inferred ministerial trust", async () => {
  const fixtureValue = await fixture();
  try {
    const question = createQuestionOrigin(fixtureValue, "سؤال مصدره canonical question");
    const result = fixtureValue.embedding.startBuild(buildInput(fixtureValue, question.chunkProjectionSetId));
    await fixtureValue.worker.runOnce(fixtureValue.now);
    const candidates = fixtureValue.vectorIndex.search({ subjectKey: "arabic", embeddingProjectionRevisionId: result.embeddingProjectionRevisionId, queryVector: [1, 0, 0], limit: 10 });
    assert.ok(candidates.length > 0);
    assert.equal(candidates.every((candidate) => candidate.trustTier === "PYTHAGORAS_APPROVED"), true);
    assert.equal(candidates.every((candidate) => candidate.sourceId === null), true);
    assert.equal(JSON.stringify(candidates).includes("ministerial"), false);
  } finally { fixtureValue.close(); }
});

test("M7B job, projection, vector, and health metadata exclude the C4 privacy marker", async () => {
  const fixtureValue = await fixture();
  try {
    const marker = "TOP_SECRET_STUDENT_MESSAGE_42";
    const source = createKnowledge(fixtureValue, [marker]);
    const result = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId));
    const job = fixtureValue.jobs.getJob(result.jobId!)!;
    assert.equal(job.payloadJson.includes(marker), false);
    assert.equal(JSON.stringify(fixtureValue.embeddingRepository.getRevision(result.embeddingProjectionRevisionId)).includes(marker), false);
    await fixtureValue.worker.runOnce(fixtureValue.now);
    const health = fixtureValue.health.getHealth({ embeddingProjectionSetId: result.embeddingProjectionSetId });
    assert.equal(JSON.stringify(health).includes(marker), false);
    const vectorColumns = fixtureValue.database.client.prepare("pragma table_info(ai_embedding_vectors)").all() as Array<{ name: string }>;
    assert.equal(vectorColumns.some((column) => ["text", "message", "prompt", "answer"].includes(column.name)), false);
  } finally { fixtureValue.close(); }
});

test("invalid Provider vector count/dimensions/finiteness/Float32/zero-norm rejects the whole batch without advancing the cursor", async () => {
  const behaviors: Array<{ name: string; behavior: EmbeddingBehavior }> = [
    { name: "count", behavior: async (request) => ({ vectors: request.inputs.slice(0, -1).map(() => [1, 0, 0]), dimensions: 3, usage: { inputTokens: 2, outputTokens: null, reasoningTokens: null, cacheHitInputTokens: null, cacheMissInputTokens: null } }) },
    { name: "dimensions", behavior: async (request) => ({ vectors: request.inputs.map(() => [1, 0]), dimensions: 2, usage: { inputTokens: 2, outputTokens: null, reasoningTokens: null, cacheHitInputTokens: null, cacheMissInputTokens: null } }) },
    { name: "nan", behavior: async (request) => ({ vectors: request.inputs.map(() => [Number.NaN, 0, 1]), dimensions: 3, usage: { inputTokens: 2, outputTokens: null, reasoningTokens: null, cacheHitInputTokens: null, cacheMissInputTokens: null } }) },
    { name: "infinity", behavior: async (request) => ({ vectors: request.inputs.map(() => [Number.POSITIVE_INFINITY, 0, 1]), dimensions: 3, usage: { inputTokens: 2, outputTokens: null, reasoningTokens: null, cacheHitInputTokens: null, cacheMissInputTokens: null } }) },
    { name: "float32-overflow", behavior: async (request) => ({ vectors: request.inputs.map(() => [Number.MAX_VALUE, 0, 1]), dimensions: 3, usage: { inputTokens: 2, outputTokens: null, reasoningTokens: null, cacheHitInputTokens: null, cacheMissInputTokens: null } }) },
    { name: "zero", behavior: async (request) => ({ vectors: request.inputs.map(() => [0, 0, 0]), dimensions: 3, usage: { inputTokens: 2, outputTokens: null, reasoningTokens: null, cacheHitInputTokens: null, cacheMissInputTokens: null } }) },
  ];
  for (const entry of behaviors) {
    const fixtureValue = await fixture({ behavior: entry.behavior });
    try {
      const source = createKnowledge(fixtureValue, [`invalid-${entry.name}-one`, `invalid-${entry.name}-two`]);
      const result = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId, { batchSize: 2 }));
      await fixtureValue.worker.runOnce(fixtureValue.now);
      const revision = fixtureValue.embeddingRepository.getRevision(result.embeddingProjectionRevisionId)!;
      assert.equal(fixtureValue.fake.calls, 1);
      assert.equal(revision.status, "FAILED");
      assert.equal(revision.sourceCursor?.kind, "START");
      assert.equal(revision.vectorCount, 0);
      assert.equal((fixtureValue.database.client.prepare("select count(*) as count from ai_embedding_vectors where embedding_projection_revision_id=?").get(result.embeddingProjectionRevisionId) as { count: number }).count, 0);
      assert.equal(fixtureValue.jobs.getJob(result.jobId!)?.status, "DEAD_LETTER");
    } finally { fixtureValue.close(); }
  }
});

test("Embedding health distinguishes missing, building, ready, stale, failed, and ineligible states", async () => {
  const fixtureValue = await fixture();
  try {
    assert.equal(fixtureValue.health.getHealth({ embeddingProjectionSetId: uuidv7() }).status, "MISSING");
    const source = createKnowledge(fixtureValue, ["حالة الإسقاط"]);
    const building = fixtureValue.embedding.startBuild(buildInput(fixtureValue, source.chunkProjectionSetId));
    assert.equal(fixtureValue.health.getHealth({ embeddingProjectionSetId: building.embeddingProjectionSetId }).status, "BUILDING");
    await fixtureValue.worker.runOnce(fixtureValue.now);
    assert.equal(fixtureValue.health.getHealth({ embeddingProjectionSetId: building.embeddingProjectionSetId }).status, "READY");
    const failedSource = createKnowledge(fixtureValue, ["حالة فشل الإسقاط"]);
    const failed = fixtureValue.embedding.startBuild(buildInput(fixtureValue, failedSource.chunkProjectionSetId));
    const model = fixtureValue.models.getById(fixtureValue.modelId)!;
    fixtureValue.models.update({ id: model.id, expectedRevision: model.revision, content: { ...model, enabled: false }, actor: fixtureValue.owner, now: fixtureValue.now });
    await fixtureValue.worker.runOnce(fixtureValue.now);
    assert.equal(fixtureValue.health.getHealth({ embeddingProjectionSetId: failed.embeddingProjectionSetId }).status, "FAILED");
    const currentSource = fixtureValue.sourceRepository.getById(source.sourceId)!;
    fixtureValue.sourceRepository.appendRevision({ id: source.sourceId, expectedRevision: currentSource.currentRevision, content: sourceContent("arabic", { key: currentSource.key, enabled: false, rightsStatus: "RESTRICTED", rightsBasis: null }), actor: fixtureValue.owner, now: fixtureValue.now });
    assert.equal(fixtureValue.health.getHealth({ embeddingProjectionSetId: building.embeddingProjectionSetId }).status, "INELIGIBLE");
  } finally { fixtureValue.close(); }
});

test("0025 upgrades an existing 0024 database and installs M7B tables, indexes, and triggers", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-m7b-upgrade-"));
  const oldMigrations = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-m7b-migrations-"));
  let upgraded: ContentDatabase | null = null;
  try {
    mkdirSync(path.join(oldMigrations, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(path.join(migrationsDirectory, "meta", "_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }> };
    const priorEntries = journal.entries.slice(0, 25);
    for (const entry of priorEntries) {
      copyFileSync(path.join(migrationsDirectory, `${entry.tag}.sql`), path.join(oldMigrations, `${entry.tag}.sql`));
      const snapshotName = `${entry.idx.toString().padStart(4, "0")}_snapshot.json`;
      if (existsSync(path.join(migrationsDirectory, "meta", snapshotName))) copyFileSync(path.join(migrationsDirectory, "meta", snapshotName), path.join(oldMigrations, "meta", snapshotName));
    }
    writeFileSync(path.join(oldMigrations, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: priorEntries }));
    const before = openContentDatabase({ dataDirectory: root, migrationsDirectory: oldMigrations });
    assert.equal((before.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count, 25);
    before.close();
    upgraded = openContentDatabase({ dataDirectory: root, migrationsDirectory });
    assert.equal((upgraded.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count, 39);
    for (const table of ["ai_embedding_projection_sets", "ai_embedding_projection_revisions", "ai_embedding_vectors"]) {
      assert.ok(upgraded.client.prepare("select name from sqlite_master where type='table' and name=?").get(table));
    }
    for (const trigger of ["ai_embedding_projection_sets_owner_insert", "ai_embedding_projection_revisions_owner_insert", "ai_embedding_projection_revisions_initial_state", "ai_embedding_projection_revisions_lifecycle", "ai_embedding_vectors_owner_insert", "ai_embedding_vectors_no_update", "ai_embedding_vectors_ready_no_delete"]) {
      assert.ok(upgraded.client.prepare("select name from sqlite_master where type='trigger' and name=?").get(trigger));
    }
  } finally {
    upgraded?.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(oldMigrations, { recursive: true, force: true });
  }
});

test("M7B production boundaries use only the existing Gateway and bounded vector iteration", () => {
  const serviceSource = readFileSync(path.join(process.cwd(), "src/server/ai/embedding/service.ts"), "utf8");
  const vectorSource = readFileSync(path.join(process.cwd(), "src/server/ai/embedding/vector-index.ts"), "utf8");
  const workerSource = readFileSync(path.join(process.cwd(), "src/server/ai/operations/worker/worker.ts"), "utf8");
  assert.equal(serviceSource.includes("dependencies.gateway.embed"), true);
  assert.equal(serviceSource.includes("adapter.embed("), false);
  assert.equal(serviceSource.includes("fetch("), false);
  assert.equal(vectorSource.includes("isRevisionSearchable?:"), false);
  assert.equal(vectorSource.includes("?? (() => true)"), false);
  assert.equal(vectorSource.includes("statement.iterate("), true);
  assert.equal(vectorSource.includes("select * from ai_embedding_vectors"), false);
  assert.equal(vectorSource.includes(".all()"), false);
  assert.equal(workerSource.includes("listTerminal"), false);
  assert.equal(workerSource.includes("reconcilePending"), true);
});
