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
import { questionPackages, questions, questionVariants, questionPrimaryVariants } from "../src/server/content/schema";
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
    assert.equal(migrationCount, 27);
    for (const table of ["ai_retrieval_configs", "ai_retrieval_config_revisions"]) {
      assert.ok(fixtureValue.database.client.prepare("select name from sqlite_master where type='table' and name=?").get(table));
      const columns = fixtureValue.database.client.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>;
      assert.equal(columns.some((column) => /query|prompt|message|answer|secret|credential|authorization/i.test(column.name)), false);
    }
  } finally { fixtureValue.close(); }
});

test("0026 upgrades a 0025 database with only Retrieval Config metadata", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-m7c-migration-"));
  const oldMigrations = mkdtempSync(path.join(os.tmpdir(), "pythagoras-m7c-old-migrations-"));
  try {
    mkdirSync(path.join(oldMigrations, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(path.join(migrationsDirectory, "meta", "_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }>; [key: string]: unknown };
    for (const entry of journal.entries.slice(0, 26)) {
      copyFileSync(path.join(migrationsDirectory, `${entry.tag}.sql`), path.join(oldMigrations, `${entry.tag}.sql`));
      const snapshotName = `${entry.idx.toString().padStart(4, "0")}_snapshot.json`;
      if (existsSync(path.join(migrationsDirectory, "meta", snapshotName))) copyFileSync(path.join(migrationsDirectory, "meta", snapshotName), path.join(oldMigrations, "meta", snapshotName));
    }
    const currentJournal = JSON.parse(readFileSync(path.join(migrationsDirectory, "meta", "_journal.json"), "utf8")) as { version: string; dialect: string; entries: unknown[] };
    writeFileSync(path.join(oldMigrations, "meta", "_journal.json"), JSON.stringify({ ...currentJournal, entries: currentJournal.entries.slice(0, 26) }));
    const before = openContentDatabase({ dataDirectory: root, migrationsDirectory: oldMigrations });
    assert.equal(Number((before.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count), 26);
    before.close();
    const upgraded = openContentDatabase({ dataDirectory: root, migrationsDirectory });
    assert.equal(Number((upgraded.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count), 27);
    assert.ok(upgraded.client.prepare("select name from sqlite_master where name='ai_retrieval_configs'").get());
    upgraded.close();
  } finally {
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

test("Evidence selection skips oversized text without truncation and scopes source-item limits per origin", () => {
  const first = fusedCandidate("oversized", { text: "0123456789abc" });
  const second = fusedCandidate("fits", { text: "ok" });
  const otherOrigin = fusedCandidate("other-origin", { originId: "origin-b", sourceItemId: "item-a", text: "yes" });
  const result = selectEvidence({ candidates: [first, second, otherOrigin], config: { evidenceItemLimit: 3, maximumEvidencePackBytes: 5, maxEvidenceChunksPerSourceItem: 1, minimumEvidenceItemCount: 1 } });
  assert.deepEqual(result.items.map((item) => item.chunkId), ["fits", "other-origin"]);
  assert.equal(result.items[0].text, "ok");
  assert.equal(result.evidenceByteCount, 5);
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
    assert.equal(result.safeReason, "SOURCE_INELIGIBLE");
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
