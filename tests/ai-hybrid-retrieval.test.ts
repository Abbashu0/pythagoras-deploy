import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../src/server/admin-auth/contracts";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import { AIBudgetAdmissionService, createAIAdmissionRequestFingerprint } from "../src/server/ai/admission";
import {
  AIProviderAdapterError,
  AIProviderGateway,
  ProviderAdapterRegistry,
  type EmbeddingProviderAdapter,
  type EmbeddingProviderRequest,
  type EmbeddingProviderResult,
  type ProviderAdapterExecutionContext,
  type RerankProviderRequest,
  type RerankProviderResult,
} from "../src/server/ai/gateway";
import {
  AIBillingUsageNormalizerRegistry,
  AICostAccountingService,
  AICostCalculator,
  AIRateCardResolver,
  SQLiteAIAccountingRepository,
  SQLiteAIRateCardModelRevisionRepository,
  SQLiteAIRateCardRepository,
} from "../src/server/ai/economics";
import {
  AIEmbeddingProjectionHealthService,
  AIEmbeddingProjectionService,
  AI_EMBEDDING_JOB_KIND,
  AI_EMBEDDING_VECTOR_CODEC_KEY,
  AI_EMBEDDING_VECTOR_CODEC_REVISION,
  AI_EMBEDDING_VECTOR_INDEX_ADAPTER_KEY,
  SQLiteAIEmbeddingProjectionRepository,
  SQLiteAIVectorIndexAdapter,
  createAIEmbeddingJobHandler,
  createSQLiteAIEmbeddingCostEstimator,
} from "../src/server/ai/embedding";
import {
  AIHybridRetrievalError,
  AI_HYBRID_RETRIEVAL_ERROR_CODES,
  HybridRetrievalService,
  selectEvidence,
  SQLiteAILexicalRetrievalAdapter,
  reciprocalContribution,
  weightedReciprocalRankFusion,
  type AIHybridChunkCandidate,
  type AIHybridRetrievalRequest,
} from "../src/server/ai/retrieval";
import {
  AIRetrievalConfigChangeAdapter,
  AI_RETRIEVAL_CONFIG_RESOURCE_TYPE,
  AI_RETRIEVAL_FUSION_ALGORITHM_KEY,
  AI_RETRIEVAL_FUSION_ALGORITHM_REVISION,
  SQLiteAIRetrievalConfigRepository,
  normalizeAIRetrievalConfigContent,
  type AIRetrievalConfigContent,
} from "../src/server/ai/retrieval-config";
import {
  AIChunkProjectionBuilder,
  AIRetrievalProjectionHealthService,
  SQLiteAIRetrievalProjectionRepository,
} from "../src/server/ai/retrieval";
import {
  AIKnowledgePackageRepository,
  SQLiteAIKnowledgePackageRepository,
  SQLiteAIKnowledgeSourceRepository,
  type AIKnowledgeSource,
  type AIKnowledgeSourceContent,
} from "../src/server/ai/knowledge";
import { SQLiteAIModelConfigRepository } from "../src/server/ai/model-registry";
import { SQLiteAIProviderConfigRepository } from "../src/server/ai/configuration";
import { SQLiteAIBudgetPolicyRepository } from "../src/server/ai/budget";
import { SQLiteAIRateLimitPolicyRepository } from "../src/server/ai/rate-limits";
import { AI_SECRET_KEY_BYTES, createLocalAISecretStore, type LocalEncryptedAISecretStore } from "../src/server/ai/secrets";
import { AIJobHandlerRegistry, AIJobQueueService } from "../src/server/ai/operations/jobs";
import { AIWorker } from "../src/server/ai/operations/worker";
import { createChangeManagementService } from "../src/server/change-management";
import { createCanonicalContentRepository } from "../src/server/canonical-content/service";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";
import { questionPackages, questions, questionVariants, questionPrimaryVariants, questionTaxonomyNodes, questionTaxonomyAssignments, questionOccurrences, questionOccurrenceBranches, questionOccurrenceQualifiers } from "../src/server/content/schema";
import type { CanonicalRichDocument } from "../src/server/questions/contracts";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const TEST_MASTER_KEY = Buffer.alloc(AI_SECRET_KEY_BYTES, 0x27);
const TEST_TIME = 1_900_500_000_000;

type EmbeddingBehavior = (request: EmbeddingProviderRequest, context: ProviderAdapterExecutionContext) => Promise<EmbeddingProviderResult>;
type RerankBehavior = (request: RerankProviderRequest, context: ProviderAdapterExecutionContext) => Promise<RerankProviderResult>;

class FakeEmbeddingAdapter implements EmbeddingProviderAdapter {
  readonly adapterKey = "test.hybrid-embedding";
  readonly capability = "EMBEDDING" as const;
  calls = 0;
  requests: EmbeddingProviderRequest[] = [];
  credentials: string[] = [];
  behavior: EmbeddingBehavior;

  constructor(behavior?: EmbeddingBehavior) {
    this.behavior = behavior ?? (async (request) => ({
      vectors: request.inputType === "QUERY"
        ? [[1, 0, 0]]
        : request.inputs.map((input) => input.includes("secondary") ? [0, 1, 0] : [1, 0, 0]),
      dimensions: 3,
      usage: {
        inputTokens: request.inputs.reduce((total, input) => total + Buffer.byteLength(input, "utf8"), 0),
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

class FakeRerankerAdapter {
  readonly adapterKey = "test.hybrid-rerank";
  readonly capability = "RERANK" as const;
  calls = 0;
  requests: RerankProviderRequest[] = [];
  behavior: RerankBehavior;

  constructor(behavior?: RerankBehavior) {
    this.behavior = behavior ?? (async (request) => ({
      results: [...request.candidates].reverse().map((candidate, index) => ({ candidateId: candidate.id, rank: index + 1, score: request.candidates.length - index })),
      usage: { inputTokens: request.candidates.reduce((total, candidate) => total + Buffer.byteLength(candidate.text, "utf8"), 0), outputTokens: null, reasoningTokens: null, cacheHitInputTokens: null, cacheMissInputTokens: null },
    }));
  }

  rerank(request: RerankProviderRequest, context: ProviderAdapterExecutionContext): Promise<RerankProviderResult> {
    this.calls += 1;
    this.requests.push(request);
    return this.behavior(request, context);
  }
}

interface HybridFixture {
  root: string;
  database: ContentDatabase;
  owner: AdminActor;
  now: number;
  setNow(value: number): void;
  secrets: LocalEncryptedAISecretStore;
  sources: SQLiteAIKnowledgeSourceRepository;
  packages: SQLiteAIKnowledgePackageRepository;
  providers: SQLiteAIProviderConfigRepository;
  models: SQLiteAIModelConfigRepository;
  configs: SQLiteAIRetrievalConfigRepository;
  changes: ReturnType<typeof createChangeManagementService>;
  embedding: AIEmbeddingProjectionService;
  embeddingRepository: SQLiteAIEmbeddingProjectionRepository;
  embeddingHealth: AIEmbeddingProjectionHealthService;
  vectorIndex: SQLiteAIVectorIndexAdapter;
  hybrid: HybridRetrievalService;
  fakeEmbedding: FakeEmbeddingAdapter;
  fakeReranker: FakeRerankerAdapter;
  jobs: AIJobQueueService;
  worker: AIWorker;
  modelId: string;
  rerankModelId: string;
  providerId: string;
  budgetPolicyId: string;
  embeddingBudgetPolicyId: string;
  rateLimitPolicyId: string;
  credentialRef: string;
  accounting: AICostAccountingService;
  admission: AIBudgetAdmissionService;
  close(): void;
}

async function fixture(options: { embeddingBehavior?: EmbeddingBehavior; rerankBehavior?: RerankBehavior } = {}): Promise<HybridFixture> {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-m7c-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  createCanonicalContentRepository(database).bootstrap();
  const identities = new SQLiteAdminIdentityRepository(database);
  const ownerUser = identities.createInitialOwner({ id: uuidv7(), email: `owner-${uuidv7()}@m7c.test`, displayName: "M7C Owner", passwordHash: "fixture", createdAt: TEST_TIME - 10_000 });
  const owner: AdminActor = { actorUserId: ownerUser.id, actorRole: "OWNER" };
  let now = TEST_TIME;
  const secrets = createLocalAISecretStore(database, { masterKey: TEST_MASTER_KEY, clock: () => now });
  const credential = await secrets.create({ secret: `m7c-secret-${uuidv7()}`, actor: { type: "ADMIN", actorUserId: owner.actorUserId } });
  const providers = new SQLiteAIProviderConfigRepository(database);
  const providerId = uuidv7();
  providers.create({ id: providerId, content: { key: `m7c-provider-${uuidv7()}`, displayName: "M7C Provider", baseUrl: "https://provider.example/v1", credentialRef: credential.credentialRef, enabled: true, retentionPolicy: "UNKNOWN", trainingPolicy: "UNKNOWN", zdrSupported: false, zdrRequired: false }, actor: owner, now: now - 2_000 });
  const models = new SQLiteAIModelConfigRepository(database);
  const modelId = uuidv7();
  models.create({ id: modelId, content: { key: `m7c-embedding-${uuidv7()}`, displayName: "M7C Embedding", providerConfigId: providerId, providerModelId: "m7c-embedding", capability: "EMBEDDING", adapterKey: "test.hybrid-embedding", enabled: true, contextWindowTokens: null, maxOutputTokens: null, embeddingDimensions: 3, supportsStreaming: false, supportsReasoning: false, supportsStructuredOutput: false }, actor: owner, now: now - 1_500 });
  const rerankModelId = uuidv7();
  models.create({ id: rerankModelId, content: { key: `m7c-rerank-${uuidv7()}`, displayName: "M7C Reranker", providerConfigId: providerId, providerModelId: "m7c-rerank", capability: "RERANK", adapterKey: "test.hybrid-rerank", enabled: true, contextWindowTokens: null, maxOutputTokens: null, embeddingDimensions: null, supportsStreaming: false, supportsReasoning: false, supportsStructuredOutput: false }, actor: owner, now: now - 1_400 });
  const budgetPolicyId = uuidv7();
  new SQLiteAIBudgetPolicyRepository(database).create({ id: budgetPolicyId, content: { key: `m7c-budget-${uuidv7()}`, displayName: "M7C Budget", currency: "USD", costCenter: "STUDENT_GENERATION", hardCapNano: 1_000_000_000, enabled: true }, actor: owner, now: now - 1_300 });
  const embeddingBudgetPolicyId = uuidv7();
  new SQLiteAIBudgetPolicyRepository(database).create({ id: embeddingBudgetPolicyId, content: { key: `m7c-embedding-budget-${uuidv7()}`, displayName: "M7C Embedding Budget", currency: "USD", costCenter: "KNOWLEDGE_INDEXING", hardCapNano: 1_000_000_000, enabled: true }, actor: owner, now: now - 1_250 });
  const rateLimitPolicyId = uuidv7();
  new SQLiteAIRateLimitPolicyRepository(database).create({ id: rateLimitPolicyId, content: { key: `m7c-rate-${uuidv7()}`, displayName: "M7C Rate", windowMs: 60_000, maxRequests: 100, maxConcurrentRequests: 100, enabled: true }, actor: owner, now: now - 1_200 });
  const rateCards = new SQLiteAIRateCardRepository(database);
  for (const [modelConfigId, normalizer, suffix] of [[modelId, "m7c.embedding", "embedding"], [rerankModelId, "m7c.rerank", "rerank"]] as const) {
    rateCards.create({ id: uuidv7(), content: { key: `m7c-rate-card-${suffix}-${uuidv7()}`, displayName: `M7C ${suffix} rate`, modelConfigId, modelConfigRevision: 1, currency: "USD", billingUsageNormalizerKey: normalizer, effectiveFrom: 0, effectiveTo: null, enabled: true, priceLines: [{ component: "STANDARD_INPUT", unit: "PER_MILLION_TOKENS", amountNano: 1_000_000 }, { component: "REQUEST", unit: "PER_REQUEST", amountNano: 100 }], timeBands: [] }, actor: owner, now: now - 1_000 });
  }
  const accountingRepository = new SQLiteAIAccountingRepository(database);
  const accounting = new AICostAccountingService({
    rateCardResolver: new AIRateCardResolver(rateCards, new SQLiteAIRateCardModelRevisionRepository(database)),
    billingNormalizers: new AIBillingUsageNormalizerRegistry([
      { key: "m7c.embedding", normalize: (usage) => ({ standardInputTokens: usage.inputTokens, cacheHitInputTokens: usage.cacheHitInputTokens, cacheMissInputTokens: usage.cacheMissInputTokens, outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens, requestUnits: 1 }) },
      { key: "m7c.rerank", normalize: (usage) => ({ standardInputTokens: usage.inputTokens, cacheHitInputTokens: usage.cacheHitInputTokens, cacheMissInputTokens: usage.cacheMissInputTokens, outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens, requestUnits: 1 }) },
    ]),
    costCalculator: new AICostCalculator(),
    accounting: accountingRepository,
  });
  const fakeEmbedding = new FakeEmbeddingAdapter(options.embeddingBehavior);
  const fakeReranker = new FakeRerankerAdapter(options.rerankBehavior);
  const adapters = new ProviderAdapterRegistry([fakeEmbedding, fakeReranker]);
  const gateway = new AIProviderGateway({ providerConfigs: providers, modelConfigs: models, secrets, adapters }, { clock: () => now });
  const handlers = new AIJobHandlerRegistry();
  const jobs = new AIJobQueueService(database, handlers, { clock: () => now });
  const admission = new AIBudgetAdmissionService(database, { clock: () => now });
  const embeddingRepository = new SQLiteAIEmbeddingProjectionRepository(database);
  const embedding = new AIEmbeddingProjectionService(database, { models, providers, secrets, adapters, gateway, jobs, admission, accounting, costEstimator: createSQLiteAIEmbeddingCostEstimator(new AIRateCardResolver(rateCards, new SQLiteAIRateCardModelRevisionRepository(database))), projections: embeddingRepository, clock: () => now });
  handlers.register(createAIEmbeddingJobHandler(embedding));
  const embeddingHealth = new AIEmbeddingProjectionHealthService(database, { projections: embeddingRepository, models });
  const vectorIndex = new SQLiteAIVectorIndexAdapter(database, { isRevisionSearchable: (revision) => embeddingHealth.isRevisionSearchable(revision) });
  const configs = new SQLiteAIRetrievalConfigRepository(database);
  const hybrid = new HybridRetrievalService({ database, configs, models, providers, m7aHealth: new AIRetrievalProjectionHealthService(database), lexical: new SQLiteAILexicalRetrievalAdapter(database), embeddings: embeddingRepository, embeddingHealth, vectors: vectorIndex, sources: new SQLiteAIKnowledgeSourceRepository(database), gateway, accounting, admission });
  const changes = createChangeManagementService(database);
  const worker = new AIWorker({ jobs, handlers, workerId: `m7c-worker-${uuidv7()}`, clock: () => now });
  return { root, database, owner, now, setNow(value) { now = value; }, secrets, sources: new SQLiteAIKnowledgeSourceRepository(database), packages: new SQLiteAIKnowledgePackageRepository(database), providers, models, configs, changes, embedding, embeddingRepository, embeddingHealth, vectorIndex, hybrid, fakeEmbedding, fakeReranker, jobs, worker, modelId, rerankModelId, providerId, budgetPolicyId, embeddingBudgetPolicyId, rateLimitPolicyId, credentialRef: credential.credentialRef, accounting, admission, close() { database.close(); rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }); } };
}

function paragraph(text: string): CanonicalRichDocument {
  return { type: "doc", version: 1, blocks: [{ id: uuidv7(), type: "paragraph", spans: [{ text }] }] };
}

function sourceContent(subjectKey = "arabic", overrides: Partial<AIKnowledgeSourceContent> = {}): AIKnowledgeSourceContent {
  return { key: `m7c-source-${subjectKey}-${uuidv7()}`, subjectKey, sourceType: "PYTHAGORAS_APPROVED", displayName: `M7C ${subjectKey} source`, language: "ar", edition: "fixture", authorityName: "Pythagoras", authorityType: "TEST", trustTier: "PYTHAGORAS_APPROVED", rightsStatus: "CLEARED", rightsBasis: "OWNED", licenseName: null, attribution: "M7C synthetic fixture", rightsNotes: null, sourceUrl: "https://example.test/m7c", sourceAssetId: null, enabled: true, preparationMethod: "DETERMINISTIC", producerKey: "m7c-fixture", producerRevision: "1", ...overrides };
}

function sourceRevisionContent(source: AIKnowledgeSource, overrides: Partial<AIKnowledgeSourceContent> = {}): AIKnowledgeSourceContent {
  return {
    key: source.key,
    subjectKey: source.subjectKey,
    sourceType: source.sourceType,
    displayName: source.displayName,
    language: source.language,
    edition: source.edition,
    authorityName: source.authorityName,
    authorityType: source.authorityType,
    trustTier: source.trustTier,
    rightsStatus: source.rightsStatus,
    rightsBasis: source.rightsBasis,
    licenseName: source.licenseName,
    attribution: source.attribution,
    rightsNotes: source.rightsNotes,
    sourceUrl: source.sourceUrl,
    sourceAssetId: source.sourceAssetId,
    enabled: source.enabled,
    preparationMethod: source.preparationMethod,
    producerKey: source.producerKey,
    producerRevision: source.producerRevision,
    ...overrides,
  };
}

async function createKnowledge(fixtureValue: HybridFixture, text: string, subjectKey = "arabic") {
  const origin = createKnowledgePackage(fixtureValue, text, subjectKey);
  return { ...origin, ...(await createEmbeddingForOrigin(fixtureValue, "KNOWLEDGE_PACKAGE", origin.packageId, subjectKey)) };
}

function createKnowledgePackage(fixtureValue: HybridFixture, text: string, subjectKey = "arabic", sourceOverrides: Partial<AIKnowledgeSourceContent> = {}) {
  const sourceId = uuidv7();
  fixtureValue.sources.create({ id: sourceId, content: sourceContent(subjectKey, sourceOverrides), actor: fixtureValue.owner, now: fixtureValue.now - 500 });
  const packageId = uuidv7();
  fixtureValue.packages.create({ id: packageId, content: { key: `m7c-package-${subjectKey}-${uuidv7()}`, subjectKey, title: `M7C ${subjectKey} package`, language: "ar", contentRevision: 1, sourceId, sourceRevision: 1, artifactRef: "a".repeat(64), artifactSha256: "a".repeat(64), artifactByteSize: 1 }, documents: [{ packageRevisionId: "pending", documentId: uuidv7(), displayOrder: 1, title: "M7C document", provenance: { pageStart: 1, section: "M7C" }, content: paragraph(text) }], assets: [], actor: fixtureValue.owner, now: fixtureValue.now - 400 });
  return { packageId, sourceId };
}

function updateKnowledgePackage(fixtureValue: HybridFixture, packageId: string, text: string) {
  const current = fixtureValue.packages.getById(packageId);
  assert.ok(current);
  return fixtureValue.packages.appendRevision({
    id: packageId,
    expectedRevision: current.package.currentRevision,
    content: {
      key: current.package.key,
      subjectKey: current.package.subjectKey,
      title: current.package.title,
      language: current.package.language,
      contentRevision: current.package.contentRevision + 1,
      sourceId: current.package.sourceId,
      sourceRevision: current.package.sourceRevision,
      artifactRef: current.package.artifactRef,
      artifactSha256: current.package.artifactSha256,
      artifactByteSize: current.package.artifactByteSize,
    },
    documents: [{ packageRevisionId: "pending", documentId: uuidv7(), displayOrder: 1, title: "M7C document updated", provenance: { pageStart: 1, section: "M7C" }, content: paragraph(text) }],
    assets: [],
    actor: fixtureValue.owner,
    now: fixtureValue.now + 1,
  });
}

function createQuestionPackage(fixtureValue: HybridFixture, text: string, subjectKey = "arabic") {
  const packageId = uuidv7();
  const questionId = uuidv7();
  const variantId = uuidv7();
  const timestamp = fixtureValue.now - 350;
  fixtureValue.database.db.insert(questionPackages).values({
    id: packageId,
    packageKey: `m7c-question-${subjectKey}-${uuidv7()}`,
    title: `M7C ${subjectKey} question package`,
    subjectKey,
    language: "ar-IQ",
    contentRevision: 1,
    bankBrowseMode: "ALL_PACKAGE_QUESTIONS",
    bankBrowseEntryKey: `m7c-question-${uuidv7()}`,
    bankBrowseEntryLabel: "M7C question",
    bankBrowseEntryOrder: 990,
    sourceAssetId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    updatedBy: fixtureValue.owner.actorUserId,
    revision: 1,
  }).run();
  fixtureValue.database.db.insert(questions).values({ id: questionId, packageId, displayOrder: 1, sharedAnswer: paragraph("M7C answer"), createdAt: timestamp, updatedAt: timestamp, updatedBy: fixtureValue.owner.actorUserId, revision: 1 }).run();
  fixtureValue.database.db.insert(questionVariants).values({ id: variantId, questionId, displayOrder: 1, content: paragraph(text), createdAt: timestamp, updatedAt: timestamp, updatedBy: fixtureValue.owner.actorUserId, revision: 1 }).run();
  fixtureValue.database.db.insert(questionPrimaryVariants).values({ questionId, variantId }).run();
  return { packageId, questionId, variantId };
}

async function createQuestion(fixtureValue: HybridFixture, text: string, subjectKey = "arabic") {
  const origin = createQuestionPackage(fixtureValue, text, subjectKey);
  return { ...origin, ...(await createEmbeddingForOrigin(fixtureValue, "QUESTION_PACKAGE", origin.packageId, subjectKey)) };
}

async function createQuestionWithProvenance(fixtureValue: HybridFixture, text: string, subjectKey = "arabic") {
  const origin = createQuestionPackage(fixtureValue, text, subjectKey);
  const timestamp = fixtureValue.now - 300;
  const taxonomyNodeId = uuidv7();
  fixtureValue.database.db.insert(questionTaxonomyNodes).values({ id: taxonomyNodeId, packageId: origin.packageId, nodeKey: "m7c-provenance-topic", label: "M7C provenance topic", kind: "topic", parentId: null, displayOrder: 1, createdAt: timestamp, updatedAt: timestamp, updatedBy: fixtureValue.owner.actorUserId, revision: 1 }).run();
  fixtureValue.database.db.insert(questionTaxonomyAssignments).values({ packageId: origin.packageId, questionId: origin.questionId, taxonomyNodeId, role: "PRIMARY", position: 0 }).run();
  const occurrenceOne = uuidv7();
  const occurrenceTwo = uuidv7();
  fixtureValue.database.db.insert(questionOccurrences).values([
    { id: occurrenceOne, variantId: origin.variantId, displayOrder: 1, sourceKind: "ministerial", year: 2024, roundCode: "R1", session: "morning", sourceName: "Ministry source one", notes: "First note", rawLabel: "وزارة 2024 R1", createdAt: timestamp, updatedAt: timestamp, updatedBy: fixtureValue.owner.actorUserId, revision: 2 },
    { id: occurrenceTwo, variantId: origin.variantId, displayOrder: 2, sourceKind: "discussion-question", year: 2025, roundCode: "R2", session: "evening", sourceName: "Discussion source two", notes: "Second note", rawLabel: "أسئلة المناقشة 2025", createdAt: timestamp, updatedAt: timestamp, updatedBy: fixtureValue.owner.actorUserId, revision: 3 },
  ]).run();
  fixtureValue.database.db.insert(questionOccurrenceBranches).values([{ occurrenceId: occurrenceOne, position: 0, value: "Branch A" }, { occurrenceId: occurrenceTwo, position: 0, value: "Branch B" }]).run();
  fixtureValue.database.db.insert(questionOccurrenceQualifiers).values([{ occurrenceId: occurrenceOne, position: 0, value: "Qualifier A" }, { occurrenceId: occurrenceTwo, position: 0, value: "Qualifier B" }]).run();
  return { ...origin, occurrenceOne, occurrenceTwo, taxonomyNodeId, ...(await createEmbeddingForOrigin(fixtureValue, "QUESTION_PACKAGE", origin.packageId, subjectKey)) };
}

async function createEmbeddingForOrigin(fixtureValue: HybridFixture, originKind: "KNOWLEDGE_PACKAGE" | "QUESTION_PACKAGE", originId: string, subjectKey: string) {
  const m7a = new AIChunkProjectionBuilder(fixtureValue.database).build({ originKind, originId, subjectKey });
  const m7aSet = new SQLiteAIRetrievalProjectionRepository(fixtureValue.database).getSet({ originKind, originId, subjectKey, strategyKey: "structured-rich-v1", normalizerKey: "retrieval-text-v1" });
  assert.ok(m7aSet);
  const embedding = fixtureValue.embedding.startBuild({ subjectKey, chunkProjectionSetId: m7aSet.id, modelConfigId: fixtureValue.modelId, budgetPolicyId: fixtureValue.embeddingBudgetPolicyId, budgetPolicyRevision: 1, rateLimitPolicyId: fixtureValue.rateLimitPolicyId, rateLimitPolicyRevision: 1, budgetPeriod: { startAt: fixtureValue.now - 100_000, endAt: fixtureValue.now + 100_000 }, batchSize: 50 });
  await fixtureValue.worker.runOnce(fixtureValue.now);
  assert.equal(fixtureValue.embeddingRepository.getRevision(embedding.embeddingProjectionRevisionId)?.status, "READY");
  return { m7aSetId: m7aSet.id, m7aRevisionId: m7a.projectionRevisionId, embeddingRevisionId: embedding.embeddingProjectionRevisionId };
}

function createHybridWithFinalFence(fixtureValue: HybridFixture, beforeFinalAssembly: (input: { requestId: string; candidateCount: number }) => void): HybridRetrievalService {
  return new HybridRetrievalService({
    database: fixtureValue.database,
    configs: fixtureValue.configs,
    models: fixtureValue.models,
    providers: fixtureValue.providers,
    m7aHealth: new AIRetrievalProjectionHealthService(fixtureValue.database),
    lexical: new SQLiteAILexicalRetrievalAdapter(fixtureValue.database),
    embeddings: fixtureValue.embeddingRepository,
    embeddingHealth: fixtureValue.embeddingHealth,
    vectors: fixtureValue.vectorIndex,
    sources: fixtureValue.sources,
    gateway: new AIProviderGateway({ providerConfigs: fixtureValue.providers, modelConfigs: fixtureValue.models, secrets: fixtureValue.secrets, adapters: new ProviderAdapterRegistry([fixtureValue.fakeEmbedding, fixtureValue.fakeReranker]) }, { clock: () => fixtureValue.now }),
    accounting: fixtureValue.accounting,
    admission: fixtureValue.admission,
    beforeFinalAssembly,
  });
}

function configContentFromRevision(revision: AIRetrievalConfigContent): AIRetrievalConfigContent {
  return { ...revision };
}

function insertRawRetrievalConfigRevision(fixtureValue: HybridFixture, configId: string, overrides: { allowedTrustTiers?: string[]; embeddingModelConfigId?: string; rerankModelConfigId?: string | null; fusionAlgorithmKey?: string; fusionAlgorithmRevision?: number } = {}): void {
  const current = fixtureValue.database.client.prepare("select * from ai_retrieval_config_revisions where retrieval_config_id=? order by revision desc limit 1").get(configId) as Record<string, unknown>;
  assert.ok(current);
  fixtureValue.database.client.prepare(`
    insert into ai_retrieval_config_revisions (
      id, retrieval_config_id, revision, display_name, enabled,
      embedding_model_config_id, rerank_model_config_id,
      lexical_candidate_limit, semantic_candidate_limit, fusion_candidate_limit,
      rerank_candidate_limit, evidence_item_limit, rrf_constant,
      lexical_weight_units, semantic_weight_units, minimum_fused_score_units,
      minimum_evidence_item_count, maximum_evidence_pack_bytes,
      max_evidence_chunks_per_source_item, allowed_trust_tiers,
      semantic_failure_behavior, reranker_failure_behavior, created_at, created_by,
      fusion_algorithm_key, fusion_algorithm_revision
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuidv7(),
    configId,
    Number(current.revision) + 1,
    current.display_name,
    current.enabled,
    overrides.embeddingModelConfigId ?? current.embedding_model_config_id,
    overrides.rerankModelConfigId === undefined ? current.rerank_model_config_id : overrides.rerankModelConfigId,
    current.lexical_candidate_limit,
    current.semantic_candidate_limit,
    current.fusion_candidate_limit,
    current.rerank_candidate_limit,
    current.evidence_item_limit,
    current.rrf_constant,
    current.lexical_weight_units,
    current.semantic_weight_units,
    current.minimum_fused_score_units,
    current.minimum_evidence_item_count,
    current.maximum_evidence_pack_bytes,
    current.max_evidence_chunks_per_source_item,
    JSON.stringify(overrides.allowedTrustTiers ?? JSON.parse(String(current.allowed_trust_tiers))),
    current.semantic_failure_behavior,
    current.reranker_failure_behavior,
    current.created_at,
    current.created_by,
    overrides.fusionAlgorithmKey ?? current.fusion_algorithm_key,
    overrides.fusionAlgorithmRevision ?? current.fusion_algorithm_revision,
  );
}

function retrievalConfigContent(fixtureValue: HybridFixture, overrides: Partial<AIRetrievalConfigContent> = {}): AIRetrievalConfigContent {
  return { key: `m7c-config-${uuidv7()}`, subjectKey: "arabic", displayName: "M7C Retrieval", enabled: true, embeddingModelConfigId: fixtureValue.modelId, rerankModelConfigId: null, lexicalCandidateLimit: 10, semanticCandidateLimit: 10, fusionCandidateLimit: 10, rerankCandidateLimit: 10, evidenceItemLimit: 5, rrfConstant: 60, lexicalWeightUnits: 1, semanticWeightUnits: 1, minimumFusedScoreUnits: 0, minimumEvidenceItemCount: 1, maximumEvidencePackBytes: 16_384, maxEvidenceChunksPerSourceItem: 5, allowedTrustTiers: ["OFFICIAL", "PYTHAGORAS_APPROVED", "TEACHER_REVIEWED", "OTHER_APPROVED"], semanticFailureBehavior: "FAIL_RETRIEVAL", rerankerFailureBehavior: "USE_FUSION", ...overrides };
}

function publishRetrievalConfig(fixtureValue: HybridFixture, content: AIRetrievalConfigContent, id = uuidv7()): { id: string; revision: number } {
  const draft = fixtureValue.changes.createChangeSet({ title: "M7C Retrieval Config", initialItem: { resourceType: AI_RETRIEVAL_CONFIG_RESOURCE_TYPE, resourceId: id, operation: "CREATE", expectedRevision: 0, desired: content } }, fixtureValue.owner);
  const submitted = fixtureValue.changes.submit(draft.changeSet.id, draft.changeSet.revision, fixtureValue.owner);
  const approved = fixtureValue.changes.approve(submitted.changeSet.id, submitted.changeSet.revision, fixtureValue.owner);
  fixtureValue.changes.publish(approved.changeSet.id, approved.changeSet.revision, fixtureValue.owner);
  const config = fixtureValue.configs.getById(id);
  assert.ok(config);
  return { id, revision: config.currentRevision };
}

function callerExecution(fixtureValue: HybridFixture): { costOperationId: string; budgetReservationId: string } {
  const operationId = uuidv7();
  const idempotencyKey = `m7c-request-${uuidv7()}`;
  fixtureValue.accounting.createOperation({ costCenter: "STUDENT_GENERATION", idempotencyKey, opaquePrincipalRef: "student-m7c", subjectKey: "arabic", conversationId: null, responseId: null, jobId: null, evalRunId: null, knowledgeRevision: null, status: "OPEN", startedAt: fixtureValue.now, completedAt: null }, operationId);
  const base = { principalRef: "student-m7c", budgetPolicyId: fixtureValue.budgetPolicyId, budgetPolicyRevision: 1, rateLimitPolicyId: fixtureValue.rateLimitPolicyId, rateLimitPolicyRevision: 1, budgetPeriod: { startAt: fixtureValue.now - 100_000, endAt: fixtureValue.now + 100_000 }, costOperationId: operationId, costEstimate: { currency: "USD", maxCostNano: 1_000_000, estimateBasis: "M7C test", modelConfigId: fixtureValue.modelId, modelConfigRevision: 1, rateCardId: null, rateCardRevision: null }, idempotencyKey };
  const admission = fixtureValue.admission.admit({ ...base, requestFingerprint: createAIAdmissionRequestFingerprint(base) });
  const reservation = fixtureValue.admission.startExecution(admission.reservation.id, fixtureValue.now);
  return { costOperationId: operationId, budgetReservationId: reservation.id };
}

function usageCountForOperation(fixtureValue: HybridFixture, operationId: string): number {
  return Number((fixtureValue.database.client.prepare("select count(*) as count from ai_usage_cost_records where operation_id=?").get(operationId) as { count: number }).count);
}

function request(fixtureValue: HybridFixture, config: { id: string; revision: number }, query: string): AIHybridRetrievalRequest {
  return { requestId: `m7c-request-${uuidv7()}`, subjectKey: "arabic", query, retrievalConfigId: config.id, retrievalConfigRevision: config.revision, providerExecutionContext: callerExecution(fixtureValue) };
}

function hybridCandidate(chunkId: string, overrides: Partial<AIHybridChunkCandidate> = {}): AIHybridChunkCandidate {
  return {
    chunkId,
    m7aProjectionRevisionId: "m7a-revision",
    m7bEmbeddingProjectionRevisionId: null,
    subjectKey: "arabic",
    originKind: "KNOWLEDGE_PACKAGE",
    originId: "origin-a",
    originRevision: 1,
    originContentRevision: 1,
    sourceId: "source-a",
    sourceRevision: 1,
    sourceType: "PYTHAGORAS_APPROVED",
    trustTier: "PYTHAGORAS_APPROVED",
    sourceItemId: "item-a",
    sourceItemOrder: 1,
    questionId: null,
    questionRevision: null,
    variantId: null,
    variantRevision: null,
    text: `evidence ${chunkId}`,
    language: "ar",
    provenance: null,
    originMetadata: {},
    ...overrides,
  };
}

function fusedCandidate(chunkId: string, overrides: Partial<AIHybridChunkCandidate> = {}): AIHybridChunkCandidate & { lexicalRank: number | null; semanticRank: number | null; cosineSimilarity: number | null; fusionScoreUnits: number; retrievalSignals: readonly ("LEXICAL" | "SEMANTIC" | "BOTH")[]; rerankRank: number | null; rerankScore: number | null } {
  return { ...hybridCandidate(chunkId, overrides), lexicalRank: 1, semanticRank: null, cosineSimilarity: null, fusionScoreUnits: 1, retrievalSignals: ["LEXICAL"], rerankRank: null, rerankScore: null };
}

test("Retrieval Config is governed, revisioned, subject-bound, and rejects invalid model capabilities", async () => {
  const fixtureValue = await fixture();
  try {
    const content = retrievalConfigContent(fixtureValue);
    const id = uuidv7();
    const draft = fixtureValue.changes.createChangeSet({ title: "M7C draft", initialItem: { resourceType: AI_RETRIEVAL_CONFIG_RESOURCE_TYPE, resourceId: id, operation: "CREATE", expectedRevision: 0, desired: content } }, fixtureValue.owner);
    assert.equal(fixtureValue.configs.getById(id), null);
    const submitted = fixtureValue.changes.submit(draft.changeSet.id, draft.changeSet.revision, fixtureValue.owner);
    const approved = fixtureValue.changes.approve(submitted.changeSet.id, submitted.changeSet.revision, fixtureValue.owner);
    assert.equal(fixtureValue.configs.getById(id), null);
    fixtureValue.changes.publish(approved.changeSet.id, approved.changeSet.revision, fixtureValue.owner);
    assert.equal(fixtureValue.configs.getById(id)?.currentRevision, 1);
    const current = fixtureValue.configs.getById(id)!;
    const update = fixtureValue.changes.createChangeSet({ title: "M7C config update", initialItem: { resourceType: AI_RETRIEVAL_CONFIG_RESOURCE_TYPE, resourceId: id, expectedRevision: current.currentRevision, desired: { ...content, key: current.key, subjectKey: current.subjectKey, displayName: "M7C Retrieval v2" } } }, fixtureValue.owner);
    const updateSubmitted = fixtureValue.changes.submit(update.changeSet.id, update.changeSet.revision, fixtureValue.owner);
    const updateApproved = fixtureValue.changes.approve(updateSubmitted.changeSet.id, updateSubmitted.changeSet.revision, fixtureValue.owner);
    fixtureValue.changes.publish(updateApproved.changeSet.id, updateApproved.changeSet.revision, fixtureValue.owner);
    assert.equal(fixtureValue.configs.getById(id)?.currentRevision, 2);
    assert.equal(AI_HYBRID_RETRIEVAL_ERROR_CODES.includes("AI_HYBRID_CONFIG_INVALID"), true);
    const generationModel = uuidv7();
    fixtureValue.models.create({ id: generationModel, content: { key: `m7c-generation-${uuidv7()}`, displayName: "M7C Generation", providerConfigId: fixtureValue.providerId, providerModelId: "m7c-generation", capability: "GENERATION", adapterKey: "test.none", enabled: true, contextWindowTokens: 1024, maxOutputTokens: 128, embeddingDimensions: null, supportsStreaming: true, supportsReasoning: false, supportsStructuredOutput: false }, actor: fixtureValue.owner, now: fixtureValue.now });
    assert.throws(() => fixtureValue.changes.createChangeSet({ title: "Invalid embedding model", initialItem: { resourceType: AI_RETRIEVAL_CONFIG_RESOURCE_TYPE, resourceId: uuidv7(), operation: "CREATE", expectedRevision: 0, desired: retrievalConfigContent(fixtureValue, { embeddingModelConfigId: generationModel }) } }, fixtureValue.owner), /EMBEDDING|model|Retrieval/i);
    assert.throws(() => fixtureValue.changes.createChangeSet({ title: "Invalid reranker model", initialItem: { resourceType: AI_RETRIEVAL_CONFIG_RESOURCE_TYPE, resourceId: uuidv7(), operation: "CREATE", expectedRevision: 0, desired: retrievalConfigContent(fixtureValue, { rerankModelConfigId: fixtureValue.modelId }) } }, fixtureValue.owner), /RERANK|model|Retrieval/i);
  } finally { fixtureValue.close(); }
});

test("M7C refuses to execute a Retrieval Config outside its canonical subject scope", async () => {
  const fixtureValue = await fixture();
  try {
    const config = publishRetrievalConfig(fixtureValue, retrievalConfigContent(fixtureValue, { subjectKey: "biology" }));
    await assert.rejects(() => fixtureValue.hybrid.retrieve(request(fixtureValue, config, "algebra")), (error) => error instanceof AIHybridRetrievalError && error.code === "AI_HYBRID_CONFIG_INVALID");
    assert.equal(fixtureValue.fakeEmbedding.calls, 0);
  } finally { fixtureValue.close(); }
});

test("M7C Retrieval Config identity/history is protected by SQLite while governed append remains valid", async () => {
  const fixtureValue = await fixture();
  try {
    const config = publishRetrievalConfig(fixtureValue, retrievalConfigContent(fixtureValue));
    const canonical = fixtureValue.configs.getById(config.id);
    const revision = fixtureValue.configs.getCurrentRevision(config.id);
    assert.ok(canonical);
    assert.ok(revision);
    assert.equal(canonical.fusionAlgorithmKey, AI_RETRIEVAL_FUSION_ALGORITHM_KEY);
    assert.equal(canonical.fusionAlgorithmRevision, AI_RETRIEVAL_FUSION_ALGORITHM_REVISION);
    const adapter = new AIRetrievalConfigChangeAdapter();
    const currentState = adapter.loadCurrent(fixtureValue.database, config.id);
    assert.throws(() => adapter.validateSnapshot({ ...currentState.snapshot, fusionAlgorithmKey: "future-rrf" }), /server-owned|fusion/i);
    assert.throws(() => fixtureValue.database.client.prepare("update ai_retrieval_configs set key=? where id=?").run("m7c-mutated-key", config.id), /immutable/i);
    assert.throws(() => fixtureValue.database.client.prepare("update ai_retrieval_configs set subject_key=? where id=?").run("biology", config.id), /immutable/i);
    assert.throws(() => fixtureValue.database.client.prepare("update ai_retrieval_configs set created_at=? where id=?").run(canonical.createdAt + 1, config.id), /immutable/i);
    assert.throws(() => fixtureValue.database.client.prepare("update ai_retrieval_configs set created_by=? where id=?").run(uuidv7(), config.id), /immutable/i);
    assert.throws(() => fixtureValue.database.client.prepare("update ai_retrieval_configs set current_revision=? where id=?").run(0, config.id), /advance|revision/i);
    assert.throws(() => fixtureValue.database.client.prepare("update ai_retrieval_configs set current_revision=? where id=?").run(4, config.id), /advance|revision/i);
    assert.throws(() => fixtureValue.database.client.prepare("update ai_retrieval_config_revisions set display_name=? where id=?").run("mutated", revision.revisionId), /immutable/i);
    assert.throws(() => fixtureValue.database.client.prepare("update ai_retrieval_config_revisions set allowed_trust_tiers=? where id=?").run(JSON.stringify(["OFFICIAL"]), revision.revisionId), /immutable/i);
    assert.throws(() => fixtureValue.database.client.prepare("update ai_retrieval_config_revisions set embedding_model_config_id=? where id=?").run(fixtureValue.rerankModelId, revision.revisionId), /immutable/i);
    assert.throws(() => fixtureValue.database.client.prepare("update ai_retrieval_config_revisions set semantic_failure_behavior=? where id=?").run("LEXICAL_ONLY", revision.revisionId), /immutable/i);
    assert.throws(() => fixtureValue.database.client.prepare("delete from ai_retrieval_config_revisions where id=?").run(revision.revisionId), /immutable/i);
    assert.throws(() => insertRawRetrievalConfigRevision(fixtureValue, config.id, { allowedTrustTiers: ["OFFICIAL", "OFFICIAL"] }), /integrity|invalid/i);
    assert.throws(() => insertRawRetrievalConfigRevision(fixtureValue, config.id, { allowedTrustTiers: ["NOT_A_TRUST_TIER"] }), /integrity|invalid/i);
    assert.throws(() => insertRawRetrievalConfigRevision(fixtureValue, config.id, { embeddingModelConfigId: fixtureValue.rerankModelId }), /integrity|invalid/i);
    assert.throws(() => insertRawRetrievalConfigRevision(fixtureValue, config.id, { fusionAlgorithmKey: "future-rrf" }), /integrity|invalid/i);
    const appended = fixtureValue.configs.appendRevision({ id: config.id, expectedRevision: revision.revision, content: { ...retrievalConfigContent(fixtureValue), key: canonical.key, subjectKey: canonical.subjectKey, displayName: "M7C Retrieval appended" }, actor: fixtureValue.owner, now: fixtureValue.now + 1 });
    assert.equal(appended.revision, 2);
    assert.equal(fixtureValue.configs.getCurrentRevision(config.id)?.fusionAlgorithmKey, AI_RETRIEVAL_FUSION_ALGORITHM_KEY);
    assert.equal(fixtureValue.configs.getRevision(config.id, 1)?.displayName, revision.displayName);
  } finally { fixtureValue.close(); }
});

test("hybrid retrieval uses exact fresh M7A/M7B, QUERY embedding, one model, RRF, and an in-memory EvidencePack", async () => {
  const fixtureValue = await fixture();
  try {
    const origin = await createKnowledge(fixtureValue, "algebra evidence for the hybrid query");
    const config = publishRetrievalConfig(fixtureValue, retrievalConfigContent(fixtureValue));
    const execution = callerExecution(fixtureValue);
    const result = await fixtureValue.hybrid.retrieve({ ...request(fixtureValue, config, "algebra"), providerExecutionContext: execution });
    assert.equal(result.status, "SUFFICIENT");
    assert.equal(result.mode, "HYBRID");
    assert.equal(result.retrievalConfigId, config.id);
    assert.equal(result.retrievalConfigRevision, config.revision);
    assert.equal(result.fusionAlgorithmKey, AI_RETRIEVAL_FUSION_ALGORITHM_KEY);
    assert.equal(result.fusionAlgorithmRevision, AI_RETRIEVAL_FUSION_ALGORITHM_REVISION);
    assert.equal(result.trace.fusionAlgorithmKey, AI_RETRIEVAL_FUSION_ALGORITHM_KEY);
    assert.equal(result.trace.fusionAlgorithmRevision, AI_RETRIEVAL_FUSION_ALGORITHM_REVISION);
    assert.ok(result.items.length > 0);
    assert.equal(fixtureValue.fakeEmbedding.requests.at(-1)?.inputType, "QUERY");
    assert.equal(fixtureValue.fakeEmbedding.requests.at(-1)?.inputs.length, 1);
    assert.equal(fixtureValue.fakeEmbedding.calls, 2);
    assert.equal(result.items.every((item) => item.m7aProjectionRevisionId === origin.m7aRevisionId), true);
    assert.equal(result.items.every((item) => item.m7bEmbeddingProjectionRevisionId === origin.embeddingRevisionId), true);
    assert.equal(result.trace.m7bEmbeddingProjectionRevisionIds.includes(origin.embeddingRevisionId), true);
    assert.equal(fixtureValue.accounting.getOperation(execution.costOperationId)?.status, "OPEN");
    assert.equal(fixtureValue.admission.getReservation(execution.budgetReservationId)?.status, "EXECUTING");
  } finally { fixtureValue.close(); }
});

test("M7C Retrieval Config tables are bounded and contain no query or provider secret fields", async () => {
  const fixtureValue = await fixture();
  try {
    const migrationCount = Number((fixtureValue.database.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count);
    assert.equal(migrationCount, 32);
    for (const table of ["ai_retrieval_configs", "ai_retrieval_config_revisions"]) {
      assert.ok(fixtureValue.database.client.prepare("select name from sqlite_master where type='table' and name=?").get(table));
      const columns = fixtureValue.database.client.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>;
      assert.equal(columns.some((column) => /query|prompt|message|answer|secret|credential|authorization/i.test(column.name)), false);
    }
  } finally { fixtureValue.close(); }
});

test("0027 upgrades a populated 0026 database with Retrieval Config immutability and fusion identity", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-m7c-migration-"));
  const oldMigrations = mkdtempSync(path.join(os.tmpdir(), "pythagoras-m7c-old-migrations-"));
  let before: ContentDatabase | null = null;
  let upgraded: ContentDatabase | null = null;
  try {
    mkdirSync(path.join(oldMigrations, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(path.join(migrationsDirectory, "meta", "_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }>; [key: string]: unknown };
    const priorEntries = journal.entries.slice(0, 27);
    for (const entry of priorEntries) {
      copyFileSync(path.join(migrationsDirectory, `${entry.tag}.sql`), path.join(oldMigrations, `${entry.tag}.sql`));
      const snapshotName = `${entry.idx.toString().padStart(4, "0")}_snapshot.json`;
      if (existsSync(path.join(migrationsDirectory, "meta", snapshotName))) copyFileSync(path.join(migrationsDirectory, "meta", snapshotName), path.join(oldMigrations, "meta", snapshotName));
    }
    const currentJournal = JSON.parse(readFileSync(path.join(migrationsDirectory, "meta", "_journal.json"), "utf8")) as { version: string; dialect: string; entries: unknown[] };
    writeFileSync(path.join(oldMigrations, "meta", "_journal.json"), JSON.stringify({ ...currentJournal, entries: priorEntries }));

    before = openContentDatabase({ dataDirectory: root, migrationsDirectory: oldMigrations });
    assert.equal(Number((before.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count), 27);
    createCanonicalContentRepository(before).bootstrap();
    const identities = new SQLiteAdminIdentityRepository(before);
    const ownerUser = identities.createInitialOwner({ id: uuidv7(), email: `owner-${uuidv7()}@m7c-upgrade.test`, displayName: "M7C Upgrade Owner", passwordHash: "fixture", createdAt: TEST_TIME - 10_000 });
    const owner: AdminActor = { actorUserId: ownerUser.id, actorRole: "OWNER" };
    const providerId = uuidv7();
    new SQLiteAIProviderConfigRepository(before).create({
      id: providerId,
      content: { key: `m7c-upgrade-provider-${uuidv7()}`, displayName: "M7C Upgrade Provider", baseUrl: "https://provider.example/v1", credentialRef: null, enabled: false, retentionPolicy: "UNKNOWN", trainingPolicy: "UNKNOWN", zdrSupported: false, zdrRequired: false },
      actor: owner,
      now: TEST_TIME - 2_000,
    });
    const embeddingModelId = uuidv7();
    new SQLiteAIModelConfigRepository(before).create({
      id: embeddingModelId,
      content: { key: `m7c-upgrade-embedding-${uuidv7()}`, displayName: "M7C Upgrade Embedding", providerConfigId: providerId, providerModelId: "m7c-upgrade-embedding", capability: "EMBEDDING", adapterKey: "test.upgrade", enabled: true, contextWindowTokens: null, maxOutputTokens: null, embeddingDimensions: 3, supportsStreaming: false, supportsReasoning: false, supportsStructuredOutput: false },
      actor: owner,
      now: TEST_TIME - 1_900,
    });

    const configId = uuidv7();
    const configCreatedAt = TEST_TIME - 1_800;
    before.client.prepare(`
      insert into ai_retrieval_configs (id, key, subject_key, current_revision, created_at, updated_at, created_by, updated_by)
      values (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(configId, `m7c-upgrade-config-${uuidv7()}`, "arabic", 2, configCreatedAt, configCreatedAt, ownerUser.id, ownerUser.id);
    const allowedTrustTiers = JSON.stringify(["OFFICIAL", "PYTHAGORAS_APPROVED", "TEACHER_REVIEWED", "OTHER_APPROVED"]);
    const insertRevision = before.client.prepare(`
      insert into ai_retrieval_config_revisions (
        id, retrieval_config_id, revision, display_name, enabled,
        embedding_model_config_id, rerank_model_config_id,
        lexical_candidate_limit, semantic_candidate_limit, fusion_candidate_limit,
        rerank_candidate_limit, evidence_item_limit, rrf_constant,
        lexical_weight_units, semantic_weight_units, minimum_fused_score_units,
        minimum_evidence_item_count, maximum_evidence_pack_bytes,
        max_evidence_chunks_per_source_item, allowed_trust_tiers,
        semantic_failure_behavior, reranker_failure_behavior, created_at, created_by
      ) values (${Array.from({ length: 24 }, () => "?").join(", ")})
    `);
    for (const [revision, displayName, createdAt] of [[1, "M7C upgrade revision 1", TEST_TIME - 1_700], [2, "M7C upgrade revision 2", TEST_TIME - 1_600]] as const) {
      insertRevision.run(uuidv7(), configId, revision, displayName, 1, embeddingModelId, null, 10, 10, 10, 10, 5, 60, 1, 1, 0, 1, 16_384, 5, allowedTrustTiers, "FAIL_RETRIEVAL", "USE_FUSION", createdAt, ownerUser.id);
    }
    const historicalColumns = [
      "id", "retrieval_config_id", "revision", "display_name", "enabled",
      "embedding_model_config_id", "rerank_model_config_id", "lexical_candidate_limit",
      "semantic_candidate_limit", "fusion_candidate_limit", "rerank_candidate_limit",
      "evidence_item_limit", "rrf_constant", "lexical_weight_units", "semantic_weight_units",
      "minimum_fused_score_units", "minimum_evidence_item_count", "maximum_evidence_pack_bytes",
      "max_evidence_chunks_per_source_item", "allowed_trust_tiers", "semantic_failure_behavior",
      "reranker_failure_behavior", "created_at", "created_by",
    ];
    const selectHistoricalRows = (database: ContentDatabase) => database.client.prepare(`select ${historicalColumns.join(", ")} from ai_retrieval_config_revisions where retrieval_config_id=? order by revision`).all(configId) as Array<Record<string, unknown>>;
    const beforeConfig = before.client.prepare("select id, key, subject_key, current_revision, created_at, updated_at, created_by, updated_by from ai_retrieval_configs where id=?").get(configId) as Record<string, unknown>;
    const beforeRevisions = selectHistoricalRows(before);
    assert.equal(beforeRevisions.length, 2);
    assert.equal(beforeConfig.current_revision, 2);
    before.close();
    before = null;

    const upgradedDatabase = openContentDatabase({ dataDirectory: root, migrationsDirectory });
    upgraded = upgradedDatabase;
    assert.equal(Number((upgradedDatabase.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count), 32);
    assert.ok(upgradedDatabase.client.prepare("select name from sqlite_master where name='ai_retrieval_configs'").get());
    assert.ok(upgradedDatabase.client.prepare("select name from pragma_table_info('ai_retrieval_config_revisions') where name='fusion_algorithm_key'").get());
    assert.ok(upgradedDatabase.client.prepare("select name from pragma_table_info('ai_retrieval_config_revisions') where name='fusion_algorithm_revision'").get());
    for (const trigger of ["ai_retrieval_configs_initial_revision", "ai_retrieval_configs_identity_no_update", "ai_retrieval_configs_revision_pointer", "ai_retrieval_config_revisions_insert_integrity", "ai_retrieval_config_revisions_no_update", "ai_retrieval_config_revisions_no_delete"]) assert.ok(upgradedDatabase.client.prepare("select name from sqlite_master where type='trigger' and name=?").get(trigger));

    const configs = new SQLiteAIRetrievalConfigRepository(upgradedDatabase);
    const canonical = configs.getById(configId);
    const revision1 = configs.getRevision(configId, 1);
    const revision2 = configs.getRevision(configId, 2);
    assert.ok(canonical);
    assert.ok(revision1);
    assert.ok(revision2);
    assert.equal(canonical.key, beforeConfig.key);
    assert.equal(canonical.subjectKey, beforeConfig.subject_key);
    assert.equal(canonical.currentRevision, 2);
    const afterConfig = upgradedDatabase.client.prepare("select id, key, subject_key, current_revision, created_at, updated_at, created_by, updated_by from ai_retrieval_configs where id=?").get(configId) as Record<string, unknown>;
    assert.deepEqual(afterConfig, beforeConfig);
    assert.equal(revision1.fusionAlgorithmKey, AI_RETRIEVAL_FUSION_ALGORITHM_KEY);
    assert.equal(revision1.fusionAlgorithmRevision, AI_RETRIEVAL_FUSION_ALGORITHM_REVISION);
    assert.equal(revision2.fusionAlgorithmKey, AI_RETRIEVAL_FUSION_ALGORITHM_KEY);
    assert.equal(revision2.fusionAlgorithmRevision, AI_RETRIEVAL_FUSION_ALGORITHM_REVISION);
    const migratedFusionRows = upgradedDatabase.client.prepare("select revision, fusion_algorithm_key, fusion_algorithm_revision from ai_retrieval_config_revisions where retrieval_config_id=? order by revision").all(configId) as Array<Record<string, unknown>>;
    assert.deepEqual(migratedFusionRows, [
      { revision: 1, fusion_algorithm_key: AI_RETRIEVAL_FUSION_ALGORITHM_KEY, fusion_algorithm_revision: AI_RETRIEVAL_FUSION_ALGORITHM_REVISION },
      { revision: 2, fusion_algorithm_key: AI_RETRIEVAL_FUSION_ALGORITHM_KEY, fusion_algorithm_revision: AI_RETRIEVAL_FUSION_ALGORITHM_REVISION },
    ]);
    const afterRevisions = selectHistoricalRows(upgradedDatabase);
    assert.deepEqual(afterRevisions, beforeRevisions);

    assert.throws(() => upgradedDatabase.client.prepare("update ai_retrieval_config_revisions set display_name=? where id=?").run("mutated", revision1.revisionId), /immutable/i);
    assert.throws(() => upgradedDatabase.client.prepare("delete from ai_retrieval_config_revisions where id=?").run(revision1.revisionId), /immutable/i);
    assert.throws(() => upgradedDatabase.client.prepare("update ai_retrieval_configs set current_revision=? where id=?").run(1, configId), /advance|revision/i);
    assert.throws(() => upgradedDatabase.client.prepare("update ai_retrieval_configs set current_revision=? where id=?").run(4, configId), /advance|revision/i);

    const appended = configs.appendRevision({
      id: configId,
      expectedRevision: 2,
      content: {
        key: revision2.key,
        subjectKey: revision2.subjectKey,
        displayName: "M7C upgrade revision 3",
        enabled: revision2.enabled,
        embeddingModelConfigId: revision2.embeddingModelConfigId,
        rerankModelConfigId: revision2.rerankModelConfigId,
        lexicalCandidateLimit: revision2.lexicalCandidateLimit,
        semanticCandidateLimit: revision2.semanticCandidateLimit,
        fusionCandidateLimit: revision2.fusionCandidateLimit,
        rerankCandidateLimit: revision2.rerankCandidateLimit,
        evidenceItemLimit: revision2.evidenceItemLimit,
        rrfConstant: revision2.rrfConstant,
        lexicalWeightUnits: revision2.lexicalWeightUnits,
        semanticWeightUnits: revision2.semanticWeightUnits,
        minimumFusedScoreUnits: revision2.minimumFusedScoreUnits,
        minimumEvidenceItemCount: revision2.minimumEvidenceItemCount,
        maximumEvidencePackBytes: revision2.maximumEvidencePackBytes,
        maxEvidenceChunksPerSourceItem: revision2.maxEvidenceChunksPerSourceItem,
        allowedTrustTiers: [...revision2.allowedTrustTiers],
        semanticFailureBehavior: revision2.semanticFailureBehavior,
        rerankerFailureBehavior: revision2.rerankerFailureBehavior,
      },
      actor: owner,
      now: TEST_TIME + 1_000,
    });
    assert.equal(appended.revision, 3);
    assert.equal(appended.fusionAlgorithmKey, AI_RETRIEVAL_FUSION_ALGORITHM_KEY);
    assert.equal(appended.fusionAlgorithmRevision, AI_RETRIEVAL_FUSION_ALGORITHM_REVISION);
    assert.equal(configs.getById(configId)?.currentRevision, 3);
    assert.deepEqual(selectHistoricalRows(upgradedDatabase).filter((row) => Number(row.revision) <= 2), beforeRevisions);
  } finally {
    upgraded?.close();
    before?.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
    rmSync(oldMigrations, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  }
});

test("RRF is integer-weighted, deterministic, and preserves both retrieval signals", () => {
  const shared = hybridCandidate("chunk-shared");
  const lexicalOnly = hybridCandidate("chunk-lexical");
  const semanticOnly = hybridCandidate("chunk-semantic", { m7bEmbeddingProjectionRevisionId: "m7b-revision" });
  const config = { rrfConstant: 60, lexicalWeightUnits: 2, semanticWeightUnits: 3, fusionCandidateLimit: 10 };
  const result = weightedReciprocalRankFusion(
    [{ candidate: shared, rank: 1 }, { candidate: lexicalOnly, rank: 2 }],
    [{ candidate: shared, rank: 2, cosineSimilarity: 0.9 }, { candidate: semanticOnly, rank: 1, cosineSimilarity: 0.8 }],
    config,
  );
  assert.deepEqual(result.map((item) => item.chunkId), ["chunk-shared", "chunk-semantic", "chunk-lexical"]);
  assert.deepEqual(result[0].retrievalSignals, ["BOTH"]);
  assert.equal(result[0].lexicalRank, 1);
  assert.equal(result[0].semanticRank, 2);
  assert.equal(result[0].cosineSimilarity, 0.9);
  assert.equal(result[0].fusionScoreUnits, reciprocalContribution(2, 60, 1) + reciprocalContribution(3, 60, 2));
  assert.equal(result[1].retrievalSignals[0], "SEMANTIC");
  assert.equal(result[2].retrievalSignals[0], "LEXICAL");
});

test("Evidence selection includes safe provenance bytes, skips oversized text without truncation, and scopes source-item limits per origin", () => {
  const first = fusedCandidate("oversized", { text: "0123456789abc" });
  const second = fusedCandidate("fits", { text: "ok" });
  const otherOrigin = fusedCandidate("other-origin", { originId: "origin-b", sourceItemId: "item-a", text: "yes" });
  const result = selectEvidence({ candidates: [first, second, otherOrigin], config: { evidenceItemLimit: 3, maximumEvidencePackBytes: 17, maxEvidenceChunksPerSourceItem: 1, minimumEvidenceItemCount: 1 } });
  assert.deepEqual(result.items.map((item) => item.chunkId), ["fits", "other-origin"]);
  assert.equal(result.items[0].text, "ok");
  assert.equal(result.evidenceByteCount, 17);
  assert.equal(result.sufficient, true);
});

test("M7C blocks before QUERY embedding when M7A is missing and treats punctuation-only input as no candidates", async () => {
  const fixtureValue = await fixture();
  try {
    const unbuilt = createKnowledgePackage(fixtureValue, "unbuilt algebra evidence");
    const config = publishRetrievalConfig(fixtureValue, retrievalConfigContent(fixtureValue));
    const missing = await fixtureValue.hybrid.retrieve(request(fixtureValue, config, "algebra"));
    assert.equal(missing.status, "INSUFFICIENT");
    assert.equal(missing.safeReason, "PROJECTION_NOT_READY");
    assert.equal(fixtureValue.fakeEmbedding.calls, 0);
    assert.equal(unbuilt.packageId.length > 0, true);
    const punctuation = await fixtureValue.hybrid.retrieve(request(fixtureValue, config, "!!! ؟؟"));
    assert.equal(punctuation.status, "INSUFFICIENT");
    assert.equal(punctuation.safeReason, "NO_CANDIDATES");
    assert.equal(fixtureValue.fakeEmbedding.calls, 0);
  } finally { fixtureValue.close(); }
});

test("M7C uses canonical Question origins with explicit Pythagoras trust", async () => {
  const fixtureValue = await fixture();
  try {
    const origin = await createQuestion(fixtureValue, "canonical algebra question");
    const config = publishRetrievalConfig(fixtureValue, retrievalConfigContent(fixtureValue));
    const result = await fixtureValue.hybrid.retrieve(request(fixtureValue, config, "algebra"));
    assert.equal(result.status, "SUFFICIENT");
    assert.ok(result.items.some((item) => item.originKind === "QUESTION_PACKAGE" && item.originId === origin.packageId));
    assert.equal(result.items.every((item) => item.trustTier === "PYTHAGORAS_APPROVED"), true);
  } finally { fixtureValue.close(); }
});

test("M7C applies configured trust tiers without inferring official trust from Question or source labels", async () => {
  const fixtureValue = await fixture();
  try {
    await createKnowledge(fixtureValue, "algebra approved evidence");
    const config = publishRetrievalConfig(fixtureValue, retrievalConfigContent(fixtureValue, { allowedTrustTiers: ["OFFICIAL"] }));
    const result = await fixtureValue.hybrid.retrieve(request(fixtureValue, config, "algebra"));
    assert.equal(result.status, "INSUFFICIENT");
    assert.equal(result.safeReason, "BELOW_MINIMUM_EVIDENCE");
    assert.equal(result.items.length, 0);
  } finally { fixtureValue.close(); }
});

test("M7C requires exact semantic coverage and does not fall back to lexical for a missing M7B revision", async () => {
  const fixtureValue = await fixture();
  try {
    const origin = createKnowledgePackage(fixtureValue, "algebra evidence");
    new AIChunkProjectionBuilder(fixtureValue.database).build({ originKind: "KNOWLEDGE_PACKAGE", originId: origin.packageId, subjectKey: "arabic" });
    const config = publishRetrievalConfig(fixtureValue, retrievalConfigContent(fixtureValue));
    const result = await fixtureValue.hybrid.retrieve(request(fixtureValue, config, "algebra"));
    assert.equal(result.status, "INSUFFICIENT");
    assert.equal(result.safeReason, "SEMANTIC_COVERAGE_INCOMPLETE");
    assert.equal(result.items.length, 0);
    assert.equal(fixtureValue.fakeEmbedding.calls, 0);
  } finally { fixtureValue.close(); }
});

test("M7C semantic failure policy supports an explicit lexical-only degraded result", async () => {
  const defaultBehavior = new FakeEmbeddingAdapter().behavior;
  const fixtureValue = await fixture({ embeddingBehavior: async (providerRequest, context) => {
    if (providerRequest.inputType === "QUERY") throw new AIProviderAdapterError("UNAVAILABLE");
    return defaultBehavior(providerRequest, context);
  }});
  try {
    await createKnowledge(fixtureValue, "algebra lexical evidence");
    const config = publishRetrievalConfig(fixtureValue, retrievalConfigContent(fixtureValue, { semanticFailureBehavior: "LEXICAL_ONLY" }));
    const result = await fixtureValue.hybrid.retrieve(request(fixtureValue, config, "algebra"));
    assert.equal(result.status, "SUFFICIENT");
    assert.equal(result.mode, "LEXICAL_ONLY");
    assert.equal(result.degraded, true);
    assert.equal(result.safeReason, "QUERY_EMBEDDING_FAILED");
    assert.ok(result.items.length > 0);
  } finally { fixtureValue.close(); }
});

test("M7C rerank is optional, bounded, and can degrade to fusion without changing EvidencePack geometry", async () => {
  const fixtureValue = await fixture();
  try {
    await createKnowledge(fixtureValue, "algebra rerank evidence");
    const config = publishRetrievalConfig(fixtureValue, retrievalConfigContent(fixtureValue, { rerankModelConfigId: fixtureValue.rerankModelId }));
    const result = await fixtureValue.hybrid.retrieve(request(fixtureValue, config, "algebra"));
    assert.equal(result.status, "SUFFICIENT");
    assert.equal(fixtureValue.fakeReranker.calls, 1);
    assert.equal(result.items[0].rerankRank, 1);
    assert.equal(typeof result.items[0].rerankScore, "number");
    const rerankRequest = fixtureValue.fakeReranker.requests[0];
    assert.equal(rerankRequest.query, "algebra");
    assert.equal(rerankRequest.candidates.every((candidate) => Object.keys(candidate).sort().join(",") === "id,text"), true);
  } finally { fixtureValue.close(); }
});

test("M7C reranker failure follows governed USE_FUSION and FAIL_RETRIEVAL policies", async () => {
  const fixtureValue = await fixture({ rerankBehavior: async () => { throw new AIProviderAdapterError("UNAVAILABLE"); } });
  try {
    await createKnowledge(fixtureValue, "algebra rerank fallback evidence");
    const fusionConfig = publishRetrievalConfig(fixtureValue, retrievalConfigContent(fixtureValue, { rerankModelConfigId: fixtureValue.rerankModelId, rerankerFailureBehavior: "USE_FUSION" }));
    const fusionResult = await fixtureValue.hybrid.retrieve(request(fixtureValue, fusionConfig, "algebra"));
    assert.equal(fusionResult.status, "SUFFICIENT");
    assert.equal(fusionResult.degraded, true);
    assert.equal(fusionResult.safeReason, "RERANK_FAILED");
    assert.ok(fusionResult.items.length > 0);
    const failConfig = publishRetrievalConfig(fixtureValue, retrievalConfigContent(fixtureValue, { rerankModelConfigId: fixtureValue.rerankModelId, rerankerFailureBehavior: "FAIL_RETRIEVAL" }));
    const failResult = await fixtureValue.hybrid.retrieve(request(fixtureValue, failConfig, "algebra"));
    assert.equal(failResult.status, "INSUFFICIENT");
    assert.equal(failResult.safeReason, "RERANK_FAILED");
    assert.equal(failResult.items.length, 0);
  } finally { fixtureValue.close(); }
});

test("M7C final source fence returns no evidence when live rights change during retrieval", async () => {
  const fixtureValue = await fixture();
  try {
    const origin = await createKnowledge(fixtureValue, "algebra source fence evidence");
    const config = publishRetrievalConfig(fixtureValue, retrievalConfigContent(fixtureValue));
    const hybrid = createHybridWithFinalFence(fixtureValue, () => {
      const current = fixtureValue.sources.getById(origin.sourceId);
      assert.ok(current);
      fixtureValue.sources.appendRevision({ id: origin.sourceId, expectedRevision: current.currentRevision, content: sourceRevisionContent(current, { enabled: false, rightsStatus: "RESTRICTED", rightsBasis: null }), actor: fixtureValue.owner, now: fixtureValue.now + 1 });
    });
    const result = await hybrid.retrieve(request(fixtureValue, config, "algebra"));
    assert.equal(result.status, "INSUFFICIENT");
    assert.equal(result.safeReason, "RETRIEVAL_SCOPE_CHANGED");
    assert.equal(result.items.length, 0);
  } finally { fixtureValue.close(); }
});

test("M7C final M7A fence returns no evidence when canonical package input changes during retrieval", async () => {
  const fixtureValue = await fixture();
  try {
    const origin = await createKnowledge(fixtureValue, "algebra projection fence evidence");
    const config = publishRetrievalConfig(fixtureValue, retrievalConfigContent(fixtureValue));
    const hybrid = createHybridWithFinalFence(fixtureValue, () => { updateKnowledgePackage(fixtureValue, origin.packageId, "changed algebra projection evidence"); });
    const result = await hybrid.retrieve(request(fixtureValue, config, "algebra"));
    assert.equal(result.status, "INSUFFICIENT");
    assert.equal(result.safeReason, "PROJECTION_CHANGED");
    assert.equal(result.items.length, 0);
  } finally { fixtureValue.close(); }
});

test("M7C final Retrieval Config fence returns no evidence after a new governed revision becomes current", async () => {
  const fixtureValue = await fixture();
  try {
    await createKnowledge(fixtureValue, "algebra config fence evidence");
    const config = publishRetrievalConfig(fixtureValue, retrievalConfigContent(fixtureValue));
    const hybrid = createHybridWithFinalFence(fixtureValue, () => {
      const current = fixtureValue.configs.getById(config.id);
      assert.ok(current);
      fixtureValue.configs.appendRevision({ id: config.id, expectedRevision: current.currentRevision, content: configContentFromRevision(current), actor: fixtureValue.owner, now: fixtureValue.now + 1 });
    });
    const result = await hybrid.retrieve(request(fixtureValue, config, "algebra"));
    assert.equal(result.status, "INSUFFICIENT");
    assert.equal(result.safeReason, "RETRIEVAL_CONFIG_CHANGED");
    assert.equal(result.items.length, 0);
  } finally { fixtureValue.close(); }
});

test("M7C keeps the query ephemeral and attributes QUERY embedding and rerank usage to the caller operation", async () => {
  const fixtureValue = await fixture();
  try {
    await createKnowledge(fixtureValue, "algebra privacy evidence");
    const config = publishRetrievalConfig(fixtureValue, retrievalConfigContent(fixtureValue, { rerankModelConfigId: fixtureValue.rerankModelId }));
    const marker = "TOP_SECRET_STUDENT_QUERY_73";
    const execution = callerExecution(fixtureValue);
    const result = await fixtureValue.hybrid.retrieve({ ...request(fixtureValue, config, marker), providerExecutionContext: execution });
    assert.equal(result.status, "SUFFICIENT");
    assert.equal(fixtureValue.fakeEmbedding.requests.at(-1)?.inputs[0], marker);
    assert.equal(fixtureValue.fakeReranker.requests.at(-1)?.query, marker);
    assert.equal(JSON.stringify(result).includes(marker), false);
    assert.equal(JSON.stringify(fixtureValue.configs.getById(config.id)).includes(marker), false);
    const usageCount = Number((fixtureValue.database.client.prepare("select count(*) as count from ai_usage_cost_records where operation_id=?").get(execution.costOperationId) as { count: number }).count);
    assert.equal(usageCount, 2);
    assert.equal(fixtureValue.accounting.getOperation(execution.costOperationId)?.status, "OPEN");
    assert.equal(fixtureValue.admission.getReservation(execution.budgetReservationId)?.status, "EXECUTING");
  } finally { fixtureValue.close(); }
});

test("M7C model-space changes make existing M7B coverage unusable before a new Provider call", async () => {
  const fixtureValue = await fixture();
  try {
    await createKnowledge(fixtureValue, "algebra model fence evidence");
    const current = fixtureValue.models.getById(fixtureValue.modelId);
    assert.ok(current);
    fixtureValue.models.update({ id: current.id, content: { ...current, providerModelId: "m7c-embedding-v2" }, expectedRevision: current.revision, actor: fixtureValue.owner, now: fixtureValue.now + 1 });
    const config = publishRetrievalConfig(fixtureValue, retrievalConfigContent(fixtureValue));
    const result = await fixtureValue.hybrid.retrieve(request(fixtureValue, config, "algebra"));
    assert.equal(result.status, "INSUFFICIENT");
    assert.equal(result.safeReason, "SEMANTIC_COVERAGE_INCOMPLETE");
    assert.equal(fixtureValue.fakeEmbedding.calls, 1);
  } finally { fixtureValue.close(); }
});

test("M7C provider revision changes make the pinned M7B space unusable before a new Provider call", async () => {
  const fixtureValue = await fixture();
  try {
    await createKnowledge(fixtureValue, "algebra provider fence evidence");
    const current = fixtureValue.providers.getById(fixtureValue.providerId);
    assert.ok(current);
    fixtureValue.providers.update({ id: current.id, content: { ...current }, expectedRevision: current.revision, actor: fixtureValue.owner, now: fixtureValue.now + 1 });
    const config = publishRetrievalConfig(fixtureValue, retrievalConfigContent(fixtureValue));
    const result = await fixtureValue.hybrid.retrieve(request(fixtureValue, config, "algebra"));
    assert.equal(result.status, "INSUFFICIENT");
    assert.equal(result.safeReason, "SEMANTIC_COVERAGE_INCOMPLETE");
    assert.equal(fixtureValue.fakeEmbedding.calls, 1);
  } finally { fixtureValue.close(); }
});

test("M7C excludes a Knowledge origin as soon as its live Source becomes ineligible", async () => {
  const fixtureValue = await fixture();
  try {
    const origin = await createKnowledge(fixtureValue, "algebra ineligible source evidence");
    const source = fixtureValue.sources.getById(origin.sourceId);
    assert.ok(source);
    fixtureValue.sources.appendRevision({ id: source.id, expectedRevision: source.currentRevision, content: sourceRevisionContent(source, { enabled: false, rightsStatus: "RESTRICTED", rightsBasis: null }), actor: fixtureValue.owner, now: fixtureValue.now + 1 });
    const config = publishRetrievalConfig(fixtureValue, retrievalConfigContent(fixtureValue));
    const result = await fixtureValue.hybrid.retrieve(request(fixtureValue, config, "algebra"));
    assert.equal(result.status, "INSUFFICIENT");
    assert.equal(result.safeReason, "NO_CANDIDATES");
    assert.equal(fixtureValue.fakeEmbedding.calls, 1);
  } finally { fixtureValue.close(); }
});

test("M7C searches multiple origins with one global deterministic semantic ranking", async () => {
  const fixtureValue = await fixture();
  try {
    const first = await createKnowledge(fixtureValue, "algebra primary evidence");
    const second = await createKnowledge(fixtureValue, "algebra secondary evidence");
    const config = publishRetrievalConfig(fixtureValue, retrievalConfigContent(fixtureValue));
    const result = await fixtureValue.hybrid.retrieve(request(fixtureValue, config, "algebra"));
    assert.equal(result.status, "SUFFICIENT");
    assert.equal(result.trace.m7aProjectionRevisionIds.length, 2);
    assert.equal(result.trace.m7bEmbeddingProjectionRevisionIds.length, 2);
    assert.equal(result.candidateCounts.semantic, 2);
    assert.equal(result.items.some((item) => item.originId === first.packageId && item.semanticRank === 1), true);
    assert.equal(result.items.some((item) => item.originId === second.packageId && item.semanticRank === 2), true);
    assert.deepEqual(result.trace.rankedSignals.map((item) => item.semanticRank).sort((left, right) => (left ?? 0) - (right ?? 0)), [1, 2]);
  } finally { fixtureValue.close(); }
});

test("M7C enforces semanticCandidateLimit globally across five origins before RRF", async () => {
  const fixtureValue = await fixture();
  try {
    for (let index = 0; index < 5; index += 1) await createKnowledge(fixtureValue, `algebra relevant origin ${index}`);
    const config = publishRetrievalConfig(fixtureValue, retrievalConfigContent(fixtureValue, { semanticCandidateLimit: 2, fusionCandidateLimit: 10 }));
    const first = await fixtureValue.hybrid.retrieve(request(fixtureValue, config, "algebra"));
    const second = await fixtureValue.hybrid.retrieve(request(fixtureValue, config, "algebra"));
    assert.equal(first.status, "SUFFICIENT");
    assert.equal(first.candidateCounts.semantic, 2);
    assert.deepEqual(first.trace.rankedSignals.filter((item) => item.semanticRank !== null).map((item) => item.semanticRank).sort((left, right) => (left ?? 0) - (right ?? 0)), [1, 2]);
    assert.deepEqual(first.trace.selectedChunkIds, second.trace.selectedChunkIds);
  } finally { fixtureValue.close(); }
});

test("M7C rejects a new eligible Knowledge origin discovered by the final origin-set fence", async () => {
  const fixtureValue = await fixture();
  try {
    await createKnowledge(fixtureValue, "algebra initial evidence");
    const config = publishRetrievalConfig(fixtureValue, retrievalConfigContent(fixtureValue));
    const requestValue = request(fixtureValue, config, "algebra");
    const hybrid = createHybridWithFinalFence(fixtureValue, () => { createKnowledgePackage(fixtureValue, "algebra newly published evidence"); });
    const result = await hybrid.retrieve(requestValue);
    assert.equal(result.status, "INSUFFICIENT");
    assert.equal(result.safeReason, "RETRIEVAL_SCOPE_CHANGED");
    assert.equal(result.items.length, 0);
    assert.equal(usageCountForOperation(fixtureValue, requestValue.providerExecutionContext.costOperationId), 1);
    assert.equal(fixtureValue.fakeEmbedding.calls, 2);
  } finally { fixtureValue.close(); }
});

test("M7C rejects a source that becomes newly eligible during retrieval", async () => {
  const fixtureValue = await fixture();
  try {
    await createKnowledge(fixtureValue, "algebra initial evidence");
    const pending = createKnowledgePackage(fixtureValue, "algebra re-enabled evidence", "arabic", { enabled: false, rightsStatus: "RESTRICTED", rightsBasis: null });
    const config = publishRetrievalConfig(fixtureValue, retrievalConfigContent(fixtureValue));
    const requestValue = request(fixtureValue, config, "algebra");
    const hybrid = createHybridWithFinalFence(fixtureValue, () => {
      const source = fixtureValue.sources.getById(pending.sourceId);
      assert.ok(source);
      fixtureValue.sources.appendRevision({ id: source.id, expectedRevision: source.currentRevision, content: sourceRevisionContent(source, { enabled: true, rightsStatus: "CLEARED", rightsBasis: "OWNED" }), actor: fixtureValue.owner, now: fixtureValue.now + 1 });
    });
    const result = await hybrid.retrieve(requestValue);
    assert.equal(result.status, "INSUFFICIENT");
    assert.equal(result.safeReason, "RETRIEVAL_SCOPE_CHANGED");
    assert.equal(result.items.length, 0);
    assert.equal(usageCountForOperation(fixtureValue, requestValue.providerExecutionContext.costOperationId), 1);
  } finally { fixtureValue.close(); }
});

test("M7C rejects a new canonical Question origin discovered by the final origin-set fence", async () => {
  const fixtureValue = await fixture();
  try {
    await createKnowledge(fixtureValue, "algebra initial evidence");
    const config = publishRetrievalConfig(fixtureValue, retrievalConfigContent(fixtureValue));
    const requestValue = request(fixtureValue, config, "algebra");
    const hybrid = createHybridWithFinalFence(fixtureValue, () => { createQuestionPackage(fixtureValue, "algebra newly published Question"); });
    const result = await hybrid.retrieve(requestValue);
    assert.equal(result.status, "INSUFFICIENT");
    assert.equal(result.safeReason, "RETRIEVAL_SCOPE_CHANGED");
    assert.equal(result.items.length, 0);
    assert.equal(usageCountForOperation(fixtureValue, requestValue.providerExecutionContext.costOperationId), 1);
  } finally { fixtureValue.close(); }
});

test("M7C exposes a provider-free exact EvidencePack freshness fence for M8B", async () => {
  const fixtureValue = await fixture();
  try {
    const origin = await createKnowledge(fixtureValue, "exact freshness evidence");
    const config = publishRetrievalConfig(fixtureValue, retrievalConfigContent(fixtureValue));
    const requestValue = request(fixtureValue, config, "freshness");
    const pack = await fixtureValue.hybrid.retrieve(requestValue);
    assert.equal(pack.status, "SUFFICIENT");
    assert.equal(pack.trace.eligibleOriginIdentities.length, 1);
    assert.equal(pack.trace.m7aProjectionRefs[0]?.projectionRevisionId, origin.m7aRevisionId);
    fixtureValue.hybrid.assertEvidencePackCurrent(pack);
    const source = fixtureValue.sources.getById(origin.sourceId);
    assert.ok(source);
    fixtureValue.sources.appendRevision({ id: origin.sourceId, expectedRevision: source.currentRevision, content: sourceRevisionContent(source, { rightsStatus: "RESTRICTED", rightsBasis: null }), actor: fixtureValue.owner, now: fixtureValue.now + 1 });
    assert.throws(() => fixtureValue.hybrid.assertEvidencePackCurrent(pack), (error) => error instanceof AIHybridRetrievalError && error.code === "AI_HYBRID_FINAL_FENCE_FAILED");
  } finally { fixtureValue.close(); }
});

test("M7C carries exact Question occurrence and taxonomy provenance into EvidencePack without promoting trust", async () => {
  const fixtureValue = await fixture();
  try {
    const origin = await createQuestionWithProvenance(fixtureValue, "algebra provenance evidence");
    const config = publishRetrievalConfig(fixtureValue, retrievalConfigContent(fixtureValue));
    const result = await fixtureValue.hybrid.retrieve(request(fixtureValue, config, "algebra"));
    const item = result.items.find((candidate) => candidate.questionId === origin.questionId);
    assert.ok(item);
    assert.equal(item.trustTier, "PYTHAGORAS_APPROVED");
    const occurrences = item.originMetadata.occurrences as Array<Record<string, unknown>>;
    assert.equal(occurrences.length, 2);
    assert.equal(occurrences.find((occurrence) => occurrence.id === origin.occurrenceOne)?.revision, 2);
    assert.equal(occurrences.find((occurrence) => occurrence.id === origin.occurrenceTwo)?.sourceKind, "discussion-question");
    assert.deepEqual(occurrences.find((occurrence) => occurrence.id === origin.occurrenceOne)?.branches, ["Branch A"]);
    assert.deepEqual(occurrences.find((occurrence) => occurrence.id === origin.occurrenceTwo)?.qualifiers, ["Qualifier B"]);
    assert.equal((item.originMetadata.taxonomyAssignments as Array<Record<string, unknown>>)[0].taxonomyNodeId, origin.taxonomyNodeId);
    assert.equal((item.originMetadata.taxonomyAssignments as Array<Record<string, unknown>>)[0].role, "PRIMARY");
    assert.equal(typeof item.originMetadata.projectionId, "string");
    assert.equal(typeof item.originMetadata.projectionRevisionFingerprint, "string");
  } finally { fixtureValue.close(); }
});

test("M7C includes provenance in the EvidencePack byte bound without truncating metadata", () => {
  const candidate = fusedCandidate("provenance-heavy", { text: "ok", provenance: { section: "Section 1" }, originMetadata: { occurrence: "0123456789" } });
  const exactBytes = Buffer.byteLength(candidate.text, "utf8") + Buffer.byteLength(JSON.stringify(candidate.provenance), "utf8") + Buffer.byteLength(JSON.stringify(candidate.originMetadata), "utf8");
  const tooSmall = selectEvidence({ candidates: [candidate], config: { evidenceItemLimit: 1, maximumEvidencePackBytes: exactBytes - 1, maxEvidenceChunksPerSourceItem: 1, minimumEvidenceItemCount: 1 } });
  assert.equal(tooSmall.sufficient, false);
  assert.equal(tooSmall.items.length, 0);
  const exact = selectEvidence({ candidates: [candidate], config: { evidenceItemLimit: 1, maximumEvidencePackBytes: exactBytes, maxEvidenceChunksPerSourceItem: 1, minimumEvidenceItemCount: 1 } });
  assert.equal(exact.sufficient, true);
  assert.equal(exact.items[0].text, "ok");
  assert.deepEqual(exact.items[0].originMetadata, { occurrence: "0123456789" });
  assert.equal(exact.evidenceByteCount, exactBytes);
});
