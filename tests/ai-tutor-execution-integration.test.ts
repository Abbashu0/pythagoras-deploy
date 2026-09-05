import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../src/server/admin-auth";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import { AIBudgetAdmissionService, createAIAdmissionRequestFingerprint } from "../src/server/ai/admission";
import { AIContextService, type AIContextTokenEstimator } from "../src/server/ai/context";
import type {
  AIProviderGatewayOperationOptions,
  AIModelSelectionPlan,
  EmbeddingProviderAdapter,
  EmbeddingProviderRequest,
  EmbeddingProviderResult,
  GenerationProviderAdapter,
  GenerationProviderRequest,
  ProviderAdapterExecutionContext,
  ProviderGenerationStreamEvent,
  RerankerProviderAdapter,
  RerankProviderRequest,
  RerankProviderResult,
  NormalizedProviderUsage,
} from "../src/server/ai/gateway";
import { AIProviderAdapterError, AIProviderGateway, ProviderAdapterRegistry } from "../src/server/ai/gateway";
import {
  AIBillingUsageNormalizerRegistry,
  AICostAccountingService,
  AICostCalculator,
  AIRateCardResolver,
  SQLiteAIAccountingRepository,
  SQLiteAIRateCardModelRevisionRepository,
  SQLiteAIRateCardRepository,
} from "../src/server/ai/economics";
import { SQLiteAIBudgetPolicyRepository } from "../src/server/ai/budget";
import { SQLiteAIContextPolicyRepository, SQLiteAIInstructionPolicyRepository } from "../src/server/ai/policy";
import { SQLiteAIRateLimitPolicyRepository } from "../src/server/ai/rate-limits";
import {
  AIEmbeddingProjectionHealthService,
  AIEmbeddingProjectionService,
  AI_EMBEDDING_VECTOR_CODEC_KEY,
  AI_EMBEDDING_VECTOR_CODEC_REVISION,
  AI_EMBEDDING_VECTOR_INDEX_ADAPTER_KEY,
  createAIEmbeddingJobHandler,
  createSQLiteAIEmbeddingCostEstimator,
  SQLiteAIEmbeddingProjectionRepository,
  SQLiteAIVectorIndexAdapter,
} from "../src/server/ai/embedding";
import {
  AIChunkProjectionBuilder,
  AIRetrievalProjectionHealthService,
  HybridRetrievalService,
  SQLiteAILexicalRetrievalAdapter,
  SQLiteAIRetrievalProjectionRepository,
  type AIHybridRetrievalRequest,
  type AIEvidencePack,
} from "../src/server/ai/retrieval";
import {
  AI_RETRIEVAL_CONFIG_RESOURCE_TYPE,
  SQLiteAIRetrievalConfigRepository,
  type AIRetrievalConfigContent,
} from "../src/server/ai/retrieval-config";
import { SQLiteAIKnowledgePackageRepository, SQLiteAIKnowledgeSourceRepository, type AIKnowledgeSource, type AIKnowledgeSourceContent } from "../src/server/ai/knowledge";
import { SQLiteAIModelConfigRepository } from "../src/server/ai/model-registry";
import { SQLiteAIProviderConfigRepository } from "../src/server/ai/configuration";
import { createLocalAISecretStore, type LocalEncryptedAISecretStore } from "../src/server/ai/secrets";
import { AIJobHandlerRegistry, AIJobQueueService } from "../src/server/ai/operations/jobs";
import { AIWorker } from "../src/server/ai/operations/worker";
import {
  AI_TUTOR_CONFIG_RESOURCE_TYPE,
  AITutorExecutionError,
  AITutorExecutionService,
  AITutorGenerationPlanner,
  AITutorPreflightService,
  AITutorResponseTraceService,
  SQLiteAITutorConfigRepository,
  type AITutorConfigContent,
} from "../src/server/ai/tutor";
import { AI_MEMORY_POLICY_RESOURCE_TYPE } from "../src/server/ai/memory";
import { AIConversationService, SQLiteAIConversationRepository, type AIStudentPrincipal } from "../src/server/ai/conversations";
import { createChangeManagementService } from "../src/server/change-management";
import { createCanonicalContentRepository } from "../src/server/canonical-content/service";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";
import { AIIntelligenceTelemetryService } from "../src/server/ai/telemetry";
import type { CanonicalRichDocument } from "../src/server/questions/contracts";

const MIGRATIONS = path.join(process.cwd(), "drizzle");
const BASE_TIME = 1_903_000_000_000;
const MASTER_KEY = Buffer.alloc(32, 0x5a);
const PRINCIPAL: AIStudentPrincipal = { principalRef: "student-m8b-integration", status: "ACTIVE" };
const QUERY_MARKER = "TOP_SECRET_STUDENT_QUERY_M8B_91";
const EVIDENCE_MARKER = "PRIVATE_EVIDENCE_TEXT_M8B_27";

type GenerationBehavior = {
  finishReason: "STOP" | "LENGTH" | "CONTENT_FILTER" | "OTHER";
  deltas: string[];
  usageEvents: NormalizedProviderUsage[];
  finalUsage: NormalizedProviderUsage;
  failure?: { code: "UNAVAILABLE" | "TIMEOUT" | "AUTHENTICATION"; afterUsage?: boolean };
  waitForAbort?: boolean;
  memoryCommand?: Readonly<Record<string, unknown>>;
};

const knownUsage = (inputTokens: number, outputTokens: number): NormalizedProviderUsage => ({
  inputTokens,
  outputTokens,
  reasoningTokens: 0,
  cacheHitInputTokens: 0,
  cacheMissInputTokens: 0,
});

const unknownUsage = (): NormalizedProviderUsage => ({
  inputTokens: null,
  outputTokens: null,
  reasoningTokens: null,
  cacheHitInputTokens: null,
  cacheMissInputTokens: null,
});

class IntegrationGenerationAdapter implements GenerationProviderAdapter {
  readonly adapterKey = "test.m8b.integration-generation";
  readonly capability = "GENERATION" as const;
  calls = 0;
  requests: GenerationProviderRequest[] = [];
  credentials: string[] = [];
  behavior: GenerationBehavior = { finishReason: "STOP", deltas: ["إجابة تكاملية [E1]"], usageEvents: [], finalUsage: knownUsage(20, 3) };
  private startedResolver: (() => void) | null = null;
  readonly started = new Promise<void>((resolve) => { this.startedResolver = resolve; });
  private waitingResolver: (() => void) | null = null;
  readonly waiting = new Promise<void>((resolve) => { this.waitingResolver = resolve; });
  private abortObservedResolver: (() => void) | null = null;
  readonly abortObserved = new Promise<void>((resolve) => { this.abortObservedResolver = resolve; });
  abortObservedAt: number | null = null;
  onProviderFinished: (() => void) | null = null;

  async *generate(request: GenerationProviderRequest, context: ProviderAdapterExecutionContext): AsyncIterable<ProviderGenerationStreamEvent> {
    this.calls += 1;
    this.requests.push(request);
    this.credentials.push(context.credential);
    this.startedResolver?.();
    yield { type: "STARTED", providerRequestId: `integration-request-${this.calls}` };
    for (const delta of this.behavior.deltas) yield { type: "TEXT_DELTA", text: delta };
    if (this.behavior.memoryCommand) yield { type: "MEMORY_COMMAND", command: this.behavior.memoryCommand };
    for (const usage of this.behavior.usageEvents) yield { type: "USAGE", usage };
    if (this.behavior.waitForAbort) {
      await new Promise<void>((resolve) => {
        const observeAbort = () => {
          this.abortObservedAt = performance.now();
          this.abortObservedResolver?.();
          resolve();
        };
        if (context.signal.aborted) {
          observeAbort();
        } else {
          context.signal.addEventListener("abort", observeAbort, { once: true });
          this.waitingResolver?.();
        }
      });
      throw new AIProviderAdapterError("CANCELLED");
    }
    if (this.behavior.failure) {
      this.onProviderFinished?.();
      throw new AIProviderAdapterError(this.behavior.failure.code, { retryable: false, fallbackEligible: false });
    }
    yield { type: "COMPLETED", finishReason: this.behavior.finishReason, usage: this.behavior.finalUsage, providerRequestId: `integration-request-${this.calls}` };
    this.onProviderFinished?.();
  }
}

class IntegrationEmbeddingAdapter implements EmbeddingProviderAdapter {
  readonly adapterKey = "test.m8b.integration-embedding";
  readonly capability = "EMBEDDING" as const;
  calls = 0;
  requests: EmbeddingProviderRequest[] = [];
  onCall: ((request: EmbeddingProviderRequest) => void) | null = null;

  async embed(request: EmbeddingProviderRequest, _context: ProviderAdapterExecutionContext): Promise<EmbeddingProviderResult> {
    this.calls += 1;
    this.requests.push(request);
    this.onCall?.(request);
    return {
      vectors: request.inputs.map(() => [1, 0, 0]),
      dimensions: 3,
      usage: { inputTokens: request.inputs.reduce((sum, value) => sum + Buffer.byteLength(value, "utf8"), 0), outputTokens: null, reasoningTokens: null, cacheHitInputTokens: null, cacheMissInputTokens: null },
      providerRequestId: `integration-embedding-${this.calls}`,
    };
  }
}

class IntegrationRerankerAdapter implements RerankerProviderAdapter {
  readonly adapterKey = "test.m8b.integration-rerank";
  readonly capability = "RERANK" as const;
  calls = 0;
  requests: RerankProviderRequest[] = [];

  async rerank(request: RerankProviderRequest, _context: ProviderAdapterExecutionContext): Promise<RerankProviderResult> {
    this.calls += 1;
    this.requests.push(request);
    return { results: request.candidates.map((candidate, index) => ({ candidateId: candidate.id, score: 1 - index / 100, rank: index + 1 })), usage: knownUsage(Buffer.byteLength(request.query, "utf8"), 0), providerRequestId: `integration-rerank-${this.calls}` };
  }
}

interface IntegrationFixture {
  root: string;
  database: ContentDatabase;
  owner: AdminActor;
  principal: AIStudentPrincipal;
  secrets: LocalEncryptedAISecretStore;
  providers: SQLiteAIProviderConfigRepository;
  models: SQLiteAIModelConfigRepository;
  sources: SQLiteAIKnowledgeSourceRepository;
  packages: SQLiteAIKnowledgePackageRepository;
  retrievals: SQLiteAIRetrievalConfigRepository;
  tutorConfigs: ReturnType<typeof createTutorRepository>;
  instructions: SQLiteAIInstructionPolicyRepository;
  contexts: SQLiteAIContextPolicyRepository;
  conversations: AIConversationService;
  context: AIContextService;
  preflight: AITutorPreflightService;
  admission: AIBudgetAdmissionService;
  accounting: AICostAccountingService;
  accountingRepository: SQLiteAIAccountingRepository;
  gateway: AIProviderGateway;
  hybrid: HybridRetrievalService;
  traces: AITutorResponseTraceService;
  execution: (options?: ExecutionOptions) => AITutorExecutionService;
  generation: IntegrationGenerationAdapter;
  embedding: IntegrationEmbeddingAdapter;
  reranker: IntegrationRerankerAdapter;
  generationModelId: string;
  embeddingModelId: string;
  rerankModelId: string | null;
  providerId: string;
  sourceId: string;
  packageId: string;
  m7aRevisionId: string;
  m7bRevisionId: string;
  studentBudgetPolicyId: string;
  embeddingBudgetPolicyId: string;
  rateLimitPolicyId: string;
  close(): void;
}

type ExecutionOptions = {
  afterRetrieve?: (pack: AIEvidencePack) => void;
  afterGenerationAccounting?: () => void;
  beforeGenerate?: () => void;
  onPreflight?: (plan: TutorPreflightPlan) => void;
  onRequest?: (request: AIHybridRetrievalRequest) => void;
  accounting?: AITutorExecutionDependenciesLike["accounting"];
  admission?: AITutorExecutionDependenciesLike["admission"];
};

type AITutorExecutionDependenciesLike = ConstructorParameters<typeof AITutorExecutionService>[0];
type TutorPreflightPlan = ReturnType<AITutorExecutionDependenciesLike["preflight"]["preflight"]>;

function createTutorRepository(database: ContentDatabase): SQLiteAITutorConfigRepository {
  return new SQLiteAITutorConfigRepository(database);
}

async function createFixture(options: { withRerank?: boolean; rateLimit?: { maxRequests: number; maxConcurrentRequests: number } } = {}): Promise<IntegrationFixture> {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-m8b-integration-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory: MIGRATIONS });
  createCanonicalContentRepository(database).bootstrap();
  const identities = new SQLiteAdminIdentityRepository(database);
  const ownerUser = identities.createInitialOwner({ id: uuidv7(), email: `owner-${uuidv7()}@m8b-integration.test`, displayName: "M8B Integration Owner", passwordHash: "fixture", createdAt: BASE_TIME });
  const owner: AdminActor = { actorUserId: ownerUser.id, actorRole: "OWNER" };
  const secrets = createLocalAISecretStore(database, { masterKey: MASTER_KEY, clock: () => BASE_TIME });
  const secretValue = `m8b-integration-secret-${uuidv7()}`;
  const secret = await secrets.create({ secret: secretValue, actor: { type: "ADMIN", actorUserId: owner.actorUserId } });
  const providers = new SQLiteAIProviderConfigRepository(database);
  const providerId = uuidv7();
  providers.create({ id: providerId, content: { key: `m8b-provider-${uuidv7()}`, displayName: "M8B Integration Provider", baseUrl: "https://provider.example/v1", credentialRef: secret.credentialRef, enabled: true, retentionPolicy: "UNKNOWN", trainingPolicy: "UNKNOWN", zdrSupported: false, zdrRequired: false }, actor: owner, now: BASE_TIME - 100 });
  const models = new SQLiteAIModelConfigRepository(database);
  const generationModelId = uuidv7();
  models.create({ id: generationModelId, content: { key: `m8b-generation-${uuidv7()}`, displayName: "M8B Generation", providerConfigId: providerId, providerModelId: "m8b-generation-model", capability: "GENERATION", adapterKey: "test.m8b.integration-generation", enabled: true, contextWindowTokens: 20_000, maxOutputTokens: 100, embeddingDimensions: null, supportsStreaming: true, supportsReasoning: false, supportsStructuredOutput: false }, actor: owner, now: BASE_TIME - 90 });
  const embeddingModelId = uuidv7();
  models.create({ id: embeddingModelId, content: { key: `m8b-embedding-${uuidv7()}`, displayName: "M8B Embedding", providerConfigId: providerId, providerModelId: "m8b-embedding-model", capability: "EMBEDDING", adapterKey: "test.m8b.integration-embedding", enabled: true, contextWindowTokens: null, maxOutputTokens: null, embeddingDimensions: 3, supportsStreaming: false, supportsReasoning: false, supportsStructuredOutput: false }, actor: owner, now: BASE_TIME - 80 });
  const rerankModelId = options.withRerank ? uuidv7() : null;
  if (rerankModelId) models.create({ id: rerankModelId, content: { key: `m8b-rerank-${uuidv7()}`, displayName: "M8B Rerank", providerConfigId: providerId, providerModelId: "m8b-rerank-model", capability: "RERANK", adapterKey: "test.m8b.integration-rerank", enabled: true, contextWindowTokens: null, maxOutputTokens: null, embeddingDimensions: null, supportsStreaming: false, supportsReasoning: false, supportsStructuredOutput: false }, actor: owner, now: BASE_TIME - 70 });
  const instructions = new SQLiteAIInstructionPolicyRepository(database);
  const globalPolicyId = uuidv7();
  instructions.create({ id: globalPolicyId, content: { key: `m8b-global-${uuidv7()}`, scope: "GLOBAL", subjectKey: null, displayName: "M8B Global", instructions: "Global grounding rules.", enabled: true }, actor: owner, now: BASE_TIME - 60 });
  const subjectPolicyId = uuidv7();
  instructions.create({ id: subjectPolicyId, content: { key: `m8b-biology-${uuidv7()}`, scope: "SUBJECT", subjectKey: "biology", displayName: "M8B Biology", instructions: "Biology guidance.", enabled: true }, actor: owner, now: BASE_TIME - 59 });
  const contexts = new SQLiteAIContextPolicyRepository(database);
  const contextPolicyId = uuidv7();
  contexts.create({ id: contextPolicyId, content: { key: `m8b-context-${uuidv7()}`, displayName: "M8B Context", softInputBudgetTokens: 1_000, hardInputBudgetTokens: 8_000, outputReserveTokens: 100, policyBudgetTokens: 1_000, summaryBudgetTokens: 500, recentTurnsBudgetTokens: 1_000, memoryBudgetTokens: 100, evidenceBudgetTokens: 4_000, maxRecentTurns: 3, enabled: true }, actor: owner, now: BASE_TIME - 58 });
  const studentBudgetPolicyId = uuidv7();
  new SQLiteAIBudgetPolicyRepository(database).create({ id: studentBudgetPolicyId, content: { key: `m8b-student-budget-${uuidv7()}`, displayName: "M8B Student Budget", currency: "USD", costCenter: "STUDENT_GENERATION", hardCapNano: 1_000_000_000, enabled: true }, actor: owner, now: BASE_TIME - 57 });
  const embeddingBudgetPolicyId = uuidv7();
  new SQLiteAIBudgetPolicyRepository(database).create({ id: embeddingBudgetPolicyId, content: { key: `m8b-index-budget-${uuidv7()}`, displayName: "M8B Index Budget", currency: "USD", costCenter: "KNOWLEDGE_INDEXING", hardCapNano: 1_000_000_000, enabled: true }, actor: owner, now: BASE_TIME - 56 });
  const rateLimitPolicyId = uuidv7();
  const rateLimit = options.rateLimit ?? { maxRequests: 100, maxConcurrentRequests: 100 };
  new SQLiteAIRateLimitPolicyRepository(database).create({ id: rateLimitPolicyId, content: { key: `m8b-rate-${uuidv7()}`, displayName: "M8B Rate", windowMs: 60_000, maxRequests: rateLimit.maxRequests, maxConcurrentRequests: rateLimit.maxConcurrentRequests, enabled: true }, actor: owner, now: BASE_TIME - 55 });
  const rateCards = new SQLiteAIRateCardRepository(database);
  createRateCard(rateCards, embeddingModelId, "m8b.embedding", [{ component: "STANDARD_INPUT", unit: "PER_MILLION_TOKENS", amountNano: 1_000_000 }, { component: "REQUEST", unit: "PER_REQUEST", amountNano: 100 }], owner, BASE_TIME - 50);
  if (rerankModelId) createRateCard(rateCards, rerankModelId, "m8b.rerank", [{ component: "STANDARD_INPUT", unit: "PER_MILLION_TOKENS", amountNano: 1_000_000 }, { component: "REQUEST", unit: "PER_REQUEST", amountNano: 100 }], owner, BASE_TIME - 49);
  createRateCard(rateCards, generationModelId, "m8b.generation", [{ component: "STANDARD_INPUT", unit: "PER_MILLION_TOKENS", amountNano: 1_000_000 }, { component: "OUTPUT", unit: "PER_MILLION_TOKENS", amountNano: 2_000_000 }, { component: "REQUEST", unit: "PER_REQUEST", amountNano: 100 }], owner, BASE_TIME - 48);
  const accountingRepository = new SQLiteAIAccountingRepository(database);
  const accounting = new AICostAccountingService({ rateCardResolver: new AIRateCardResolver(rateCards, new SQLiteAIRateCardModelRevisionRepository(database)), billingNormalizers: new AIBillingUsageNormalizerRegistry([
    { key: "m8b.embedding", normalize: toBillableUsage },
    { key: "m8b.rerank", normalize: toBillableUsage },
    { key: "m8b.generation", normalize: toBillableUsage },
  ]), costCalculator: new AICostCalculator(), accounting: accountingRepository });
  const generation = new IntegrationGenerationAdapter();
  const embedding = new IntegrationEmbeddingAdapter();
  const reranker = new IntegrationRerankerAdapter();
  const adapters = new ProviderAdapterRegistry([generation, embedding, reranker]);
  const gateway = new AIProviderGateway({ providerConfigs: providers, modelConfigs: models, secrets, adapters }, { clock: () => BASE_TIME });
  const changes = createChangeManagementService(database);
  const retrievals = new SQLiteAIRetrievalConfigRepository(database);
  const retrievalConfigId = uuidv7();
  const retrievalContent = retrievalConfigContent(embeddingModelId, rerankModelId);
  publishChange(changes, owner, AI_RETRIEVAL_CONFIG_RESOURCE_TYPE, retrievalConfigId, retrievalContent);
  const sources = new SQLiteAIKnowledgeSourceRepository(database);
  const sourceId = uuidv7();
  sources.create({ id: sourceId, content: sourceContent(), actor: owner, now: BASE_TIME - 40 });
  const packages = new SQLiteAIKnowledgePackageRepository(database);
  const packageId = uuidv7();
  const documentId = uuidv7();
  const richContent: CanonicalRichDocument = { type: "doc", version: 1, blocks: [{ id: uuidv7(), type: "paragraph", spans: [{ text: EVIDENCE_MARKER + " mitochondria are cellular structures" }] }] };
  packages.create({ id: packageId, content: { key: `m8b-package-${uuidv7()}`, subjectKey: "biology", title: "M8B Biology Package", language: "ar", contentRevision: 1, sourceId, sourceRevision: 1, artifactRef: "a".repeat(64), artifactSha256: "a".repeat(64), artifactByteSize: 1 }, documents: [{ packageRevisionId: "pending", documentId, displayOrder: 1, title: "Biology evidence", provenance: { pageStart: 1, section: "cells" }, content: richContent }], assets: [], actor: owner, now: BASE_TIME - 39 });
  const m7a = new AIChunkProjectionBuilder(database).build({ originKind: "KNOWLEDGE_PACKAGE", originId: packageId, subjectKey: "biology" });
  const m7aRepository = new SQLiteAIRetrievalProjectionRepository(database);
  const m7aSet = m7aRepository.getSet({ originKind: "KNOWLEDGE_PACKAGE", originId: packageId, subjectKey: "biology", strategyKey: "structured-rich-v1", normalizerKey: "retrieval-text-v1" });
  assert.ok(m7aSet);
  const embeddingRepository = new SQLiteAIEmbeddingProjectionRepository(database);
  const embeddingHealth = new AIEmbeddingProjectionHealthService(database, { projections: embeddingRepository, models });
  const vectorIndex = new SQLiteAIVectorIndexAdapter(database, { isRevisionSearchable: (revision) => embeddingHealth.isRevisionSearchable(revision) });
  const handlers = new AIJobHandlerRegistry();
  const workerJobs = new AIJobQueueService(database, handlers, { clock: () => BASE_TIME });
  const embeddingService = new AIEmbeddingProjectionService(database, { m7aProjections: m7aRepository, m7aHealth: new AIRetrievalProjectionHealthService(database), projections: embeddingRepository, vectorIndex, models, providers, secrets, adapters, gateway, jobs: workerJobs, admission: new AIBudgetAdmissionService(database, { clock: () => BASE_TIME }), accounting, costEstimator: createSQLiteAIEmbeddingCostEstimator(new AIRateCardResolver(rateCards, new SQLiteAIRateCardModelRevisionRepository(database))), clock: () => BASE_TIME });
  handlers.register(createAIEmbeddingJobHandler(embeddingService));
  const worker = new AIWorker({ jobs: workerJobs, handlers, workerId: `m8b-worker-${uuidv7()}`, clock: () => BASE_TIME });
  const embeddingBuild = embeddingService.startBuild({ subjectKey: "biology", chunkProjectionSetId: m7aSet.id, modelConfigId: embeddingModelId, budgetPolicyId: embeddingBudgetPolicyId, budgetPolicyRevision: 1, rateLimitPolicyId, rateLimitPolicyRevision: 1, budgetPeriod: { startAt: 0, endAt: BASE_TIME + 100_000 }, batchSize: 50 });
  await worker.runOnce(BASE_TIME);
  assert.equal(embeddingBuild.status, "BUILDING");
  assert.equal(embeddingService.isRevisionSearchable(embeddingRepository.getRevision(embeddingBuild.embeddingProjectionRevisionId)!), true);
  const configsHealth = new AIRetrievalProjectionHealthService(database);
  const hybrid = new HybridRetrievalService({ database, configs: retrievals, models, providers, m7aHealth: configsHealth, lexical: new SQLiteAILexicalRetrievalAdapter(database), embeddings: embeddingRepository, embeddingHealth, vectors: vectorIndex, sources, gateway, accounting, admission: new AIBudgetAdmissionService(database, { clock: () => BASE_TIME }) });
  const conversations = new AIConversationService(database, { clock: () => BASE_TIME });
  const context = new AIContextService(database, { clock: () => BASE_TIME });
  const tutorConfigs = createTutorRepository(database);
  const tutorConfigId = uuidv7();
  publishChange(changes, owner, AI_TUTOR_CONFIG_RESOURCE_TYPE, tutorConfigId, { key: `m8b-tutor-${uuidv7()}`, subjectKey: "biology", displayName: "M8B Tutor", enabled: true, generationModelConfigId: generationModelId, contextPolicyId, retrievalConfigId, budgetPolicyId: studentBudgetPolicyId, rateLimitPolicyId, maxOutputTokens: 40 });
  const preflight = new AITutorPreflightService(database, { conversations: new SQLiteAIConversationRepository(database), context, models, providers, retrievalConfigs: retrievals, contextPolicies: contexts, adapters, clock: () => BASE_TIME });
  const admission = new AIBudgetAdmissionService(database, { clock: () => BASE_TIME });
  const traces = AITutorResponseTraceService.forDatabase(database);
  const estimator = integrationEstimator();
  const execution = (executionOptions: ExecutionOptions = {}) => {
    const retrieval = {
      async retrieve(request: AIHybridRetrievalRequest) {
        executionOptions.onRequest?.(request);
        const pack = await hybrid.retrieve(request);
        executionOptions.afterRetrieve?.(pack);
        return pack;
      },
      assertEvidencePackCurrent(pack: AIEvidencePack) { hybrid.assertEvidencePackCurrent(pack); },
    };
    const executionGateway = {
      generate(plan: AIModelSelectionPlan, request: GenerationProviderRequest, gatewayOptions: AIProviderGatewayOperationOptions) {
        executionOptions.beforeGenerate?.();
        return gateway.generate(plan, request, gatewayOptions);
      },
    };
    const executionAccounting = executionOptions.accounting ?? (executionOptions.afterGenerationAccounting ? afterGenerationAccounting(accounting, executionOptions.afterGenerationAccounting) : accounting);
    const executionPreflight = executionOptions.onPreflight ? {
      preflight(input: Parameters<AITutorExecutionDependenciesLike["preflight"]["preflight"]>[0]) {
        const plan = preflight.preflight(input);
        executionOptions.onPreflight?.(plan);
        return plan;
      },
    } : preflight;
    return new AITutorExecutionService({ database, preflight: executionPreflight, conversations, context, tutorConfigs, instructionPolicies: instructions, contextPolicies: contexts, retrievalConfigs: retrievals, budgetPolicies: new SQLiteAIBudgetPolicyRepository(database), rateLimitPolicies: new SQLiteAIRateLimitPolicyRepository(database), models, providers, accounting: executionAccounting, admission: executionOptions.admission ?? admission, retrieval, planner: new AITutorGenerationPlanner(), traces, gateway: executionGateway, estimator, budgetPeriodResolver: { resolve: () => ({ startAt: 0, endAt: BASE_TIME + 100_000 }) }, clock: () => BASE_TIME });
  };
  return { root, database, owner, principal: PRINCIPAL, secrets, providers, models, sources, packages, retrievals, tutorConfigs, instructions, contexts, conversations, context, preflight, admission, accounting, accountingRepository, gateway, hybrid, traces, execution, generation, embedding, reranker, generationModelId, embeddingModelId, rerankModelId, providerId, sourceId, packageId, m7aRevisionId: m7a.projectionRevisionId, m7bRevisionId: embeddingBuild.embeddingProjectionRevisionId, studentBudgetPolicyId, embeddingBudgetPolicyId, rateLimitPolicyId, close() { database.close(); rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }); } };
}

function integrationEstimator(): AIContextTokenEstimator {
  return { estimatorKey: "test.m8b.integration", estimate: (text) => text.trim() ? 1 : 0 };
}

function toBillableUsage(usage: NormalizedProviderUsage) {
  return { standardInputTokens: usage.inputTokens, cacheHitInputTokens: usage.cacheHitInputTokens, cacheMissInputTokens: usage.cacheMissInputTokens, outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens, requestUnits: 1 };
}

function sourceContent(): AIKnowledgeSourceContent {
  return { key: `m8b-source-${uuidv7()}`, subjectKey: "biology", sourceType: "PYTHAGORAS_APPROVED", displayName: "M8B Biology Source", language: "ar", edition: "integration", authorityName: "Pythagoras", authorityType: "TEST", trustTier: "PYTHAGORAS_APPROVED", rightsStatus: "CLEARED", rightsBasis: "OWNED", licenseName: null, attribution: "M8B integration", rightsNotes: null, sourceUrl: null, sourceAssetId: null, enabled: true, preparationMethod: "DETERMINISTIC", producerKey: "m8b", producerRevision: "1" };
}

function sourceRevisionContent(source: AIKnowledgeSource, overrides: Partial<AIKnowledgeSourceContent> = {}): AIKnowledgeSourceContent {
  return { key: source.key, subjectKey: source.subjectKey, sourceType: source.sourceType, displayName: source.displayName, language: source.language, edition: source.edition, authorityName: source.authorityName, authorityType: source.authorityType, trustTier: source.trustTier, rightsStatus: source.rightsStatus, rightsBasis: source.rightsBasis, licenseName: source.licenseName, attribution: source.attribution, rightsNotes: source.rightsNotes, sourceUrl: source.sourceUrl, sourceAssetId: source.sourceAssetId, enabled: source.enabled, preparationMethod: source.preparationMethod, producerKey: source.producerKey, producerRevision: source.producerRevision, ...overrides };
}

function retrievalConfigContent(embeddingModelConfigId: string, rerankModelConfigId: string | null): AIRetrievalConfigContent {
  return { key: `m8b-retrieval-${uuidv7()}`, subjectKey: "biology", displayName: "M8B Retrieval", enabled: true, embeddingModelConfigId, rerankModelConfigId, lexicalCandidateLimit: 10, semanticCandidateLimit: 10, fusionCandidateLimit: 10, rerankCandidateLimit: 10, evidenceItemLimit: 5, rrfConstant: 60, lexicalWeightUnits: 1, semanticWeightUnits: 1, minimumFusedScoreUnits: 0, minimumEvidenceItemCount: 1, maximumEvidencePackBytes: 32_768, maxEvidenceChunksPerSourceItem: 5, allowedTrustTiers: ["OFFICIAL", "PYTHAGORAS_APPROVED", "TEACHER_REVIEWED", "OTHER_APPROVED"], semanticFailureBehavior: "FAIL_RETRIEVAL", rerankerFailureBehavior: "USE_FUSION" };
}

function createRateCard(repository: SQLiteAIRateCardRepository, modelConfigId: string, normalizer: string, priceLines: readonly { component: "STANDARD_INPUT" | "OUTPUT" | "REQUEST"; unit: "PER_MILLION_TOKENS" | "PER_REQUEST"; amountNano: number }[], actor: AdminActor, now: number): void {
  repository.create({ id: uuidv7(), content: { key: `m8b-rate-${uuidv7()}`, displayName: "M8B Rate", modelConfigId, modelConfigRevision: 1, currency: "USD", billingUsageNormalizerKey: normalizer, effectiveFrom: 0, effectiveTo: null, enabled: true, priceLines, timeBands: [] }, actor, now });
}

function publishChange(changes: ReturnType<typeof createChangeManagementService>, owner: AdminActor, resourceType: string, resourceId: string, desired: unknown): void {
  let change = changes.createChangeSet({ title: "M8B Integration Publication", initialItem: { resourceType, resourceId, expectedRevision: 0, operation: "CREATE", desired } }, owner);
  change = changes.submit(change.changeSet.id, change.changeSet.revision, owner);
  change = changes.approve(change.changeSet.id, change.changeSet.revision, owner);
  changes.publish(change.changeSet.id, change.changeSet.revision, owner);
}

function beginTurn(fixture: IntegrationFixture, content = `${QUERY_MARKER} mitochondria`): { conversationId: string; responseId: string } {
  const conversation = fixture.conversations.createConversation(fixture.principal, "biology");
  return beginTurnInConversation(fixture, conversation.id, content);
}

function beginTurnInConversation(fixture: IntegrationFixture, conversationId: string, content: string): { conversationId: string; responseId: string } {
  const turn = fixture.conversations.beginTurn(fixture.principal, { conversationId, idempotencyKey: `m8b-turn-${uuidv7()}`, userContent: content });
  return { conversationId, responseId: turn.response.id };
}

function durableExecutionCounts(fixture: IntegrationFixture): { operations: number; reservations: number; traces: number; usage: number; rateEvents: number } {
  const count = (table: string) => Number((fixture.database.client.prepare(`select count(*) as count from ${table}`).get() as { count: number }).count);
  return { operations: count("ai_cost_operations"), reservations: count("ai_budget_reservations"), traces: count("ai_tutor_response_traces"), usage: count("ai_usage_cost_records"), rateEvents: count("ai_rate_limit_events") };
}

function createDummyAdmission(fixture: IntegrationFixture): { operationId: string; reservationId: string } {
  const operationId = uuidv7();
  const idempotencyKey = `m8b-dummy-${uuidv7()}`;
  fixture.accounting.createOperation({ costCenter: "STUDENT_GENERATION", idempotencyKey, opaquePrincipalRef: fixture.principal.principalRef, subjectKey: "biology", conversationId: null, responseId: null, jobId: null, evalRunId: null, knowledgeRevision: null, status: "OPEN", startedAt: BASE_TIME, completedAt: null }, operationId);
  const base = { principalRef: fixture.principal.principalRef, budgetPolicyId: fixture.studentBudgetPolicyId, budgetPolicyRevision: 1, rateLimitPolicyId: fixture.rateLimitPolicyId, rateLimitPolicyRevision: 1, budgetPeriod: { startAt: 0, endAt: BASE_TIME + 100_000 }, costOperationId: operationId, costEstimate: { currency: "USD", maxCostNano: 1, estimateBasis: "m8b-dummy", modelConfigId: fixture.generationModelId, modelConfigRevision: 1, rateCardId: null, rateCardRevision: null }, idempotencyKey };
  const admission = fixture.admission.admit({ ...base, requestFingerprint: createAIAdmissionRequestFingerprint(base) });
  return { operationId, reservationId: admission.reservation.id };
}

function instrumentSettlement(
  fixture: IntegrationFixture,
  events: string[],
): Pick<AITutorExecutionDependenciesLike, "accounting" | "admission"> {
  const accounting = fixture.accounting;
  const admission = fixture.admission;
  const wrappedAccounting: AITutorExecutionDependenciesLike["accounting"] = {
    getOperation: (id) => accounting.getOperation(id),
    getOperationByResponseId: (responseId) => accounting.getOperationByResponseId(responseId),
    getOperationByIdempotencyKey: (idempotencyKey) => accounting.getOperationByIdempotencyKey(idempotencyKey),
    createOperation: (content, id) => accounting.createOperation(content, id),
    completeOperation: (id, expectedStatus, status, completedAt) => {
      events.push("operation-terminal");
      return accounting.completeOperation(id, expectedStatus, status, completedAt);
    },
    recordAttempt: (observation) => {
      if (observation.capability === "GENERATION") events.push("generation-accounting");
      return accounting.recordAttempt(observation);
    },
  };
  const wrappedAdmission: AITutorExecutionDependenciesLike["admission"] = {
    admit: (plan) => admission.admit(plan),
    getReservation: (reservationId) => admission.getReservation(reservationId),
    getReservationByOperationId: (operationId) => admission.getReservationByOperationId(operationId),
    startExecution: (reservationId, at) => admission.startExecution(reservationId, at),
    releaseBeforeExecution: (reservationId, at, reasonCode) => admission.releaseBeforeExecution(reservationId, at, reasonCode),
    settle: (reservationId, at) => {
      const reservation = admission.getReservation(reservationId);
      assert.ok(reservation);
      const operation = accounting.getOperation(reservation.operationId);
      assert.ok(operation);
      assert.notEqual(operation.status, "OPEN");
      const generationRecords = fixture.database.client.prepare("select id from ai_usage_cost_records where operation_id=? and capability='GENERATION'").all(reservation.operationId) as Array<{ id: string }>;
      assert.equal(generationRecords.length, 1);
      events.push("settle");
      return admission.settle(reservationId, at);
    },
  };
  return { accounting: wrappedAccounting, admission: wrappedAdmission };
}

function afterGenerationAccounting(
  accounting: AITutorExecutionDependenciesLike["accounting"],
  callback: () => void,
): AITutorExecutionDependenciesLike["accounting"] {
  return {
    getOperation: (id) => accounting.getOperation(id),
    getOperationByResponseId: (responseId) => accounting.getOperationByResponseId(responseId),
    getOperationByIdempotencyKey: (idempotencyKey) => accounting.getOperationByIdempotencyKey(idempotencyKey),
    createOperation: (content, id) => accounting.createOperation(content, id),
    completeOperation: (id, expectedStatus, status, completedAt) => accounting.completeOperation(id, expectedStatus, status, completedAt),
    recordAttempt: (observation) => {
      const result = accounting.recordAttempt(observation);
      if (observation.capability === "GENERATION") callback();
      return result;
    },
  };
}

test("M8 final grounded Tutor path composes governed M8A through real M7C and one Generation", async () => {
  const fixture = await createFixture({ withRerank: true });
  try {
    const turn = beginTurn(fixture);
    const requests: AIHybridRetrievalRequest[] = [];
    let preflightPlan: TutorPreflightPlan | null = null;
    let firstQueryState: { operationStatus: string; reservationStatus: string; reservationOperationId: string } | null = null;
    fixture.embedding.onCall = (request) => {
      if (request.inputType !== "QUERY" || firstQueryState) return;
      const operation = fixture.database.client.prepare("select id, status from ai_cost_operations where response_id=?").get(turn.responseId) as { id: string; status: string };
      const reservation = fixture.database.client.prepare("select operation_id, status from ai_budget_reservations where operation_id=?").get(operation.id) as { operation_id: string; status: string };
      firstQueryState = { operationStatus: operation.status, reservationStatus: reservation.status, reservationOperationId: reservation.operation_id };
    };
    const result = await fixture.execution({ onPreflight: (plan) => { preflightPlan = plan; }, onRequest: (request) => requests.push(request) }).execute({ principal: fixture.principal, responseId: turn.responseId, tutorConfigId: fixture.tutorConfigs.getByKey(fixture.tutorConfigs.list()[0]!.key)!.id });
    assert.equal(result.status, "COMPLETED");
    const queryState = firstQueryState as { operationStatus: string; reservationStatus: string; reservationOperationId: string } | null;
    assert.ok(queryState);
    assert.equal(queryState.operationStatus, "OPEN");
    assert.equal(queryState.reservationStatus, "EXECUTING");
    assert.equal(queryState.reservationOperationId, result.costOperationId);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.requestId, turn.responseId);
    assert.equal(requests[0]!.subjectKey, "biology");
    assert.equal(requests[0]!.query, `${QUERY_MARKER} mitochondria`);
    const pinnedPreflight = preflightPlan!;
    assert.ok(pinnedPreflight);
    assert.equal(requests[0]!.retrievalConfigId, pinnedPreflight.retrievalConfigId);
    assert.equal(requests[0]!.retrievalConfigRevision, pinnedPreflight.retrievalConfigRevision);
    const usage = fixture.database.client.prepare("select capability, normalized_input_tokens, normalized_output_tokens from ai_usage_cost_records where operation_id=? order by capability").all(result.costOperationId) as Array<{ capability: string; normalized_input_tokens: number | null; normalized_output_tokens: number | null }>;
    assert.deepEqual(usage.map((row) => row.capability), ["EMBEDDING", "GENERATION", "RERANK"]);
    assert.equal(usage.filter((row) => row.capability === "EMBEDDING").length, 1);
    assert.equal(usage.filter((row) => row.capability === "RERANK").length, 1);
    assert.equal(usage.filter((row) => row.capability === "GENERATION").length, 1);
    assert.equal(fixture.embedding.calls, 2);
    assert.equal(fixture.reranker.calls, 1);
    assert.equal(fixture.generation.calls, 1);
    const generationRequest = fixture.generation.requests[0]!;
    assert.equal(generationRequest.messages.at(-1)?.content, `${QUERY_MARKER} mitochondria`);
    const evidenceMessage = generationRequest.messages.find((message) => message.content.includes("PYTHAGORAS RETRIEVED EVIDENCE DATA"));
    assert.ok(evidenceMessage);
    assert.equal(evidenceMessage.content.includes(EVIDENCE_MARKER), true);
    assert.equal(evidenceMessage.content.includes("originMetadata"), false);
    assert.equal(evidenceMessage.content.includes("rightsStatus"), false);
    const trace = fixture.traces.getByResponse(turn.responseId)!;
    assert.equal(trace.status, "COMPLETED");
    const projectionRefs = fixture.traces.listProjectionRefs(trace.id).map((ref) => [ref.projectionKind, ref.projectionRevisionId]);
    assert.deepEqual(projectionRefs, [["M7A", fixture.m7aRevisionId], ["M7B", fixture.m7bRevisionId]]);
    assert.equal(fixture.traces.listEvidenceRefs(trace.id).length, 1);
    const metadata = JSON.stringify({ operation: fixture.database.client.prepare("select * from ai_cost_operations where id=?").get(result.costOperationId), usage, reservation: fixture.database.client.prepare("select * from ai_budget_reservations where id=?").get(result.budgetReservationId), events: fixture.database.client.prepare("select * from ai_rate_limit_events where operation_id=?").all(result.costOperationId), trace, projectionRefs, evidence: fixture.traces.listEvidenceRefs(trace.id) });
    assert.equal(metadata.includes(QUERY_MARKER), false);
    assert.equal(metadata.includes(EVIDENCE_MARKER), false);
    const telemetryTypes = (fixture.database.client.prepare("select event_type from ai_telemetry_events where response_id=?").all(turn.responseId) as Array<{ event_type: string }>).map((row) => row.event_type);
    assert.deepEqual([...new Set(telemetryTypes)].sort(), ["GROUNDING_VALIDATION_PASSED", "RETRIEVAL_COMPLETED", "RETRIEVAL_STARTED", "TUTOR_REQUEST_COMPLETED", "TUTOR_REQUEST_STARTED"]);
    assert.equal((fixture.database.client.prepare("select response_id,subject_key,overall_latency_ms from ai_tutor_response_diagnostics where response_id=?").get(turn.responseId) as { response_id: string; subject_key: string; overall_latency_ms: number }).response_id, turn.responseId);
    assert.equal((fixture.database.client.prepare("select response_id,subject_key,evidence_item_count from ai_retrieval_traces where response_id=?").get(turn.responseId) as { response_id: string; subject_key: string; evidence_item_count: number }).evidence_item_count, 1);
    const retrievalDetails = new AIIntelligenceTelemetryService(fixture.database).getRetrievalTraceDetailsByRequestId(turn.responseId);
    assert.ok(retrievalDetails);
    assert.equal(retrievalDetails.items.length, 1);
    assert.deepEqual(retrievalDetails.projections.map((projection) => projection.projectionKind).sort(), ["M7A", "M7B"]);
    assert.equal(JSON.stringify(retrievalDetails).includes(EVIDENCE_MARKER), false);
  } finally { fixture.close(); }
});

test("M10B2 applies one Agent-1 Memory command from the same Tutor Generation", async () => {
  const fixture = await createFixture();
  try {
    const changes = createChangeManagementService(fixture.database);
    const memoryPolicyId = uuidv7();
    publishChange(changes, fixture.owner, AI_MEMORY_POLICY_RESOURCE_TYPE, memoryPolicyId, {
      key: `m10b2-memory-${uuidv7()}`,
      scope: "SUBJECT",
      subjectKey: "biology",
      displayName: "M10B2 Biology Memory",
      enabled: true,
      allowedKinds: ["LEARNING_DIFFICULTY"],
      targetActiveCount: 10,
      hardActiveMaximum: 10,
      maxSelectedPerRequest: 10,
      proposedHardMaximum: 10,
      perMemoryMaxBytes: 4096,
      retentionDays: 365,
      mutationEnabled: true,
      explicitMinConfidenceUnits: 0,
      inferredMinConfidenceUnits: 900_000,
      inferredMinDistinctEvidenceTurns: 1,
      candidateReviewRequired: false,
      maxSelectedMemories: 10,
    });
    const memoryText = "The Student repeatedly confuses metaphase and anaphase.";
    fixture.generation.behavior = {
      finishReason: "STOP",
      deltas: ["Grounded answer [E1]"],
      usageEvents: [],
      finalUsage: knownUsage(20, 3),
      memoryCommand: {
        protocolKey: "memory-command-v1",
        protocolRevision: 1,
        action: "CREATE",
        scope: "SUBJECT",
        subjectKey: "biology",
        memoryId: null,
        expectedRevision: null,
        kind: "LEARNING_DIFFICULTY",
        origin: "INFERRED",
        confidenceUnits: 950_000,
        memoryText,
      },
    };
    const turn = beginTurn(fixture);
    const result = await fixture.execution().execute({ principal: fixture.principal, responseId: turn.responseId, tutorConfigId: fixture.tutorConfigs.list()[0]!.id });
    assert.equal(result.status, "COMPLETED");
    assert.equal(fixture.generation.calls, 1);
    const memory = fixture.database.client.prepare("select status, creation_origin, safe_review_code, memory_text from ai_memories where principal_ref=?").get(fixture.principal.principalRef) as { status: string; creation_origin: string; safe_review_code: string; memory_text: string };
    assert.deepEqual(memory, { status: "ACTIVE", creation_origin: "INFERRED", safe_review_code: "INFERRED_ACTIVATED", memory_text: memoryText });
    const mutation = fixture.database.client.prepare("select status, memory_text from ai_memory_mutation_intents where response_id=?").get(turn.responseId) as { status: string; memory_text: string | null };
    assert.deepEqual(mutation, { status: "APPLIED", memory_text: null });
    assert.deepEqual(fixture.database.client.prepare("select event_type,memory_action,memory_scope,memory_origin from ai_telemetry_events where response_id=? and event_type='MEMORY_MUTATION_APPLIED'").get(turn.responseId), { event_type: "MEMORY_MUTATION_APPLIED", memory_action: "CREATE", memory_scope: "SUBJECT", memory_origin: "INFERRED" });
    assert.equal(Number((fixture.database.client.prepare("select count(*) as count from ai_memory_executions where execution_kind='EXTRACTION'").get() as { count: number }).count), 0);
    const operationalMetadata = ["ai_memory_mutation_intents", "ai_memory_mutation_records", "ai_memory_executions", "ai_jobs", "ai_outbox_events", "ai_cost_operations", "ai_usage_cost_records"].map((table) => JSON.stringify(fixture.database.client.prepare(`select * from ${table}`).all())).join("\n");
    assert.equal(operationalMetadata.includes(memoryText), false);
    const assistant = fixture.conversations.listMessages(fixture.principal, turn.conversationId).find((message) => message.role === "ASSISTANT");
    assert.ok(assistant);
    assert.equal(assistant.content.includes(memoryText), false);
  } finally { fixture.close(); }
});

test("M10B2 applies an explicit Agent-1 Memory command without a second Generation", async () => {
  const fixture = await createFixture();
  try {
    const changes = createChangeManagementService(fixture.database);
    const memoryPolicyId = uuidv7();
    publishChange(changes, fixture.owner, AI_MEMORY_POLICY_RESOURCE_TYPE, memoryPolicyId, {
      key: `m10b2-explicit-memory-${uuidv7()}`,
      scope: "SUBJECT",
      subjectKey: "biology",
      displayName: "M10B2 Explicit Memory",
      enabled: true,
      allowedKinds: ["EXPLANATION_PREFERENCE"],
      targetActiveCount: 10,
      hardActiveMaximum: 10,
      maxSelectedPerRequest: 10,
      proposedHardMaximum: 10,
      perMemoryMaxBytes: 4096,
      retentionDays: 365,
      mutationEnabled: true,
      explicitMinConfidenceUnits: 800_000,
      inferredMinConfidenceUnits: 900_000,
      inferredMinDistinctEvidenceTurns: 2,
      candidateReviewRequired: true,
      maxSelectedMemories: 10,
    });
    const memoryText = "Always show a worked example before the biology rule.";
    fixture.generation.behavior = {
      finishReason: "STOP",
      deltas: ["Grounded answer [E1]"],
      usageEvents: [],
      finalUsage: knownUsage(20, 3),
      memoryCommand: {
        protocolKey: "memory-command-v1",
        protocolRevision: 1,
        action: "CREATE",
        scope: "SUBJECT",
        subjectKey: "biology",
        memoryId: null,
        expectedRevision: null,
        kind: "EXPLANATION_PREFERENCE",
        origin: "EXPLICIT",
        confidenceUnits: 900_000,
        memoryText,
      },
    };
    const turn = beginTurn(fixture);
    const result = await fixture.execution().execute({ principal: fixture.principal, responseId: turn.responseId, tutorConfigId: fixture.tutorConfigs.list()[0]!.id });
    assert.equal(result.status, "COMPLETED");
    assert.equal(fixture.generation.calls, 1);
    assert.deepEqual(fixture.database.client.prepare("select status, creation_origin, safe_review_code, memory_text from ai_memories where principal_ref=?").get(fixture.principal.principalRef), { status: "ACTIVE", creation_origin: "EXPLICIT", safe_review_code: "EXPLICIT_CREATED", memory_text: memoryText });
    assert.equal(Number((fixture.database.client.prepare("select count(*) as count from ai_memory_executions where execution_kind='EXTRACTION'").get() as { count: number }).count), 0);
  } finally { fixture.close(); }
});

test("M8B real integration re-fences a source change after M7C without Generation", async () => {
  const fixture = await createFixture();
  try {
    const turn = beginTurn(fixture);
    const source = fixture.sources.getById(fixture.sourceId)!;
    const result = await fixture.execution({ afterRetrieve: () => { fixture.sources.appendRevision({ id: fixture.sourceId, expectedRevision: source.currentRevision, content: sourceRevisionContent(source, { rightsStatus: "RESTRICTED", rightsBasis: null }), actor: fixture.owner, now: BASE_TIME + 1 }); } }).execute({ principal: fixture.principal, responseId: turn.responseId, tutorConfigId: fixture.tutorConfigs.list()[0]!.id });
    assert.equal(result.status, "BLOCKED");
    assert.equal(fixture.generation.calls, 0);
    assert.equal(fixture.embedding.calls, 2);
    assert.equal(Number((fixture.database.client.prepare("select count(*) as count from ai_usage_cost_records where operation_id=?").get(result.costOperationId) as { count: number }).count), 1);
    assert.equal((fixture.database.client.prepare("select status from ai_cost_operations where id=?").get(result.costOperationId) as { status: string }).status, "COMPLETED");
    assert.equal(fixture.traces.getByResponse(turn.responseId)?.status, "BLOCKED");
  } finally { fixture.close(); }
});

test("M8B real integration passes exact pin and allows Secret rotation alone", async () => {
  const stale = await createFixture();
  try {
    const turn = beginTurn(stale);
    const model = stale.models.getById(stale.generationModelId)!;
    const result = await stale.execution({ beforeGenerate: () => { stale.models.update({ id: model.id, expectedRevision: model.revision, content: { key: model.key, displayName: model.displayName, providerConfigId: model.providerConfigId, providerModelId: "m8b-mutated-model", capability: model.capability, adapterKey: model.adapterKey, enabled: model.enabled, contextWindowTokens: model.contextWindowTokens, maxOutputTokens: model.maxOutputTokens, embeddingDimensions: model.embeddingDimensions, supportsStreaming: model.supportsStreaming, supportsReasoning: model.supportsReasoning, supportsStructuredOutput: model.supportsStructuredOutput }, actor: stale.owner, now: BASE_TIME + 2 }); } }).execute({ principal: stale.principal, responseId: turn.responseId, tutorConfigId: stale.tutorConfigs.list()[0]!.id });
    assert.equal(result.status, "FAILED");
    assert.equal(stale.generation.calls, 0);
  } finally { stale.close(); }
  const rotated = await createFixture();
  try {
    const turn = beginTurn(rotated);
    const rotatedSecret = `m8b-rotated-secret-${uuidv7()}`;
    await rotated.secrets.rotate({ credentialRef: rotated.providers.getById(rotated.providerId)!.credentialRef!, secret: rotatedSecret, actor: { type: "ADMIN", actorUserId: rotated.owner.actorUserId } });
    const result = await rotated.execution().execute({ principal: rotated.principal, responseId: turn.responseId, tutorConfigId: rotated.tutorConfigs.list()[0]!.id });
    assert.equal(result.status, "COMPLETED");
    assert.equal(rotated.generation.calls, 1);
    assert.equal(rotated.generation.credentials[0], rotatedSecret);
  } finally { rotated.close(); }
});

test("M8B real integration preserves Provider finish reasons", async () => {
  for (const finishReason of ["STOP", "LENGTH", "CONTENT_FILTER", "OTHER"] as const) {
    const fixture = await createFixture();
    try {
      fixture.generation.behavior = { finishReason, deltas: finishReason === "CONTENT_FILTER" ? [] : ["answer [E1]"], usageEvents: [], finalUsage: knownUsage(10, 2) };
      const turn = beginTurn(fixture, "finish reason");
      const result = await fixture.execution().execute({ principal: fixture.principal, responseId: turn.responseId, tutorConfigId: fixture.tutorConfigs.list()[0]!.id });
      assert.equal(result.status, "COMPLETED");
      assert.equal(result.finishReason, finishReason);
      assert.equal(fixture.conversations.getResponse(fixture.principal, turn.responseId).finishReason, finishReason);
    } finally { fixture.close(); }
  }
});

test("M8B real integration accounts partial failure, cancellation, overflow, unknown usage, and cumulative usage", async () => {
  const partial = await createFixture();
  try {
    partial.generation.behavior = { finishReason: "STOP", deltas: ["partial answer"], usageEvents: [knownUsage(10, 2)], finalUsage: knownUsage(10, 2), failure: { code: "UNAVAILABLE", afterUsage: true } };
    const turn = beginTurn(partial);
    const result = await partial.execution().execute({ principal: partial.principal, responseId: turn.responseId, tutorConfigId: partial.tutorConfigs.list()[0]!.id });
    assert.equal(result.status, "FAILED");
    assert.equal(partial.conversations.listMessages(partial.principal, turn.conversationId).at(-1)?.isPartial, true);
    assert.equal(Number((partial.database.client.prepare("select count(*) as count from ai_usage_cost_records where operation_id=? and capability='GENERATION'").get(result.costOperationId) as { count: number }).count), 1);
  } finally { partial.close(); }
  const cancelled = await createFixture();
  try {
    cancelled.generation.behavior = { finishReason: "STOP", deltas: [], usageEvents: [knownUsage(8, 0)], finalUsage: knownUsage(8, 0), waitForAbort: true };
    const turn = beginTurn(cancelled);
    const controller = new AbortController();
    const pending = cancelled.execution().execute({ principal: cancelled.principal, responseId: turn.responseId, tutorConfigId: cancelled.tutorConfigs.list()[0]!.id, signal: controller.signal });
    await cancelled.generation.waiting;
    const abortRequestedAt = performance.now();
    controller.abort();
    await cancelled.generation.abortObserved;
    assert.ok(cancelled.generation.abortObservedAt !== null);
    assert.ok(cancelled.generation.abortObservedAt - abortRequestedAt < 1_000);
    const result = await pending;
    assert.ok(performance.now() - abortRequestedAt < 5_000);
    assert.equal(result.status, "CANCELLED");
    assert.equal(result.finishReason, "CANCELLED");
    assert.equal(cancelled.generation.calls, 1);
    assert.equal(cancelled.conversations.getResponse(cancelled.principal, turn.responseId).status, "CANCELLED");
    assert.equal(cancelled.traces.getByResponse(turn.responseId)?.status, "CANCELLED");
    assert.equal((cancelled.database.client.prepare("select status from ai_cost_operations where id=?").get(result.costOperationId) as { status: string }).status, "CANCELLED");
    const reservation = cancelled.database.client.prepare("select status from ai_budget_reservations where id=?").get(result.budgetReservationId) as { status: string };
    assert.equal(reservation.status, result.settlementStatus);
    assert.ok(result.settlementStatus === "SETTLED" || result.settlementStatus === "RECONCILIATION_REQUIRED");
    const usage = cancelled.database.client.prepare("select normalized_input_tokens, normalized_output_tokens, normalized_reasoning_tokens from ai_usage_cost_records where operation_id=? and capability='GENERATION'").all(result.costOperationId) as Array<{ normalized_input_tokens: number | null; normalized_output_tokens: number | null; normalized_reasoning_tokens: number | null }>;
    assert.deepEqual(usage, [{ normalized_input_tokens: 8, normalized_output_tokens: 0, normalized_reasoning_tokens: 0 }]);
  } finally { cancelled.close(); }
  const overflow = await createFixture();
  try {
    overflow.generation.behavior = { finishReason: "STOP", deltas: ["x".repeat(250_000), "y".repeat(250_000), "z".repeat(30_000)], usageEvents: [knownUsage(8, 1)], finalUsage: knownUsage(8, 1) };
    const turn = beginTurn(overflow);
    const result = await overflow.execution().execute({ principal: overflow.principal, responseId: turn.responseId, tutorConfigId: overflow.tutorConfigs.list()[0]!.id });
    assert.equal(result.status, "FAILED");
    const assistant = overflow.conversations.listMessages(overflow.principal, turn.conversationId).at(-1)!;
    assert.equal(assistant.isPartial, true);
    assert.ok(Buffer.byteLength(assistant.content, "utf8") <= 512 * 1_024);
    assert.equal(overflow.generation.calls, 1);
  } finally { overflow.close(); }
  const unknown = await createFixture();
  try {
    unknown.generation.behavior = { finishReason: "STOP", deltas: [], usageEvents: [], finalUsage: unknownUsage(), failure: { code: "UNAVAILABLE" } };
    const turn = beginTurn(unknown);
    const result = await unknown.execution().execute({ principal: unknown.principal, responseId: turn.responseId, tutorConfigId: unknown.tutorConfigs.list()[0]!.id });
    assert.equal(result.status, "FAILED");
    assert.equal(result.settlementStatus, "RECONCILIATION_REQUIRED");
    const row = unknown.database.client.prepare("select normalized_input_tokens, normalized_output_tokens, normalized_reasoning_tokens from ai_usage_cost_records where operation_id=? and capability='GENERATION'").get(result.costOperationId) as { normalized_input_tokens: number | null; normalized_output_tokens: number | null; normalized_reasoning_tokens: number | null };
    assert.deepEqual(row, { normalized_input_tokens: null, normalized_output_tokens: null, normalized_reasoning_tokens: null });
  } finally { unknown.close(); }
  const cumulative = await createFixture();
  try {
    cumulative.generation.behavior = { finishReason: "STOP", deltas: ["answer [E1]"], usageEvents: [knownUsage(10, 2), knownUsage(20, 5)], finalUsage: knownUsage(20, 5) };
    const turn = beginTurn(cumulative);
    const result = await cumulative.execution().execute({ principal: cumulative.principal, responseId: turn.responseId, tutorConfigId: cumulative.tutorConfigs.list()[0]!.id });
    const row = cumulative.database.client.prepare("select normalized_input_tokens, normalized_output_tokens from ai_usage_cost_records where operation_id=? and capability='GENERATION'").get(result.costOperationId) as { normalized_input_tokens: number; normalized_output_tokens: number };
    assert.deepEqual(row, { normalized_input_tokens: 20, normalized_output_tokens: 5 });
    assert.equal(Number((cumulative.database.client.prepare("select count(*) as count from ai_usage_cost_records where operation_id=? and capability='GENERATION'").get(result.costOperationId) as { count: number }).count), 1);
  } finally { cumulative.close(); }
});

test("M8B real integration rejects rate-limit and concurrency admission before M7C", async () => {
  const rate = await createFixture({ rateLimit: { maxRequests: 1, maxConcurrentRequests: 100 } });
  try {
    createDummyAdmission(rate);
    const turn = beginTurn(rate);
    await assert.rejects(() => rate.execution().execute({ principal: rate.principal, responseId: turn.responseId, tutorConfigId: rate.tutorConfigs.list()[0]!.id }), (error) => error instanceof AITutorExecutionError && error.code === "AI_TUTOR_EXECUTION_ADMISSION_DENIED");
    assert.equal(rate.embedding.calls, 1);
    assert.equal(rate.generation.calls, 0);
  } finally { rate.close(); }
  const concurrency = await createFixture({ rateLimit: { maxRequests: 100, maxConcurrentRequests: 1 } });
  try {
    const dummy = createDummyAdmission(concurrency);
    concurrency.admission.startExecution(dummy.reservationId, BASE_TIME);
    const turn = beginTurn(concurrency);
    await assert.rejects(() => concurrency.execution().execute({ principal: concurrency.principal, responseId: turn.responseId, tutorConfigId: concurrency.tutorConfigs.list()[0]!.id }), (error) => error instanceof AITutorExecutionError && error.code === "AI_TUTOR_EXECUTION_ADMISSION_DENIED");
    assert.equal(concurrency.embedding.calls, 1);
    assert.equal(concurrency.generation.calls, 0);
  } finally { concurrency.close(); }
});

test("M8B real integration settles only after Generation accounting and operation terminalization", async () => {
  const fixture = await createFixture();
  const events: string[] = [];
  try {
    fixture.generation.onProviderFinished = () => events.push("generation-provider");
    const turn = beginTurn(fixture);
    const result = await fixture.execution(instrumentSettlement(fixture, events)).execute({ principal: fixture.principal, responseId: turn.responseId, tutorConfigId: fixture.tutorConfigs.list()[0]!.id });
    assert.equal(result.status, "COMPLETED");
    assert.deepEqual(events, ["generation-provider", "generation-accounting", "operation-terminal", "settle"]);
  } finally { fixture.close(); }
});

test("M8B real integration removes the caller cancellation bridge after execution settles", async () => {
  const fixture = await createFixture();
  try {
    const controller = new AbortController();
    const turn = beginTurn(fixture);
    const result = await fixture.execution().execute({ principal: fixture.principal, responseId: turn.responseId, tutorConfigId: fixture.tutorConfigs.list()[0]!.id, signal: controller.signal });
    assert.equal(result.status, "COMPLETED");
    const before = {
      calls: fixture.generation.calls,
      response: fixture.conversations.getResponse(fixture.principal, turn.responseId),
      trace: fixture.traces.getByResponse(turn.responseId),
      operation: fixture.database.client.prepare("select * from ai_cost_operations where id=?").get(result.costOperationId),
      reservation: fixture.database.client.prepare("select * from ai_budget_reservations where id=?").get(result.budgetReservationId),
    };
    controller.abort();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const after = {
      calls: fixture.generation.calls,
      response: fixture.conversations.getResponse(fixture.principal, turn.responseId),
      trace: fixture.traces.getByResponse(turn.responseId),
      operation: fixture.database.client.prepare("select * from ai_cost_operations where id=?").get(result.costOperationId),
      reservation: fixture.database.client.prepare("select * from ai_budget_reservations where id=?").get(result.budgetReservationId),
    };
    assert.deepEqual(after, before);
  } finally { fixture.close(); }
});

test("M8C rejects fabricated citations after accounting the successful Provider attempt", async () => {
  const fixture = await createFixture();
  try {
    fixture.generation.behavior = { finishReason: "STOP", deltas: ["جواب غير موثق [E99]"], usageEvents: [], finalUsage: knownUsage(12, 4) };
    const turn = beginTurn(fixture);
    const result = await fixture.execution().execute({ principal: fixture.principal, responseId: turn.responseId, tutorConfigId: fixture.tutorConfigs.list()[0]!.id });
    assert.equal(result.status, "FAILED");
    assert.equal(fixture.generation.calls, 1);
    const messages = fixture.conversations.listMessages(fixture.principal, turn.conversationId);
    assert.equal(messages.at(-1)?.content, "جواب غير موثق [E99]");
    assert.equal(messages.at(-1)?.isPartial, true);
    assert.equal(fixture.traces.getByResponse(turn.responseId)?.status, "FAILED");
    assert.equal((fixture.database.client.prepare("select status from ai_cost_operations where id=?").get(result.costOperationId) as { status: string }).status, "FAILED");
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_usage_cost_records where operation_id=? and capability='GENERATION'").get(result.costOperationId) as { count: number }).count, 1);
    const reservation = fixture.database.client.prepare("select status from ai_budget_reservations where id=?").get(result.budgetReservationId) as { status: string };
    assert.equal(reservation.status, result.settlementStatus);
    assert.ok(result.settlementStatus === "SETTLED" || result.settlementStatus === "RECONCILIATION_REQUIRED");
  } finally { fixture.close(); }
});

test("M8C rejects ordinary successful output without a citation", async () => {
  const fixture = await createFixture();
  try {
    fixture.generation.behavior = { finishReason: "STOP", deltas: ["جواب بلا مرجع"], usageEvents: [], finalUsage: knownUsage(12, 3) };
    const turn = beginTurn(fixture);
    const result = await fixture.execution().execute({ principal: fixture.principal, responseId: turn.responseId, tutorConfigId: fixture.tutorConfigs.list()[0]!.id });
    assert.equal(result.status, "FAILED");
    assert.equal(fixture.generation.calls, 1);
    assert.equal(fixture.conversations.listMessages(fixture.principal, turn.conversationId).at(-1)?.isPartial, true);
    assert.equal(fixture.traces.getByResponse(turn.responseId)?.status, "FAILED");
    assert.equal(Number((fixture.database.client.prepare("select count(*) as count from ai_usage_cost_records where operation_id=? and capability='GENERATION'").get(result.costOperationId) as { count: number }).count), 1);
  } finally { fixture.close(); }
});

test("M8C rejects a Source rights change after Provider usage before completion", async () => {
  const fixture = await createFixture();
  try {
    const source = fixture.sources.getById(fixture.sourceId)!;
    const turn = beginTurn(fixture);
    const result = await fixture.execution({ afterGenerationAccounting: () => {
      fixture.sources.appendRevision({ id: fixture.sourceId, expectedRevision: source.currentRevision, content: sourceRevisionContent(source, { rightsStatus: "RESTRICTED", rightsBasis: null }), actor: fixture.owner, now: BASE_TIME + 1 });
    } }).execute({ principal: fixture.principal, responseId: turn.responseId, tutorConfigId: fixture.tutorConfigs.list()[0]!.id });
    assert.equal(result.status, "FAILED");
    assert.equal(fixture.generation.calls, 1);
    assert.equal(fixture.traces.getByResponse(turn.responseId)?.status, "FAILED");
    assert.equal((fixture.database.client.prepare("select status from ai_cost_operations where id=?").get(result.costOperationId) as { status: string }).status, "FAILED");
    assert.equal(Number((fixture.database.client.prepare("select count(*) as count from ai_usage_cost_records where operation_id=?").get(result.costOperationId) as { count: number }).count), 2);
    assert.equal((fixture.conversations.getResponse(fixture.principal, turn.responseId)).status, "FAILED");
  } finally { fixture.close(); }
});

test("M8C rejects a governed Subject Policy change after Provider usage before completion", async () => {
  const fixture = await createFixture();
  try {
    const subject = fixture.instructions.list().find((policy) => policy.scope === "SUBJECT")!;
    const turn = beginTurn(fixture);
    const result = await fixture.execution({ afterGenerationAccounting: () => {
      fixture.instructions.appendRevision({ id: subject.id, expectedRevision: subject.currentRevision, content: { key: subject.key, scope: "SUBJECT", subjectKey: subject.subjectKey, displayName: subject.displayName, instructions: "Changed after Provider execution.", enabled: subject.enabled }, actor: fixture.owner, now: BASE_TIME + 1 });
    } }).execute({ principal: fixture.principal, responseId: turn.responseId, tutorConfigId: fixture.tutorConfigs.list()[0]!.id });
    assert.equal(result.status, "FAILED");
    assert.equal(fixture.generation.calls, 1);
    assert.equal(fixture.traces.getByResponse(turn.responseId)?.status, "FAILED");
    assert.equal((fixture.database.client.prepare("select status from ai_cost_operations where id=?").get(result.costOperationId) as { status: string }).status, "FAILED");
  } finally { fixture.close(); }
});

test("M8C excludes failed partial Assistant output from the next Context and Generation request", async () => {
  const fixture = await createFixture();
  try {
    const conversation = fixture.conversations.createConversation(fixture.principal, "biology");
    const completedTurn = beginTurnInConversation(fixture, conversation.id, "completed question");
    fixture.generation.behavior = { finishReason: "STOP", deltas: ["SAFE_COMPLETED_CONTEXT_M8C_55 [E1]"], usageEvents: [], finalUsage: knownUsage(9, 3) };
    const completed = await fixture.execution().execute({ principal: fixture.principal, responseId: completedTurn.responseId, tutorConfigId: fixture.tutorConfigs.list()[0]!.id });
    assert.equal(completed.status, "COMPLETED");

    const failedTurn = beginTurnInConversation(fixture, conversation.id, "first question");
    fixture.generation.behavior = { finishReason: "STOP", deltas: ["POISONED_PARTIAL_ASSISTANT_M8C_44 [E99]"], usageEvents: [], finalUsage: knownUsage(10, 3) };
    const failed = await fixture.execution().execute({ principal: fixture.principal, responseId: failedTurn.responseId, tutorConfigId: fixture.tutorConfigs.list()[0]!.id });
    assert.equal(failed.status, "FAILED");
    const history = fixture.conversations.listMessages(fixture.principal, conversation.id);
    assert.equal(history.some((message) => message.isPartial && message.content.includes("POISONED_PARTIAL_ASSISTANT_M8C_44")), true);

    const nextTurn = beginTurnInConversation(fixture, conversation.id, "second question");
    fixture.generation.behavior = { finishReason: "STOP", deltas: ["clean answer [E1]"], usageEvents: [], finalUsage: knownUsage(11, 3) };
    const next = await fixture.execution().execute({ principal: fixture.principal, responseId: nextTurn.responseId, tutorConfigId: fixture.tutorConfigs.list()[0]!.id });
    assert.equal(next.status, "COMPLETED");
    assert.equal(fixture.generation.calls, 3);
    const secondRequest = fixture.generation.requests[2]!;
    assert.equal(secondRequest.messages.some((message) => message.content.includes("SAFE_COMPLETED_CONTEXT_M8C_55")), true);
    assert.equal(secondRequest.messages.some((message) => message.content.includes("POISONED_PARTIAL_ASSISTANT_M8C_44")), false);
    const snapshot = fixture.context.getSnapshot(fixture.principal, nextTurn.responseId);
    assert.equal(JSON.stringify(snapshot).includes("POISONED_PARTIAL_ASSISTANT_M8C_44"), false);
  } finally { fixture.close(); }
});

test("M8C terminal replay returns the same COMPLETED result without new work", async () => {
  const fixture = await createFixture();
  try {
    const turn = beginTurn(fixture);
    const tutorConfigId = fixture.tutorConfigs.list()[0]!.id;
    const first = await fixture.execution().execute({ principal: fixture.principal, responseId: turn.responseId, tutorConfigId });
    assert.equal(first.status, "COMPLETED");
    const countsBefore = durableExecutionCounts(fixture);
    const callsBefore = { generation: fixture.generation.calls, embedding: fixture.embedding.calls, reranker: fixture.reranker.calls };
    const replay = await fixture.execution().execute({ principal: fixture.principal, responseId: turn.responseId, tutorConfigId });
    assert.deepEqual(replay, first);
    assert.deepEqual(durableExecutionCounts(fixture), countsBefore);
    assert.deepEqual({ generation: fixture.generation.calls, embedding: fixture.embedding.calls, reranker: fixture.reranker.calls }, callsBefore);
  } finally { fixture.close(); }
});

test("M8C terminal replay returns the same BLOCKED result without new work", async () => {
  const fixture = await createFixture();
  try {
    const source = fixture.sources.getById(fixture.sourceId)!;
    fixture.sources.appendRevision({ id: fixture.sourceId, expectedRevision: source.currentRevision, content: sourceRevisionContent(source, { rightsStatus: "RESTRICTED", rightsBasis: null }), actor: fixture.owner, now: BASE_TIME + 1 });
    const turn = beginTurn(fixture);
    const tutorConfigId = fixture.tutorConfigs.list()[0]!.id;
    const first = await fixture.execution().execute({ principal: fixture.principal, responseId: turn.responseId, tutorConfigId });
    assert.equal(first.status, "BLOCKED");
    const countsBefore = durableExecutionCounts(fixture);
    const callsBefore = { generation: fixture.generation.calls, embedding: fixture.embedding.calls, reranker: fixture.reranker.calls };
    const replay = await fixture.execution().execute({ principal: fixture.principal, responseId: turn.responseId, tutorConfigId });
    assert.deepEqual(replay, first);
    assert.deepEqual(durableExecutionCounts(fixture), countsBefore);
    assert.deepEqual({ generation: fixture.generation.calls, embedding: fixture.embedding.calls, reranker: fixture.reranker.calls }, callsBefore);
  } finally { fixture.close(); }
});

test("M8C rejects concurrent duplicate execution while the first Provider stream is active", async () => {
  const fixture = await createFixture();
  try {
    fixture.generation.behavior = { finishReason: "STOP", deltas: ["in flight [E1]"], usageEvents: [knownUsage(8, 1)], finalUsage: knownUsage(8, 1), waitForAbort: true };
    const turn = beginTurn(fixture);
    const tutorConfigId = fixture.tutorConfigs.list()[0]!.id;
    const controller = new AbortController();
    const firstPending = fixture.execution().execute({ principal: fixture.principal, responseId: turn.responseId, tutorConfigId, signal: controller.signal });
    await fixture.generation.waiting;
    const countsBefore = durableExecutionCounts(fixture);
    await assert.rejects(() => fixture.execution().execute({ principal: fixture.principal, responseId: turn.responseId, tutorConfigId }), (error) => error instanceof AITutorExecutionError && error.code === "AI_TUTOR_EXECUTION_OPERATION_CONFLICT");
    assert.deepEqual(durableExecutionCounts(fixture), countsBefore);
    assert.equal(fixture.generation.calls, 1);
    controller.abort();
    const first = await firstPending;
    assert.equal(first.status, "CANCELLED");
  } finally { fixture.close(); }
});

test("M8C classifies an externally cancelled Conversation as CANCELLED after Provider execution", async () => {
  const fixture = await createFixture();
  try {
    const turn = beginTurn(fixture);
    const result = await fixture.execution({ afterGenerationAccounting: () => { fixture.conversations.cancelResponse(fixture.principal, turn.responseId); } }).execute({ principal: fixture.principal, responseId: turn.responseId, tutorConfigId: fixture.tutorConfigs.list()[0]!.id });
    assert.equal(result.status, "CANCELLED");
    assert.equal(fixture.generation.calls, 1);
    assert.equal(fixture.conversations.getResponse(fixture.principal, turn.responseId).status, "CANCELLED");
    assert.equal(fixture.traces.getByResponse(turn.responseId)?.status, "CANCELLED");
    assert.equal((fixture.database.client.prepare("select status from ai_cost_operations where id=?").get(result.costOperationId) as { status: string }).status, "CANCELLED");
    assert.equal(Number((fixture.database.client.prepare("select count(*) as count from ai_usage_cost_records where operation_id=?").get(result.costOperationId) as { count: number }).count), 2);
  } finally { fixture.close(); }
});

test("M8C classifies an externally deleted Conversation as CANCELLED without replaying Generation", async () => {
  const fixture = await createFixture();
  try {
    const turn = beginTurn(fixture);
    const result = await fixture.execution({ afterGenerationAccounting: () => { fixture.conversations.deleteConversation(fixture.principal, turn.conversationId); } }).execute({ principal: fixture.principal, responseId: turn.responseId, tutorConfigId: fixture.tutorConfigs.list()[0]!.id });
    assert.equal(result.status, "CANCELLED");
    assert.equal(result.conversationStatus, "DELETED");
    assert.equal(fixture.generation.calls, 1);
    assert.equal(fixture.traces.getByResponse(turn.responseId)?.status, "CANCELLED");
    assert.equal((fixture.database.client.prepare("select status from ai_cost_operations where id=?").get(result.costOperationId) as { status: string }).status, "CANCELLED");
    assert.equal(Number((fixture.database.client.prepare("select count(*) as count from ai_usage_cost_records where operation_id=?").get(result.costOperationId) as { count: number }).count), 2);
  } finally { fixture.close(); }
});
