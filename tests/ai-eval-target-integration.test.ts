import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../src/server/admin-auth";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import { AIBudgetAdmissionService, AI_EVALS_ADMISSION_PRINCIPAL_REF, createAIAdmissionRequestFingerprint } from "../src/server/ai/admission";
import { SQLiteAIBudgetPolicyRepository } from "../src/server/ai/budget";
import { AIContextService, type AIContextTokenEstimator } from "../src/server/ai/context";
import {
  AIBillingUsageNormalizerRegistry,
  AICostAccountingService,
  AICostCalculator,
  AIRateCardResolver,
  SQLiteAIAccountingRepository,
  SQLiteAIRateCardModelRevisionRepository,
  SQLiteAIRateCardRepository,
} from "../src/server/ai/economics";
import type { EmbeddingProviderAdapter, EmbeddingProviderRequest, EmbeddingProviderResult, GenerationProviderAdapter, GenerationProviderRequest, NormalizedProviderUsage, ProviderAdapterExecutionContext, ProviderGenerationStreamEvent, RerankerProviderAdapter, RerankProviderRequest, RerankProviderResult } from "../src/server/ai/gateway";
import { AIProviderAdapterError, AIProviderGateway, ProviderAdapterRegistry } from "../src/server/ai/gateway";
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
  AIEvalRunService,
  AIEvalTargetExecutionService,
  AIEvalTargetCleanupService,
  SQLiteAIEvalTargetCleanupRepository,
  syntheticPrincipal,
  AIEvalTargetOrchestrator,
  createAIEvalTargetExecutionJobHandler,
  AI_EVAL_GRADER_KEYS,
  AI_EVAL_EXECUTION_CONFIG_RESOURCE_TYPE,
  AI_EVAL_CASE_RESOURCE_TYPE,
  AI_EVAL_SUITE_RESOURCE_TYPE,
  normalizeAIEvalCandidateSnapshot,
  SQLiteAIEvalExecutionConfigRepository,
  SQLiteAIEvalCaseExecutionRepository,
  SQLiteAIEvalRunRepository,
} from "../src/server/ai/evals";
import { SQLiteAIKnowledgePackageRepository, SQLiteAIKnowledgeSourceRepository, type AIKnowledgeSourceContent } from "../src/server/ai/knowledge";
import { SQLiteAIModelConfigRepository } from "../src/server/ai/model-registry";
import { SQLiteAIProviderConfigRepository } from "../src/server/ai/configuration";
import { SQLiteAIInstructionPolicyRepository, SQLiteAIContextPolicyRepository } from "../src/server/ai/policy";
import { SQLiteAIRateLimitPolicyRepository } from "../src/server/ai/rate-limits";
import { AIChunkProjectionBuilder, AIRetrievalProjectionHealthService, HybridRetrievalService, SQLiteAILexicalRetrievalAdapter, SQLiteAIRetrievalProjectionRepository, type AIHybridRetrievalRequest } from "../src/server/ai/retrieval";
import { AI_RETRIEVAL_CONFIG_RESOURCE_TYPE, SQLiteAIRetrievalConfigRepository } from "../src/server/ai/retrieval-config";
import { AIConversationService, SQLiteAIConversationRepository } from "../src/server/ai/conversations";
import { AITutorGenerationPlanner, AITutorPreflightService, SQLiteAITutorConfigRepository } from "../src/server/ai/tutor";
import { createLocalAISecretStore } from "../src/server/ai/secrets";
import { AIJobHandlerRegistry, AIJobQueueService } from "../src/server/ai/operations/jobs";
import { AIWorker } from "../src/server/ai/operations/worker";
import { createCanonicalContentRepository } from "../src/server/canonical-content";
import { createChangeManagementService } from "../src/server/change-management";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";
import type { CanonicalRichDocument } from "../src/server/questions/contracts";

const MIGRATIONS = path.join(process.cwd(), "drizzle");
const BASE_TIME = 1_905_100_000_000;
const MASTER_KEY = Buffer.alloc(32, 0x5b);
const QUERY_MARKER = "TOP_SECRET_M9B1_TARGET_QUERY_91";
const EVIDENCE_MARKER = "PRIVATE_EVIDENCE_M9B1_27";

const usage = (inputTokens: number, outputTokens: number): NormalizedProviderUsage => ({ inputTokens, outputTokens, reasoningTokens: 0, cacheHitInputTokens: 0, cacheMissInputTokens: 0 });
const billable = (value: NormalizedProviderUsage) => ({ standardInputTokens: value.inputTokens, cacheHitInputTokens: value.cacheHitInputTokens, cacheMissInputTokens: value.cacheMissInputTokens, outputTokens: value.outputTokens, reasoningTokens: value.reasoningTokens, requestUnits: 1 });

class TargetGenerationAdapter implements GenerationProviderAdapter {
  readonly adapterKey = "test.m9b1.generation";
  readonly capability = "GENERATION" as const;
  calls = 0;
  requests: GenerationProviderRequest[] = [];
  waitForAbort = false;
  finishReason: "STOP" | "LENGTH" | "CONTENT_FILTER" | "OTHER" = "STOP";
  deltas = ["safe answer [E1]"];
  usageEvents: NormalizedProviderUsage[] = [];
  finalUsage = usage(18, 3);
  failure: "UNAVAILABLE" | "TIMEOUT" | "AUTHENTICATION" | null = null;
  onCall: (() => void) | null = null;
  private startedResolver: (() => void) | null = null;
  readonly started = new Promise<void>((resolve) => { this.startedResolver = resolve; });
  async *generate(request: GenerationProviderRequest, _context: ProviderAdapterExecutionContext): AsyncIterable<ProviderGenerationStreamEvent> {
    this.calls += 1;
    this.requests.push(request);
    this.onCall?.();
    this.startedResolver?.();
    yield { type: "STARTED", providerRequestId: `m9b1-generation-${this.calls}` };
    for (const delta of this.deltas) yield { type: "TEXT_DELTA", text: delta };
    for (const value of this.usageEvents) yield { type: "USAGE", usage: value };
    if (this.waitForAbort) {
      await new Promise<void>((resolve) => {
        const onAbort = () => resolve();
        if (_context.signal.aborted) resolve();
        else _context.signal.addEventListener("abort", onAbort, { once: true });
      });
      throw new AIProviderAdapterError("CANCELLED", { retryable: false, fallbackEligible: false });
    }
    if (this.failure) throw new AIProviderAdapterError(this.failure, { retryable: false, fallbackEligible: false });
    yield { type: "COMPLETED", finishReason: this.finishReason, usage: this.finalUsage, providerRequestId: `m9b1-generation-${this.calls}` };
  }
}

class TargetEmbeddingAdapter implements EmbeddingProviderAdapter {
  readonly adapterKey = "test.m9b1.embedding";
  readonly capability = "EMBEDDING" as const;
  calls = 0;
  onCall: (() => void) | null = null;
  async embed(request: EmbeddingProviderRequest, _context: ProviderAdapterExecutionContext): Promise<EmbeddingProviderResult> {
    this.calls += 1;
    this.onCall?.();
    return { vectors: request.inputs.map(() => [1, 0, 0]), dimensions: 3, usage: usage(12, 0), providerRequestId: `m9b1-embedding-${this.calls}` };
  }
}

class TargetRerankerAdapter implements RerankerProviderAdapter {
  readonly adapterKey = "test.m9b1.rerank";
  readonly capability = "RERANK" as const;
  calls = 0;
  async rerank(request: RerankProviderRequest, _context: ProviderAdapterExecutionContext): Promise<RerankProviderResult> {
    this.calls += 1;
    return { results: request.candidates.map((candidate, index) => ({ candidateId: candidate.id, score: 1 - index / 100, rank: index + 1 })), usage: usage(8, 0), providerRequestId: `m9b1-rerank-${this.calls}` };
  }
}

interface TargetFixture {
  root: string;
  database: ContentDatabase;
  owner: AdminActor;
  accounting: AICostAccountingService;
  accountingRepository: SQLiteAIAccountingRepository;
  admission: AIBudgetAdmissionService;
  gateway: AIProviderGateway;
  hybrid: HybridRetrievalService;
  makeHybrid(beforeFinalAssembly?: (input: { requestId: string; candidateCount: number }) => void): HybridRetrievalService;
  sources: SQLiteAIKnowledgeSourceRepository;
  sourceId: string;
  packages: SQLiteAIKnowledgePackageRepository;
  packageId: string;
  documentId: string;
  conversations: AIConversationService;
  preflight: AITutorPreflightService;
  adapters: ProviderAdapterRegistry;
  generation: TargetGenerationAdapter;
  embedding: TargetEmbeddingAdapter;
  reranker: TargetRerankerAdapter;
  rerankModelId: string | null;
  tutorConfigId: string;
  retrievalConfigId: string;
  embeddingModelId: string;
  generationModelId: string;
  providerId: string;
  m7bRevisionId: string;
  evalBudgetPolicyId: string;
  evalRateLimitPolicyId: string;
  executionConfigId: string;
  evalRuns: AIEvalRunService;
  close(): void;
}

async function createTargetFixture(options: { withRerank?: boolean; evalHardCapNano?: number; evalRateLimit?: { maxRequests: number; maxConcurrentRequests: number } } = {}): Promise<TargetFixture> {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-m9b1-integration-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory: MIGRATIONS });
  createCanonicalContentRepository(database).bootstrap();
  const ownerUser = new SQLiteAdminIdentityRepository(database).createInitialOwner({ id: uuidv7(), email: `owner-${uuidv7()}@m9b1.test`, displayName: "M9B1 Integration Owner", passwordHash: "fixture", createdAt: BASE_TIME });
  const owner: AdminActor = { actorUserId: ownerUser.id, actorRole: "OWNER" };
  const secrets = createLocalAISecretStore(database, { masterKey: MASTER_KEY, clock: () => BASE_TIME });
  const secret = await secrets.create({ secret: `m9b1-secret-${uuidv7()}`, actor: { type: "ADMIN", actorUserId: owner.actorUserId } });
  const providers = new SQLiteAIProviderConfigRepository(database);
  const providerId = uuidv7();
  providers.create({ id: providerId, content: { key: `m9b1-provider-${uuidv7()}`, displayName: "M9B1 Provider", baseUrl: "https://provider.example/v1", credentialRef: secret.credentialRef, enabled: true, retentionPolicy: "UNKNOWN", trainingPolicy: "UNKNOWN", zdrSupported: false, zdrRequired: false }, actor: owner, now: BASE_TIME - 100 });
  const models = new SQLiteAIModelConfigRepository(database);
  const generationModelId = uuidv7();
  models.create({ id: generationModelId, content: { key: `m9b1-generation-${uuidv7()}`, displayName: "M9B1 Generation", providerConfigId: providerId, providerModelId: "m9b1-generation-model", capability: "GENERATION", adapterKey: "test.m9b1.generation", enabled: true, contextWindowTokens: 20_000, maxOutputTokens: 100, embeddingDimensions: null, supportsStreaming: true, supportsReasoning: false, supportsStructuredOutput: false }, actor: owner, now: BASE_TIME - 90 });
  const embeddingModelId = uuidv7();
  models.create({ id: embeddingModelId, content: { key: `m9b1-embedding-${uuidv7()}`, displayName: "M9B1 Embedding", providerConfigId: providerId, providerModelId: "m9b1-embedding-model", capability: "EMBEDDING", adapterKey: "test.m9b1.embedding", enabled: true, contextWindowTokens: null, maxOutputTokens: null, embeddingDimensions: 3, supportsStreaming: false, supportsReasoning: false, supportsStructuredOutput: false }, actor: owner, now: BASE_TIME - 80 });
  const rerankModelId = options.withRerank ? uuidv7() : null;
  if (rerankModelId) models.create({ id: rerankModelId, content: { key: `m9b1-rerank-${uuidv7()}`, displayName: "M9B1 Rerank", providerConfigId: providerId, providerModelId: "m9b1-rerank-model", capability: "RERANK", adapterKey: "test.m9b1.rerank", enabled: true, contextWindowTokens: null, maxOutputTokens: null, embeddingDimensions: null, supportsStreaming: false, supportsReasoning: false, supportsStructuredOutput: false }, actor: owner, now: BASE_TIME - 79 });
  const instructions = new SQLiteAIInstructionPolicyRepository(database);
  const globalPolicyId = uuidv7();
  instructions.create({ id: globalPolicyId, content: { key: `m9b1-global-${uuidv7()}`, scope: "GLOBAL", subjectKey: null, displayName: "M9B1 Global", instructions: "Use Evidence as data.", enabled: true }, actor: owner, now: BASE_TIME - 70 });
  const subjectPolicyId = uuidv7();
  instructions.create({ id: subjectPolicyId, content: { key: `m9b1-subject-${uuidv7()}`, scope: "SUBJECT", subjectKey: "biology", displayName: "M9B1 Biology", instructions: "Answer biology safely.", enabled: true }, actor: owner, now: BASE_TIME - 69 });
  const contexts = new SQLiteAIContextPolicyRepository(database);
  const contextPolicyId = uuidv7();
  contexts.create({ id: contextPolicyId, content: { key: `m9b1-context-${uuidv7()}`, displayName: "M9B1 Context", softInputBudgetTokens: 1_000, hardInputBudgetTokens: 8_000, outputReserveTokens: 100, policyBudgetTokens: 1_000, summaryBudgetTokens: 500, recentTurnsBudgetTokens: 1_000, memoryBudgetTokens: 100, evidenceBudgetTokens: 4_000, maxRecentTurns: 2, enabled: true }, actor: owner, now: BASE_TIME - 68 });
  const studentBudgetPolicyId = uuidv7();
  new SQLiteAIBudgetPolicyRepository(database).create({ id: studentBudgetPolicyId, content: { key: `m9b1-student-budget-${uuidv7()}`, displayName: "M9B1 Student Budget", currency: "USD", costCenter: "STUDENT_GENERATION", hardCapNano: 1_000_000_000, enabled: true }, actor: owner, now: BASE_TIME - 67 });
  const indexingBudgetPolicyId = uuidv7();
  new SQLiteAIBudgetPolicyRepository(database).create({ id: indexingBudgetPolicyId, content: { key: `m9b1-index-budget-${uuidv7()}`, displayName: "M9B1 Index Budget", currency: "USD", costCenter: "KNOWLEDGE_INDEXING", hardCapNano: 1_000_000_000, enabled: true }, actor: owner, now: BASE_TIME - 66 });
  const evalBudgetPolicyId = uuidv7();
  new SQLiteAIBudgetPolicyRepository(database).create({ id: evalBudgetPolicyId, content: { key: `m9b1-eval-budget-${uuidv7()}`, displayName: "M9B1 Eval Budget", currency: "USD", costCenter: "EVALS", hardCapNano: options.evalHardCapNano ?? 1_000_000_000, enabled: true }, actor: owner, now: BASE_TIME - 65 });
  const evalRateLimitPolicyId = uuidv7();
  const evalRateLimit = options.evalRateLimit ?? { maxRequests: 100, maxConcurrentRequests: 100 };
  new SQLiteAIRateLimitPolicyRepository(database).create({ id: evalRateLimitPolicyId, content: { key: `m9b1-eval-rate-${uuidv7()}`, displayName: "M9B1 Eval Rate", windowMs: 60_000, maxRequests: evalRateLimit.maxRequests, maxConcurrentRequests: evalRateLimit.maxConcurrentRequests, enabled: true }, actor: owner, now: BASE_TIME - 64 });
  const tutorRateLimitPolicyId = uuidv7();
  new SQLiteAIRateLimitPolicyRepository(database).create({ id: tutorRateLimitPolicyId, content: { key: `m9b1-tutor-rate-${uuidv7()}`, displayName: "M9B1 Tutor Rate", windowMs: 60_000, maxRequests: 100, maxConcurrentRequests: 100, enabled: true }, actor: owner, now: BASE_TIME - 63 });
  const rateCards = new SQLiteAIRateCardRepository(database);
  const rateLines = [{ component: "STANDARD_INPUT" as const, unit: "PER_MILLION_TOKENS" as const, amountNano: 1_000_000 }, { component: "OUTPUT" as const, unit: "PER_MILLION_TOKENS" as const, amountNano: 2_000_000 }, { component: "REQUEST" as const, unit: "PER_REQUEST" as const, amountNano: 100 }];
  rateCards.create({ id: uuidv7(), content: { key: `m9b1-embedding-rate-${uuidv7()}`, displayName: "Embedding Rate", modelConfigId: embeddingModelId, modelConfigRevision: 1, currency: "USD", billingUsageNormalizerKey: "m9b1.embedding", effectiveFrom: 0, effectiveTo: null, enabled: true, priceLines: [{ component: "STANDARD_INPUT", unit: "PER_MILLION_TOKENS", amountNano: 1_000_000 }, { component: "REQUEST", unit: "PER_REQUEST", amountNano: 100 }], timeBands: [] }, actor: owner, now: BASE_TIME - 60 });
  rateCards.create({ id: uuidv7(), content: { key: `m9b1-generation-rate-${uuidv7()}`, displayName: "Generation Rate", modelConfigId: generationModelId, modelConfigRevision: 1, currency: "USD", billingUsageNormalizerKey: "m9b1.generation", effectiveFrom: 0, effectiveTo: null, enabled: true, priceLines: rateLines, timeBands: [] }, actor: owner, now: BASE_TIME - 59 });
  if (rerankModelId) rateCards.create({ id: uuidv7(), content: { key: `m9b1-rerank-rate-${uuidv7()}`, displayName: "Rerank Rate", modelConfigId: rerankModelId, modelConfigRevision: 1, currency: "USD", billingUsageNormalizerKey: "m9b1.rerank", effectiveFrom: 0, effectiveTo: null, enabled: true, priceLines: [{ component: "STANDARD_INPUT", unit: "PER_MILLION_TOKENS", amountNano: 1_000_000 }, { component: "REQUEST", unit: "PER_REQUEST", amountNano: 100 }], timeBands: [] }, actor: owner, now: BASE_TIME - 58 });
  const accountingRepository = new SQLiteAIAccountingRepository(database);
  const accounting = new AICostAccountingService({ rateCardResolver: new AIRateCardResolver(rateCards, new SQLiteAIRateCardModelRevisionRepository(database)), billingNormalizers: new AIBillingUsageNormalizerRegistry([{ key: "m9b1.embedding", normalize: billable }, { key: "m9b1.rerank", normalize: billable }, { key: "m9b1.generation", normalize: billable }]), costCalculator: new AICostCalculator(), accounting: accountingRepository });
  const generation = new TargetGenerationAdapter();
  const embedding = new TargetEmbeddingAdapter();
  const reranker = new TargetRerankerAdapter();
  const adapters = new ProviderAdapterRegistry([generation, embedding, reranker]);
  const gateway = new AIProviderGateway({ providerConfigs: providers, modelConfigs: models, secrets, adapters }, { clock: () => BASE_TIME + 10 });
  const changes = createChangeManagementService(database);
  const publish = (resourceType: string, resourceId: string, desired: unknown) => { let change = changes.createChangeSet({ title: "M9B1 integration publication", initialItem: { resourceType, resourceId, expectedRevision: 0, operation: "CREATE", desired } }, owner); change = changes.submit(change.changeSet.id, change.changeSet.revision, owner); change = changes.approve(change.changeSet.id, change.changeSet.revision, owner); changes.publish(change.changeSet.id, change.changeSet.revision, owner); };
  const retrievalConfigId = uuidv7();
  publish(AI_RETRIEVAL_CONFIG_RESOURCE_TYPE, retrievalConfigId, { key: `m9b1-retrieval-${uuidv7()}`, subjectKey: "biology", displayName: "M9B1 Retrieval", enabled: true, embeddingModelConfigId: embeddingModelId, rerankModelConfigId: rerankModelId, lexicalCandidateLimit: 10, semanticCandidateLimit: 10, fusionCandidateLimit: 10, rerankCandidateLimit: 10, evidenceItemLimit: 5, rrfConstant: 60, lexicalWeightUnits: 1, semanticWeightUnits: 1, minimumFusedScoreUnits: 0, minimumEvidenceItemCount: 1, maximumEvidencePackBytes: 32_768, maxEvidenceChunksPerSourceItem: 5, allowedTrustTiers: ["PYTHAGORAS_APPROVED"], semanticFailureBehavior: "FAIL_RETRIEVAL", rerankerFailureBehavior: "USE_FUSION" });
  const sources = new SQLiteAIKnowledgeSourceRepository(database);
  const sourceId = uuidv7();
  const source: AIKnowledgeSourceContent = { key: `m9b1-source-${uuidv7()}`, subjectKey: "biology", sourceType: "PYTHAGORAS_APPROVED", displayName: "M9B1 Source", language: "ar", edition: "test", authorityName: "Pythagoras", authorityType: "TEST", trustTier: "PYTHAGORAS_APPROVED", rightsStatus: "CLEARED", rightsBasis: "OWNED", licenseName: null, attribution: "M9B1", rightsNotes: null, sourceUrl: null, sourceAssetId: null, enabled: true, preparationMethod: "DETERMINISTIC", producerKey: "m9b1", producerRevision: "1" };
  sources.create({ id: sourceId, content: source, actor: owner, now: BASE_TIME - 50 });
  const packages = new SQLiteAIKnowledgePackageRepository(database);
  const packageId = uuidv7();
  const documentId = uuidv7();
  const richContent: CanonicalRichDocument = { type: "doc", version: 1, blocks: [{ id: uuidv7(), type: "paragraph", spans: [{ text: `${EVIDENCE_MARKER} mitochondria are cellular structures` }] }] };
  packages.create({ id: packageId, content: { key: `m9b1-package-${uuidv7()}`, subjectKey: "biology", title: "M9B1 Knowledge", language: "ar", contentRevision: 1, sourceId, sourceRevision: 1, artifactRef: "b".repeat(64), artifactSha256: "b".repeat(64), artifactByteSize: 1 }, documents: [{ packageRevisionId: "pending", documentId, displayOrder: 1, title: "Evidence", provenance: { pageStart: 1, section: "cells" }, content: richContent }], assets: [], actor: owner, now: BASE_TIME - 49 });
  const m7a = new AIChunkProjectionBuilder(database).build({ originKind: "KNOWLEDGE_PACKAGE", originId: packageId, subjectKey: "biology" });
  const m7aRepository = new SQLiteAIRetrievalProjectionRepository(database);
  const m7aSet = m7aRepository.getSet({ originKind: "KNOWLEDGE_PACKAGE", originId: packageId, subjectKey: "biology", strategyKey: "structured-rich-v1", normalizerKey: "retrieval-text-v1" });
  assert.ok(m7aSet);
  const embeddingRepository = new SQLiteAIEmbeddingProjectionRepository(database);
  const embeddingHealth = new AIEmbeddingProjectionHealthService(database, { projections: embeddingRepository, models });
  const vectorIndex = new SQLiteAIVectorIndexAdapter(database, { isRevisionSearchable: (revision) => embeddingHealth.isRevisionSearchable(revision) });
  const jobHandlers = new AIJobHandlerRegistry();
  const indexingAdmission = new AIBudgetAdmissionService(database, { clock: () => BASE_TIME + 1 });
  const embeddingService = new AIEmbeddingProjectionService(database, { m7aProjections: m7aRepository, m7aHealth: new AIRetrievalProjectionHealthService(database), projections: embeddingRepository, vectorIndex, models, providers, secrets, adapters, gateway, jobs: new AIJobQueueService(database, jobHandlers, { clock: () => BASE_TIME + 1 }), admission: indexingAdmission, accounting, costEstimator: createSQLiteAIEmbeddingCostEstimator(new AIRateCardResolver(rateCards, new SQLiteAIRateCardModelRevisionRepository(database))), clock: () => BASE_TIME + 1 });
  const indexingJobs = new AIJobQueueService(database, jobHandlers, { clock: () => BASE_TIME + 1 });
  jobHandlers.register(createAIEmbeddingJobHandler(embeddingService));
  const worker = new AIWorker({ jobs: indexingJobs, handlers: jobHandlers, workerId: `m9b1-indexer-${uuidv7()}`, clock: () => BASE_TIME + 1 });
  const embeddingBuild = embeddingService.startBuild({ subjectKey: "biology", chunkProjectionSetId: m7aSet.id, modelConfigId: embeddingModelId, budgetPolicyId: indexingBudgetPolicyId, budgetPolicyRevision: 1, rateLimitPolicyId: tutorRateLimitPolicyId, rateLimitPolicyRevision: 1, budgetPeriod: { startAt: 0, endAt: BASE_TIME + 100_000 }, batchSize: 50 });
  await worker.runOnce(BASE_TIME + 1);
  assert.equal(embeddingBuild.status, "BUILDING");
  embedding.calls = 0;
  const retrievals = new SQLiteAIRetrievalConfigRepository(database);
  const makeHybrid = (beforeFinalAssembly?: (input: { requestId: string; candidateCount: number }) => void) => new HybridRetrievalService({ database, configs: retrievals, models, providers, m7aHealth: new AIRetrievalProjectionHealthService(database), lexical: new SQLiteAILexicalRetrievalAdapter(database), embeddings: embeddingRepository, embeddingHealth, vectors: vectorIndex, sources, gateway, accounting, admission: indexingAdmission, beforeFinalAssembly });
  const hybrid = makeHybrid();
  const tutorConfigId = uuidv7();
  const tutorRate = tutorRateLimitPolicyId;
  publish("ai.tutor-config", tutorConfigId, { key: `m9b1-tutor-${uuidv7()}`, subjectKey: "biology", displayName: "M9B1 Tutor", enabled: true, generationModelConfigId: generationModelId, contextPolicyId, retrievalConfigId, budgetPolicyId: studentBudgetPolicyId, rateLimitPolicyId: tutorRate, maxOutputTokens: 40 });
  const executionConfigId = uuidv7();
  publish(AI_EVAL_EXECUTION_CONFIG_RESOURCE_TYPE, executionConfigId, { key: `m9b1-execution-${uuidv7()}`, subjectKey: "biology", displayName: "M9B1 Target Execution", enabled: true, budgetPolicyId: evalBudgetPolicyId, budgetPolicyRevision: 1, rateLimitPolicyId: evalRateLimitPolicyId, rateLimitPolicyRevision: 1, protocolKey: "eval-target-v1", protocolRevision: 1, targetTimeoutMs: 30_000, maxConcurrency: 2, cleanupProtocolKey: "synthetic-c4-cleanup-v1", cleanupProtocolRevision: 1 });
  const conversations = new AIConversationService(database, { clock: () => BASE_TIME + 22 });
  const preflight = new AITutorPreflightService(database, { conversations: new SQLiteAIConversationRepository(database), context: new AIContextService(database, { clock: () => BASE_TIME + 22 }), models, providers, retrievalConfigs: retrievals, contextPolicies: contexts, adapters, clock: () => BASE_TIME + 22 });
  return { root, database, owner, accounting, accountingRepository, admission: new AIBudgetAdmissionService(database, { clock: () => BASE_TIME + 22 }), gateway, hybrid, makeHybrid, sources, sourceId, packages, packageId, documentId, conversations, preflight, adapters, generation, embedding, reranker, rerankModelId, tutorConfigId, retrievalConfigId, embeddingModelId, generationModelId, providerId, m7bRevisionId: embeddingBuild.embeddingProjectionRevisionId, evalBudgetPolicyId, evalRateLimitPolicyId, executionConfigId, evalRuns: new AIEvalRunService(database), close() { database.close(); rmSync(root, { recursive: true, force: true }); } };
}

function publishTargetDefinition(f: TargetFixture, resourceType: string, resourceId: string, desired: unknown): void {
  const changes = createChangeManagementService(f.database);
  let change = changes.createChangeSet({ title: "M9B1 target definition", initialItem: { resourceType, resourceId, expectedRevision: 0, operation: "CREATE", desired } }, f.owner);
  change = changes.submit(change.changeSet.id, change.changeSet.revision, f.owner);
  change = changes.approve(change.changeSet.id, change.changeSet.revision, f.owner);
  changes.publish(change.changeSet.id, change.changeSet.revision, f.owner);
}

function candidateForFixture(f: TargetFixture) {
  const tutor = new SQLiteAITutorConfigRepository(f.database).getById(f.tutorConfigId)!;
  const instructions = new SQLiteAIInstructionPolicyRepository(f.database);
  const global = instructions.getByScope("GLOBAL", null)!;
  const subject = instructions.getByScope("SUBJECT", "biology")!;
  const context = new SQLiteAIContextPolicyRepository(f.database).getById(tutor.contextPolicyId)!;
  const retrieval = new SQLiteAIRetrievalConfigRepository(f.database).getById(f.retrievalConfigId)!;
  const model = new SQLiteAIModelConfigRepository(f.database).getById(f.generationModelId)!;
  const provider = new SQLiteAIProviderConfigRepository(f.database).getById(f.providerId)!;
  return normalizeAIEvalCandidateSnapshot({ tutorConfig: { id: tutor.id, revision: tutor.currentRevision }, globalPolicy: { id: global.id, revision: global.currentRevision }, subjectPolicy: { id: subject.id, revision: subject.currentRevision }, contextPolicy: { id: context.id, revision: context.currentRevision }, retrievalConfig: { id: retrieval.id, revision: retrieval.currentRevision }, generationModel: { id: model.id, revision: model.revision }, generationProvider: { id: provider.id, revision: provider.revision }, embeddingSpace: { projectionRevisionId: f.m7bRevisionId, modelConfigId: f.embeddingModelId, modelConfigRevision: 1 }, rerank: f.rerankModelId ? { modelConfigId: f.rerankModelId, modelConfigRevision: 1, providerConfigId: f.providerId, providerConfigRevision: 1 } : null, groundingProtocol: { key: "evidence-grounded-v1", revision: 1 }, citationProtocol: { key: "evidence-ref-v1", revision: 1 } });
}

function createTargetRun(f: TargetFixture, inputText = QUERY_MARKER, expectedStatus: "COMPLETED" | "BLOCKED" | "FAILED" | "CANCELLED" = "COMPLETED", maximumLatencyMs: number | null = null): { run: ReturnType<AIEvalRunService["createRun"]>; caseId: string } {
  const caseId = uuidv7();
  publishTargetDefinition(f, AI_EVAL_CASE_RESOURCE_TYPE, caseId, { key: `m9b1.target.case.${uuidv7()}`, subjectKey: "biology", displayName: "M9B1 target case", description: null, inputText, origin: "SYNTHETIC", privacyClass: "SYNTHETIC_PUBLIC_SAFE", deidentificationProof: null, expectedStatus, allowedFinishReasons: expectedStatus === "CANCELLED" ? ["OTHER"] : ["STOP"], requiredOutputLiterals: expectedStatus === "COMPLETED" ? ["safe"] : [], forbiddenOutputLiterals: [], requiredEvidenceOrigins: [], forbiddenEvidenceOrigins: [], requiredCitationLabels: expectedStatus === "COMPLETED" ? ["[E1]"] : [], minimumEvidenceItemCount: expectedStatus === "COMPLETED" ? 1 : 0, securityLeakageMarkers: [], maximumOutputBytes: 1_024, sourceRevisionReferences: [], enabled: true });
  const suiteId = uuidv7();
  publishTargetDefinition(f, AI_EVAL_SUITE_RESOURCE_TYPE, suiteId, { key: `m9b1.target.suite.${uuidv7()}`, subjectKey: "biology", displayName: "M9B1 target suite", enabled: true, caseManifest: [{ ordinal: 1, caseId, caseRevision: 1 }], requiredDimensions: [{ dimension: "RELEVANCE", mode: "NOT_APPLICABLE" }], graderConfigs: [], gateConfig: { minimumScores: [], maximumCostNano: null, maximumLatencyMs, requireSecurityPass: false }, permittedRegressionDeltas: [], baselineMode: "OPTIONAL", supplementaryJudgeConfig: null });
  const run = new AIEvalRunService(f.database).createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot: candidateForFixture(f), createdAt: BASE_TIME + 10 });
  return { run, caseId };
}

function createTargetService(f: TargetFixture, retrieval: Pick<HybridRetrievalService, "retrieve" | "assertEvidencePackCurrent"> = f.hybrid, clock?: () => number, admission = f.admission): AIEvalTargetExecutionService {
  const targetClock = clock ?? (() => BASE_TIME + 22);
  const conversations = clock === undefined ? f.conversations : new AIConversationService(f.database, { clock });
  return new AIEvalTargetExecutionService({ database: f.database, conversations, preflight: f.preflight, planner: new AITutorGenerationPlanner(), retrieval, gateway: f.gateway, accounting: f.accounting, admission, estimator: { estimatorKey: "m9b1.integration", estimate: (text: string) => text.trim() ? 1 : 0 }, budgetPeriodResolver: { resolve: () => ({ startAt: 0, endAt: BASE_TIME + 100_000 }) }, clock: targetClock });
}

function scheduleTarget(f: TargetFixture, runId: string) {
  const target = createTargetService(f);
  const handlers = new AIJobHandlerRegistry();
  handlers.register(createAIEvalTargetExecutionJobHandler(target));
  const jobs = new AIJobQueueService(f.database, handlers, { clock: () => BASE_TIME + 21 });
  const config = new SQLiteAIEvalExecutionConfigRepository(f.database).getById(f.executionConfigId)!;
  const scheduled = new AIEvalTargetOrchestrator({ database: f.database, jobs, clock: () => BASE_TIME + 21 }).scheduleRun({ runId, executionConfigId: f.executionConfigId, executionConfigRevision: config.currentRevision, createdBy: f.owner.actorUserId, now: BASE_TIME + 21 });
  return { target, jobs, handlers, scheduled };
}

function createEvalDummyAdmission(f: TargetFixture): string {
  const operationId = uuidv7();
  f.accounting.createOperation({ costCenter: "EVALS", idempotencyKey: null, opaquePrincipalRef: null, subjectKey: "biology", conversationId: null, responseId: null, jobId: null, evalRunId: uuidv7(), knowledgeRevision: null, status: "OPEN", startedAt: BASE_TIME + 5, completedAt: null }, operationId);
  const base = { principalRef: AI_EVALS_ADMISSION_PRINCIPAL_REF, budgetPolicyId: f.evalBudgetPolicyId, budgetPolicyRevision: 1, rateLimitPolicyId: f.evalRateLimitPolicyId, rateLimitPolicyRevision: 1, budgetPeriod: { startAt: 0, endAt: BASE_TIME + 100_000 }, costOperationId: operationId, costEstimate: { currency: "USD", maxCostNano: 0, estimateBasis: "m9b1-dummy" }, idempotencyKey: `m9b1-dummy-${uuidv7()}` };
  f.admission.admit({ ...base, requestFingerprint: createAIAdmissionRequestFingerprint(base) });
  return operationId;
}


test("M9B1 executes one real M7C target through one EVALS operation and cleans synthetic C4", async () => {
  const f = await createTargetFixture();
  try {
    const tutors = new SQLiteAITutorConfigRepository(f.database);
    const tutor = tutors.getById(f.tutorConfigId)!;
    const instruction = new SQLiteAIInstructionPolicyRepository(f.database);
    const context = new SQLiteAIContextPolicyRepository(f.database).getById(tutor.contextPolicyId)!;
    const retrieval = new SQLiteAIRetrievalConfigRepository(f.database).getById(f.retrievalConfigId)!;
    const model = new SQLiteAIModelConfigRepository(f.database).getById(f.generationModelId)!;
    const provider = new SQLiteAIProviderConfigRepository(f.database).getById(f.providerId)!;
    const snapshot = normalizeAIEvalCandidateSnapshot({ tutorConfig: { id: tutor.id, revision: tutor.currentRevision }, globalPolicy: { id: instruction.getByScope("GLOBAL", null)!.id, revision: instruction.getByScope("GLOBAL", null)!.currentRevision }, subjectPolicy: { id: instruction.getByScope("SUBJECT", "biology")!.id, revision: instruction.getByScope("SUBJECT", "biology")!.currentRevision }, contextPolicy: { id: context.id, revision: context.currentRevision }, retrievalConfig: { id: retrieval.id, revision: retrieval.currentRevision }, generationModel: { id: model.id, revision: model.revision }, generationProvider: { id: provider.id, revision: provider.revision }, embeddingSpace: { projectionRevisionId: f.m7bRevisionId, modelConfigId: f.embeddingModelId, modelConfigRevision: 1 }, rerank: null, groundingProtocol: { key: "evidence-grounded-v1", revision: 1 }, citationProtocol: { key: "evidence-ref-v1", revision: 1 } });
    const changes = createChangeManagementService(f.database);
    const publish = (resourceType: string, resourceId: string, desired: unknown) => { let change = changes.createChangeSet({ title: "M9B1 eval fixture", initialItem: { resourceType, resourceId, expectedRevision: 0, operation: "CREATE", desired } }, f.owner); change = changes.submit(change.changeSet.id, change.changeSet.revision, f.owner); change = changes.approve(change.changeSet.id, change.changeSet.revision, f.owner); changes.publish(change.changeSet.id, change.changeSet.revision, f.owner); };
    const caseId = uuidv7();
    publish(AI_EVAL_CASE_RESOURCE_TYPE, caseId, { key: `m9b1.integration.case.${uuidv7()}`, subjectKey: "biology", displayName: "Integration case", description: null, inputText: QUERY_MARKER, origin: "SYNTHETIC", privacyClass: "SYNTHETIC_PUBLIC_SAFE", deidentificationProof: null, expectedStatus: "COMPLETED", allowedFinishReasons: ["STOP"], requiredOutputLiterals: ["safe"], forbiddenOutputLiterals: [], requiredEvidenceOrigins: [], forbiddenEvidenceOrigins: [], requiredCitationLabels: ["[E1]"], minimumEvidenceItemCount: 1, securityLeakageMarkers: ["PRIVATE_OUTPUT_MARKER"], maximumOutputBytes: 1_024, sourceRevisionReferences: [], enabled: true });
    const suiteId = uuidv7();
    publish(AI_EVAL_SUITE_RESOURCE_TYPE, suiteId, { key: `m9b1.integration.suite.${uuidv7()}`, subjectKey: "biology", displayName: "Integration suite", enabled: true, caseManifest: [{ ordinal: 1, caseId, caseRevision: 1 }], requiredDimensions: [{ dimension: "CORRECTNESS", mode: "DETERMINISTICALLY_GRADED" }, { dimension: "GROUNDEDNESS", mode: "DETERMINISTICALLY_GRADED" }, { dimension: "SECURITY", mode: "DETERMINISTICALLY_GRADED" }], graderConfigs: [{ graderKey: AI_EVAL_GRADER_KEYS.STATUS_MATCH, graderRevision: 1, dimension: "CORRECTNESS", required: true }, { graderKey: AI_EVAL_GRADER_KEYS.LITERAL_OUTPUT, graderRevision: 1, dimension: "CORRECTNESS", required: true }, { graderKey: AI_EVAL_GRADER_KEYS.CITATION_INTEGRITY, graderRevision: 1, dimension: "GROUNDEDNESS", required: true }, { graderKey: AI_EVAL_GRADER_KEYS.SECURITY_LEAK, graderRevision: 1, dimension: "SECURITY", required: true }], gateConfig: { minimumScores: [], maximumCostNano: null, maximumLatencyMs: null, requireSecurityPass: true }, permittedRegressionDeltas: [], baselineMode: "OPTIONAL", supplementaryJudgeConfig: null });
    const run = f.evalRuns.createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot: snapshot, createdAt: BASE_TIME + 20 });
    const executionConfig = new SQLiteAIEvalExecutionConfigRepository(f.database).getById(f.executionConfigId)!;
    const beforeEmbedding = { operation: false, reservation: false };
    f.embedding.onCall = () => { const operations = f.database.client.prepare("select id,status from ai_cost_operations where cost_center='EVALS'").all() as Array<{ id: string; status: string }>; const reservations = f.database.client.prepare("select operation_id,status from ai_budget_reservations where principal_ref='system-evals'").all() as Array<{ operation_id: string; status: string }>; beforeEmbedding.operation = operations.length === 1 && operations[0]!.status === "OPEN"; beforeEmbedding.reservation = reservations.length === 1 && reservations[0]!.operation_id === operations[0]!.id && reservations[0]!.status === "EXECUTING"; };
    const requests: AIHybridRetrievalRequest[] = [];
    const retrievalSpy = { retrieve: async (request: AIHybridRetrievalRequest) => { requests.push(request); return f.hybrid.retrieve(request); }, assertEvidencePackCurrent: (pack: Parameters<HybridRetrievalService["assertEvidencePackCurrent"]>[0]) => f.hybrid.assertEvidencePackCurrent(pack) };
    const target = new AIEvalTargetExecutionService({ database: f.database, conversations: f.conversations, preflight: f.preflight, planner: new AITutorGenerationPlanner(), retrieval: retrievalSpy, gateway: f.gateway, accounting: f.accounting, admission: f.admission, estimator: { estimatorKey: "m9b1.integration", estimate: (_text: string) => 1 }, budgetPeriodResolver: { resolve: () => ({ startAt: 0, endAt: BASE_TIME + 100_000 }) }, clock: () => BASE_TIME + 22 });
    const handlers = new AIJobHandlerRegistry();
    handlers.register(createAIEvalTargetExecutionJobHandler(target));
    const jobs = new AIJobQueueService(f.database, handlers, { clock: () => BASE_TIME + 21 });
    const orchestrator = new AIEvalTargetOrchestrator({ database: f.database, jobs, clock: () => BASE_TIME + 21 });
    const scheduled = orchestrator.scheduleRun({ runId: run.id, executionConfigId: f.executionConfigId, executionConfigRevision: executionConfig.currentRevision, createdBy: f.owner.actorUserId, now: BASE_TIME + 21 });
    const worker = new AIWorker({ jobs, handlers, workerId: `m9b1-target-worker-${uuidv7()}`, clock: () => BASE_TIME + 22 });
    const scheduledJob = f.database.client.prepare("select timeout_ms from ai_jobs where id=?").get(scheduled.jobIds[0]) as { timeout_ms: number };
    assert.equal(scheduledJob.timeout_ms, executionConfig.targetTimeoutMs);
    await worker.runOnce(BASE_TIME + 22);
    const result = { ...(await target.execute({ runId: run.id, caseId, caseRevision: 1 })) };
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.providerInvoked, true);
    assert.equal(f.generation.calls, 1);
    const syntheticResponse = f.database.client.prepare("select id from ai_conversation_responses where principal_ref like 'eval-target-%' order by created_at desc limit 1").get() as { id: string };
    assert.equal(requests[0]?.requestId, syntheticResponse.id);
    assert.equal(f.generation.requests[0]?.requestId, requests[0]?.requestId);
    assert.equal(requests[0]?.subjectKey, "biology");
    assert.equal(requests[0]?.query, QUERY_MARKER);
    assert.equal(requests[0]?.retrievalConfigId, f.retrievalConfigId);
    const generationRequest = f.generation.requests[0]!;
    assert.equal(generationRequest.messages.at(-1)?.content, QUERY_MARKER);
    assert.equal(JSON.stringify(generationRequest).includes(EVIDENCE_MARKER), true);
    assert.equal(JSON.stringify(generationRequest).includes("[E1]"), true);
    assert.equal(JSON.stringify(generationRequest).includes("originMetadata"), false);
    assert.equal(JSON.stringify(generationRequest).includes("trustTier"), false);
    assert.equal((f.database.client.prepare("select status from ai_jobs where id=?").get(scheduled.jobIds[0]) as { status: string }).status, "SUCCEEDED");
    assert.equal(orchestrator.getCoverage(run.id).complete, true);
    assert.equal(new SQLiteAIEvalRunRepository(f.database).getById(run.id)!.status, "RUNNING");
    assert.deepEqual(beforeEmbedding, { operation: true, reservation: true });
    assert.equal(Number((f.database.client.prepare("select count(*) as count from ai_cost_operations where eval_run_id=? and cost_center='EVALS'").get(run.id) as { count: number }).count), 1);
    assert.deepEqual(f.database.client.prepare("select cost_center, opaque_principal_ref, conversation_id, response_id, job_id, idempotency_key, eval_run_id, subject_key from ai_cost_operations where id=?").get(result.costOperationId), { cost_center: "EVALS", opaque_principal_ref: null, conversation_id: null, response_id: null, job_id: null, idempotency_key: null, eval_run_id: run.id, subject_key: "biology" });
    assert.equal(Number((f.database.client.prepare("select count(*) as count from ai_budget_reservations where principal_ref='system-evals'").get() as { count: number }).count), 1);
    assert.equal((f.database.client.prepare("select idempotency_key from ai_budget_reservations where operation_id=?").get(result.costOperationId) as { idempotency_key: string }).idempotency_key, `eval-target-${result.executionId}`);
    assert.equal((f.database.client.prepare("select idempotency_key from ai_cost_operations where id=?").get(result.costOperationId) as { idempotency_key: string | null }).idempotency_key, null);
    assert.equal(Number((f.database.client.prepare("select count(*) as count from ai_usage_cost_records where operation_id=?").get(result.costOperationId) as { count: number }).count), 2);
    assert.equal(Number((f.database.client.prepare("select count(*) as count from ai_tutor_response_traces").get() as { count: number }).count), 0);
    assert.equal((f.database.client.prepare("select status from ai_eval_target_cleanups where case_execution_id=?").get(result.executionId) as { status: string }).status, "CLEANED");
    assert.equal(f.database.client.prepare("select 1 from ai_conversation_messages where content like ?").get(`%${QUERY_MARKER}%`) === undefined, true);
    assert.equal(f.database.client.prepare("select 1 from ai_conversation_response_chunks where text like ?").get(`%${EVIDENCE_MARKER}%`) === undefined, true);
    assert.equal(f.database.client.prepare("select 1 from ai_eval_case_executions where id=? and (output_sha256 is not null) and output_sha256 like ?").get(result.executionId, `%${EVIDENCE_MARKER}%`) === undefined, true);
    for (const table of ["ai_cost_operations", "ai_usage_cost_records", "ai_budget_reservations", "ai_rate_limit_events", "ai_eval_case_executions", "ai_eval_case_results", "ai_jobs", "ai_conversation_messages", "ai_conversation_response_chunks"]) {
      const rows = f.database.client.prepare(`select * from ${table}`).all();
      assert.equal(JSON.stringify(rows).includes(QUERY_MARKER), false);
      assert.equal(JSON.stringify(rows).includes(EVIDENCE_MARKER), false);
    }
  } finally { f.close(); }
});

test("M9B1 blocks an insufficient real Retrieval result before Generation", async () => {
  const f = await createTargetFixture();
  try {
    const source = f.sources.getById(f.sourceId)!;
    f.sources.appendRevision({ id: f.sourceId, expectedRevision: source.currentRevision, content: { key: source.key, subjectKey: source.subjectKey, sourceType: source.sourceType, displayName: source.displayName, language: source.language, edition: source.edition, authorityName: source.authorityName, authorityType: source.authorityType, trustTier: source.trustTier, rightsStatus: "RESTRICTED", rightsBasis: null, licenseName: source.licenseName, attribution: source.attribution, rightsNotes: source.rightsNotes, sourceUrl: source.sourceUrl, sourceAssetId: source.sourceAssetId, enabled: source.enabled, preparationMethod: source.preparationMethod, producerKey: source.producerKey, producerRevision: source.producerRevision }, actor: f.owner, now: BASE_TIME + 1 });
    const { run, caseId } = createTargetRun(f);
    const { target } = scheduleTarget(f, run.id);
    const result = await target.execute({ runId: run.id, caseId, caseRevision: 1 });
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.providerInvoked, false);
    assert.equal(f.embedding.calls, 0);
    assert.equal(f.generation.calls, 0);
    assert.equal((f.database.client.prepare("select observed_status from ai_eval_case_results where run_id=?").get(run.id) as { observed_status: string }).observed_status, "BLOCKED");
    assert.equal((f.database.client.prepare("select status from ai_eval_target_cleanups where case_execution_id=?").get(result.executionId) as { status: string }).status, "CLEANED");
    assert.equal((f.database.client.prepare("select status from ai_cost_operations where id=?").get(result.costOperationId) as { status: string }).status, "COMPLETED");
  } finally { f.close(); }
});

test("M9B1 rejects an exact-candidate revision race before any Provider", async () => {
  const f = await createTargetFixture();
  try {
    const { run, caseId } = createTargetRun(f);
    scheduleTarget(f, run.id);
    const tutors = new SQLiteAITutorConfigRepository(f.database);
    const tutor = tutors.getById(f.tutorConfigId)!;
    tutors.appendRevision({ id: tutor.id, expectedRevision: tutor.currentRevision, content: { key: tutor.key, subjectKey: tutor.subjectKey, displayName: "Changed after Eval pin", enabled: tutor.enabled, generationModelConfigId: tutor.generationModelConfigId, contextPolicyId: tutor.contextPolicyId, retrievalConfigId: tutor.retrievalConfigId, budgetPolicyId: tutor.budgetPolicyId, rateLimitPolicyId: tutor.rateLimitPolicyId, maxOutputTokens: tutor.maxOutputTokens }, actor: f.owner, now: BASE_TIME + 1 });
    const result = await createTargetService(f).execute({ runId: run.id, caseId, caseRevision: 1 });
    assert.equal(result.status, "FAILED");
    assert.equal(f.embedding.calls, 0);
    assert.equal(f.generation.calls, 0);
    assert.equal((f.database.client.prepare("select safe_failure_code from ai_eval_case_executions where id=?").get(result.executionId) as { safe_failure_code: string }).safe_failure_code, "EVAL_CANDIDATE_STALE");
  } finally { f.close(); }
});

test("M9B1 fails closed for stale Retrieval, Model, Provider, and M7A candidate prerequisites", async () => {
  const cases = ["RETRIEVAL", "MODEL", "PROVIDER", "M7A"] as const;
  for (const kind of cases) {
    const f = await createTargetFixture();
    try {
      const { run, caseId } = createTargetRun(f);
      scheduleTarget(f, run.id);
      if (kind === "RETRIEVAL") {
        const repository = new SQLiteAIRetrievalConfigRepository(f.database);
        const current = repository.getById(f.retrievalConfigId)!;
        repository.appendRevision({ id: current.id, expectedRevision: current.currentRevision, content: { key: current.key, subjectKey: current.subjectKey, displayName: "Changed Retrieval", enabled: current.enabled, embeddingModelConfigId: current.embeddingModelConfigId, rerankModelConfigId: current.rerankModelConfigId, lexicalCandidateLimit: current.lexicalCandidateLimit, semanticCandidateLimit: current.semanticCandidateLimit, fusionCandidateLimit: current.fusionCandidateLimit, rerankCandidateLimit: current.rerankCandidateLimit, evidenceItemLimit: current.evidenceItemLimit, rrfConstant: current.rrfConstant, lexicalWeightUnits: current.lexicalWeightUnits, semanticWeightUnits: current.semanticWeightUnits, minimumFusedScoreUnits: current.minimumFusedScoreUnits, minimumEvidenceItemCount: current.minimumEvidenceItemCount, maximumEvidencePackBytes: current.maximumEvidencePackBytes, maxEvidenceChunksPerSourceItem: current.maxEvidenceChunksPerSourceItem, allowedTrustTiers: current.allowedTrustTiers, semanticFailureBehavior: current.semanticFailureBehavior, rerankerFailureBehavior: current.rerankerFailureBehavior }, actor: f.owner, now: BASE_TIME + 1 });
      } else if (kind === "MODEL") {
        const repository = new SQLiteAIModelConfigRepository(f.database);
        const current = repository.getById(f.generationModelId)!;
        repository.update({ id: current.id, expectedRevision: current.revision, actor: f.owner, now: BASE_TIME + 1, content: { key: current.key, displayName: "Changed Generation", providerConfigId: current.providerConfigId, providerModelId: current.providerModelId, capability: current.capability, adapterKey: current.adapterKey, enabled: current.enabled, contextWindowTokens: current.contextWindowTokens, maxOutputTokens: current.maxOutputTokens, embeddingDimensions: current.embeddingDimensions, supportsStreaming: current.supportsStreaming, supportsReasoning: current.supportsReasoning, supportsStructuredOutput: current.supportsStructuredOutput } });
      } else if (kind === "PROVIDER") {
        const repository = new SQLiteAIProviderConfigRepository(f.database);
        const current = repository.getById(f.providerId)!;
        repository.update({ id: current.id, expectedRevision: current.revision, actor: f.owner, now: BASE_TIME + 1, content: { key: current.key, displayName: "Changed Provider", baseUrl: current.baseUrl, credentialRef: current.credentialRef, enabled: current.enabled, retentionPolicy: current.retentionPolicy, trainingPolicy: current.trainingPolicy, zdrSupported: current.zdrSupported, zdrRequired: current.zdrRequired } });
      } else {
        const source = f.sources.getById(f.sourceId)!;
        f.packages.appendRevision({ id: f.packageId, expectedRevision: 1, content: { key: f.packages.getById(f.packageId)!.package.key, subjectKey: "biology", title: "Changed M7A package", language: "ar", contentRevision: 2, sourceId: f.sourceId, sourceRevision: 1, artifactRef: "b".repeat(64), artifactSha256: "b".repeat(64), artifactByteSize: 1 }, documents: [{ packageRevisionId: "pending", documentId: f.documentId, displayOrder: 1, title: "Evidence", provenance: { pageStart: 1, section: "changed" }, content: { type: "doc", version: 1, blocks: [{ id: uuidv7(), type: "paragraph", spans: [{ text: "changed package evidence" }] }] } }], assets: [], actor: f.owner, now: BASE_TIME + 1 });
      }
      const result = await createTargetService(f).execute({ runId: run.id, caseId, caseRevision: 1 });
      assert.equal(result.status, kind === "M7A" ? "BLOCKED" : "FAILED", kind);
      assert.equal(f.embedding.calls, 0);
      assert.equal(f.generation.calls, 0);
    } finally { f.close(); }
  }
});

test("M9B1 final Retrieval freshness race preserves incurred EVALS usage and skips Generation", async () => {
  const f = await createTargetFixture();
  try {
    const { run, caseId } = createTargetRun(f);
    scheduleTarget(f, run.id);
    let changed = false;
    const retrieval = f.makeHybrid(() => {
      if (changed) return;
      changed = true;
      const source = f.sources.getById(f.sourceId)!;
      f.sources.appendRevision({ id: f.sourceId, expectedRevision: source.currentRevision, content: { key: source.key, subjectKey: source.subjectKey, sourceType: source.sourceType, displayName: source.displayName, language: source.language, edition: source.edition, authorityName: source.authorityName, authorityType: source.authorityType, trustTier: source.trustTier, rightsStatus: "RESTRICTED", rightsBasis: null, licenseName: source.licenseName, attribution: source.attribution, rightsNotes: source.rightsNotes, sourceUrl: source.sourceUrl, sourceAssetId: source.sourceAssetId, enabled: source.enabled, preparationMethod: source.preparationMethod, producerKey: source.producerKey, producerRevision: source.producerRevision }, actor: f.owner, now: BASE_TIME + 2 });
    });
    const result = await createTargetService(f, retrieval).execute({ runId: run.id, caseId, caseRevision: 1 });
    assert.equal(result.status, "BLOCKED");
    assert.equal(f.embedding.calls, 1);
    assert.equal(f.generation.calls, 0);
    assert.equal(Number((f.database.client.prepare("select count(*) as count from ai_usage_cost_records where operation_id=?").get(result.costOperationId) as { count: number }).count), 1);
    assert.equal(result.settlementStatus, "SETTLED");
  } finally { f.close(); }
});

test("M9B1 cancellation during the single Generation target propagates promptly and preserves usage", async () => {
  const f = await createTargetFixture();
  try {
    f.generation.waitForAbort = true;
    const { run, caseId } = createTargetRun(f);
    scheduleTarget(f, run.id);
    const controller = new AbortController();
    const startedAt = performance.now();
    const pending = createTargetService(f).execute({ runId: run.id, caseId, caseRevision: 1, signal: controller.signal });
    await f.generation.started;
    controller.abort();
    const result = await pending;
    assert.equal(result.status, "CANCELLED");
    assert.equal(result.providerInvoked, true);
    assert.equal(f.generation.calls, 1);
    assert.ok(performance.now() - startedAt < 1_000);
    assert.equal((f.database.client.prepare("select status from ai_cost_operations where id=?").get(result.costOperationId) as { status: string }).status, "CANCELLED");
    assert.equal(Number((f.database.client.prepare("select count(*) as count from ai_usage_cost_records where operation_id=?").get(result.costOperationId) as { count: number }).count), 2);
    assert.equal((f.database.client.prepare("select status from ai_eval_case_executions where id=?").get(result.executionId) as { status: string }).status, "CANCELLED");
    assert.equal((f.database.client.prepare("select status from ai_eval_target_cleanups where case_execution_id=?").get(result.executionId) as { status: string }).status, "CLEANED");
  } finally { f.close(); }
});

test("M9B1 preserves supported Generation finish reasons without retries", async () => {
  for (const finishReason of ["STOP", "LENGTH", "CONTENT_FILTER"] as const) {
    const f = await createTargetFixture();
    try {
      f.generation.finishReason = finishReason;
      if (finishReason === "CONTENT_FILTER") f.generation.deltas = [];
      const { run, caseId } = createTargetRun(f);
      scheduleTarget(f, run.id);
      const result = await createTargetService(f).execute({ runId: run.id, caseId, caseRevision: 1 });
      assert.equal(result.status, "COMPLETED");
      assert.equal(f.generation.calls, 1);
      assert.equal((f.database.client.prepare("select finish_reason from ai_eval_case_results where run_id=?").get(run.id) as { finish_reason: string }).finish_reason, finishReason);
    } finally { f.close(); }
  }
});

test("M9B1 records optional M7C Rerank on the same EVALS Cost Operation", async () => {
  const f = await createTargetFixture({ withRerank: true });
  try {
    const { run, caseId } = createTargetRun(f);
    scheduleTarget(f, run.id);
    const result = await createTargetService(f).execute({ runId: run.id, caseId, caseRevision: 1 });
    assert.equal(result.status, "COMPLETED");
    assert.equal(f.reranker.calls, 1);
    assert.equal(Number((f.database.client.prepare("select count(*) as count from ai_usage_cost_records where operation_id=?").get(result.costOperationId) as { count: number }).count), 3);
    assert.deepEqual(f.database.client.prepare("select capability from ai_usage_cost_records where operation_id=? order by capability").all(result.costOperationId), [{ capability: "EMBEDDING" }, { capability: "GENERATION" }, { capability: "RERANK" }]);
  } finally { f.close(); }
});

test("M9B1 records partial Provider failure and unknown usage without fake zero or retry", async () => {
  const f = await createTargetFixture();
  try {
    f.generation.failure = "UNAVAILABLE";
    f.generation.usageEvents = [usage(12, 1)];
    const { run, caseId } = createTargetRun(f);
    scheduleTarget(f, run.id);
    const result = await createTargetService(f).execute({ runId: run.id, caseId, caseRevision: 1 });
    assert.equal(result.status, "FAILED");
    assert.equal(f.generation.calls, 1);
    assert.equal(Number((f.database.client.prepare("select count(*) as count from ai_usage_cost_records where operation_id=?").get(result.costOperationId) as { count: number }).count), 2);
    assert.equal(result.settlementStatus, "SETTLED");
  } finally { f.close(); }

  const unknown = await createTargetFixture();
  try {
    unknown.generation.failure = "UNAVAILABLE";
    unknown.generation.finalUsage = { inputTokens: null, outputTokens: null, reasoningTokens: null, cacheHitInputTokens: null, cacheMissInputTokens: null };
    const { run, caseId } = createTargetRun(unknown);
    scheduleTarget(unknown, run.id);
    const result = await createTargetService(unknown).execute({ runId: run.id, caseId, caseRevision: 1 });
    assert.equal(result.status, "FAILED");
    assert.equal(result.settlementStatus, "RECONCILIATION_REQUIRED");
    const row = unknown.database.client.prepare("select normalized_input_tokens, normalized_output_tokens, normalized_reasoning_tokens from ai_usage_cost_records where operation_id=? and capability='GENERATION'").get(result.costOperationId) as { normalized_input_tokens: number | null; normalized_output_tokens: number | null; normalized_reasoning_tokens: number | null };
    assert.deepEqual(row, { normalized_input_tokens: null, normalized_output_tokens: null, normalized_reasoning_tokens: null });
    assert.equal(unknown.generation.calls, 1);
  } finally { unknown.close(); }
});

test("M9B1 fails response overflow without truncation or retry", async () => {
  const f = await createTargetFixture();
  try {
    f.generation.deltas = ["x".repeat(300_000), "y".repeat(250_000)];
    const { run, caseId } = createTargetRun(f);
    scheduleTarget(f, run.id);
    const result = await createTargetService(f).execute({ runId: run.id, caseId, caseRevision: 1 });
    assert.equal(result.status, "FAILED");
    assert.equal(f.generation.calls, 1);
    const stored = f.database.client.prepare("select output_byte_size from ai_eval_case_executions where id=?").get(result.executionId) as { output_byte_size: number | null };
    assert.ok(stored.output_byte_size === null || stored.output_byte_size <= 524_288);
    assert.equal((f.database.client.prepare("select status from ai_eval_target_cleanups where case_execution_id=?").get(result.executionId) as { status: string }).status, "CLEANED");
  } finally { f.close(); }
});

test("M9B1 denies EVALS budget/rate/concurrency before M7C Provider work", async () => {
  const budget = await createTargetFixture({ evalHardCapNano: 0 });
  try {
    const { run, caseId } = createTargetRun(budget);
    scheduleTarget(budget, run.id);
    const result = await createTargetService(budget).execute({ runId: run.id, caseId, caseRevision: 1 });
    assert.equal(result.status, "FAILED");
    assert.equal(Number((budget.database.client.prepare("select count(*) as count from ai_eval_case_results where run_id=?").get(run.id) as { count: number }).count), 0);
    assert.equal(budget.embedding.calls, 0);
    assert.equal(budget.generation.calls, 0);
  } finally { budget.close(); }

  const rate = await createTargetFixture({ evalRateLimit: { maxRequests: 1, maxConcurrentRequests: 100 } });
  try {
    createEvalDummyAdmission(rate);
    const { run, caseId } = createTargetRun(rate);
    scheduleTarget(rate, run.id);
    const result = await createTargetService(rate).execute({ runId: run.id, caseId, caseRevision: 1 });
    assert.equal(result.status, "PENDING");
    assert.equal(Number((rate.database.client.prepare("select count(*) as count from ai_eval_case_results where run_id=?").get(run.id) as { count: number }).count), 0);
    assert.equal((rate.database.client.prepare("select status from ai_cost_operations where id=?").get(result.costOperationId) as { status: string }).status, "OPEN");
    assert.equal(rate.embedding.calls, 0);
    assert.equal(rate.generation.calls, 0);
  } finally { rate.close(); }

  const concurrency = await createTargetFixture({ evalRateLimit: { maxRequests: 100, maxConcurrentRequests: 1 } });
  try {
    createEvalDummyAdmission(concurrency);
    const { run, caseId } = createTargetRun(concurrency);
    scheduleTarget(concurrency, run.id);
    const result = await createTargetService(concurrency).execute({ runId: run.id, caseId, caseRevision: 1 });
    assert.equal(result.status, "PENDING");
    assert.equal(Number((concurrency.database.client.prepare("select count(*) as count from ai_eval_case_results where run_id=?").get(run.id) as { count: number }).count), 0);
    assert.equal(concurrency.embedding.calls, 0);
    assert.equal(concurrency.generation.calls, 0);
  } finally { concurrency.close(); }
});

test("M9B1 cleanup binding survives a forced deletion failure and is recovered without Provider retry", async () => {
  const f = await createTargetFixture();
  try {
    const { run, caseId } = createTargetRun(f);
    const { target, jobs } = scheduleTarget(f, run.id);
    const originalDelete = f.conversations.deleteConversation.bind(f.conversations);
    let failOnce = true;
    f.conversations.deleteConversation = ((principal: Parameters<AIConversationService["deleteConversation"]>[0], conversationId: string) => {
      if (failOnce) { failOnce = false; throw new Error("controlled cleanup failure"); }
      return originalDelete(principal, conversationId);
    }) as AIConversationService["deleteConversation"];
    const result = await target.execute({ runId: run.id, caseId, caseRevision: 1 });
    assert.equal(result.status, "COMPLETED");
    assert.equal(f.generation.calls, 1);
    const cleanupRow = f.database.client.prepare("select id,status from ai_eval_target_cleanups where case_execution_id=? order by created_at desc limit 1").get(result.executionId) as { id: string; status: string };
    assert.equal(cleanupRow.status, "PENDING");
    assert.throws(() => f.database.client.prepare("update ai_eval_target_cleanups set status='CLEANED', cleaned_at=?, updated_at=? where id=?").run(BASE_TIME + 40, BASE_TIME + 40, cleanupRow.id), /cleanup|lifecycle/i);
    assert.throws(() => f.database.client.prepare("delete from ai_eval_target_cleanups where id=?").run(cleanupRow.id), /append-only|history/i);
    assert.equal(new AIEvalTargetOrchestrator({ database: f.database, jobs }).getCoverage(run.id).complete, false);
    assert.deepEqual(target.reconcilePendingCleanup({ limit: 1, now: BASE_TIME + 40 }), { scanned: 1, reconciled: 1, skipped: 0 });
    assert.equal((f.database.client.prepare("select status from ai_eval_target_cleanups where case_execution_id=?").get(result.executionId) as { status: string }).status, "CLEANED");
    assert.equal(new AIEvalTargetOrchestrator({ database: f.database, jobs }).getCoverage(run.id).complete, true);
    assert.throws(() => f.database.client.prepare("update ai_eval_target_cleanups set safe_failure_code='X' where id=?").run(cleanupRow.id), /cleanup|lifecycle/i);
    assert.equal((f.database.client.prepare("select status from ai_conversations where principal_ref like 'eval-target-%'").get() as { status: string }).status, "DELETED");
    assert.equal(f.generation.calls, 1);
  } finally { f.close(); }
});

test("M9B1 cleanup ownership is recoverable by a new service after a crash window", async () => {
  const f = await createTargetFixture();
  try {
    const { run, caseId } = createTargetRun(f);
    const { scheduled } = scheduleTarget(f, run.id);
    const executions = new SQLiteAIEvalCaseExecutionRepository(f.database);
    const execution = executions.markRunning(executions.getByJob(scheduled.jobIds[0]!)!.id, BASE_TIME + 22);
    const cleanup = new AIEvalTargetCleanupService({ database: f.database, executions, conversations: f.conversations, repository: new SQLiteAIEvalTargetCleanupRepository(f.database), clock: () => BASE_TIME + 30 });
    f.database.client.transaction(() => {
      const conversation = f.conversations.createConversationInTransaction(syntheticPrincipal(execution.id), { conversationId: uuidv7(), subjectKey: "biology", createdAt: BASE_TIME + 30 });
      cleanup.bindInTransaction({ caseExecutionId: execution.id, syntheticConversationId: conversation.id, createdAt: BASE_TIME + 30 });
    }).immediate();
    executions.fail({ id: execution.id, providerInvoked: false, safeFailureCode: "EVAL_TARGET_PROCESS_LOST", now: BASE_TIME + 30 });
    const restarted = new AIEvalTargetCleanupService({ database: f.database, executions: new SQLiteAIEvalCaseExecutionRepository(f.database), conversations: new AIConversationService(f.database, { clock: () => BASE_TIME + 31 }), clock: () => BASE_TIME + 31 });
    assert.deepEqual(restarted.reconcilePending({ limit: 1, now: BASE_TIME + 31 }), { scanned: 1, reconciled: 1, skipped: 0 });
    assert.equal((f.database.client.prepare("select status from ai_eval_target_cleanups where case_execution_id=?").get(execution.id) as { status: string }).status, "CLEANED");
    assert.equal((f.database.client.prepare("select status from ai_conversations where id=(select synthetic_conversation_id from ai_eval_target_cleanups where case_execution_id=?)").get(execution.id) as { status: string }).status, "DELETED");
    assert.equal(f.embedding.calls, 0);
    assert.equal(f.generation.calls, 0);
  } finally { f.close(); }
});

test("M9B1 cleanup recovery rotates a permanently failing binding so later bindings are not starved", async () => {
    const f = await createTargetFixture();
  try {
    const executions = new SQLiteAIEvalCaseExecutionRepository(f.database);
    const cleanupConversations = new AIConversationService(f.database, { clock: () => BASE_TIME + 100 });
    const cleanup = new AIEvalTargetCleanupService({ database: f.database, executions, conversations: cleanupConversations, clock: () => BASE_TIME + 100 });
    const executionIds: string[] = [];
    const conversationIds: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const { run } = createTargetRun(f);
      const { scheduled } = scheduleTarget(f, run.id);
      const execution = executions.markRunning(executions.getByJob(scheduled.jobIds[0]!)!.id, BASE_TIME + 30 + index);
      executionIds.push(execution.id);
      f.database.client.transaction(() => {
        const conversation = f.conversations.createConversationInTransaction(syntheticPrincipal(execution.id), { conversationId: uuidv7(), subjectKey: "biology", createdAt: BASE_TIME + 30 + index });
        conversationIds.push(conversation.id);
        cleanup.bindInTransaction({ caseExecutionId: execution.id, syntheticConversationId: conversation.id, createdAt: BASE_TIME + 30 + index });
      }).immediate();
      executions.fail({ id: execution.id, providerInvoked: false, safeFailureCode: "EVAL_TARGET_CLEANUP_TEST", now: BASE_TIME + 40 + index });
    }
    const failingConversationId = conversationIds[0]!;
    const originalDelete = cleanupConversations.deleteConversation.bind(cleanupConversations);
    cleanupConversations.deleteConversation = ((principal: Parameters<AIConversationService["deleteConversation"]>[0], conversationId: string) => {
      if (conversationId === failingConversationId) throw new Error("permanent controlled cleanup failure");
      return originalDelete(principal, conversationId);
    }) as AIConversationService["deleteConversation"];
    for (let index = 0; index < 5; index += 1) cleanup.reconcilePending({ limit: 1, now: BASE_TIME + 100 + index });
    assert.equal((f.database.client.prepare("select status from ai_eval_target_cleanups where case_execution_id=?").get(executionIds[0]) as { status: string }).status, "PENDING");
    assert.equal((f.database.client.prepare("select status from ai_eval_target_cleanups where case_execution_id=?").get(executionIds[1]) as { status: string }).status, "CLEANED");
    assert.equal((f.database.client.prepare("select status from ai_eval_target_cleanups where case_execution_id=?").get(executionIds[2]) as { status: string }).status, "CLEANED");
    assert.equal(f.embedding.calls, 0);
    assert.equal(f.generation.calls, 0);
    assert.equal(JSON.stringify(f.database.client.prepare("select * from ai_eval_target_cleanups").all()).includes("TOP_SECRET"), false);
  } finally { f.close(); }
});

test("M9B1 persists bounded target latency for successful, blocked, failed, and cancelled outcomes", async () => {
  const successful = await createTargetFixture();
  try {
    let now = BASE_TIME + 22;
    successful.generation.onCall = () => { now = BASE_TIME + 32; };
    const { run, caseId } = createTargetRun(successful, QUERY_MARKER, "COMPLETED", 20);
    scheduleTarget(successful, run.id);
    const result = await createTargetService(successful, successful.hybrid, () => now).execute({ runId: run.id, caseId, caseRevision: 1 });
    const latency = (successful.database.client.prepare("select elapsed_latency_ms as value from ai_eval_case_results where run_id=?").get(run.id) as { value: number }).value;
    assert.equal(result.status, "COMPLETED");
    assert.equal(latency, 10);
    assert.equal(Number.isSafeInteger(latency), true);
    const scored = successful.evalRuns.completeRun(successful.evalRuns.beginScoring(run.id, BASE_TIME + 40).id, BASE_TIME + 41);
    assert.equal(scored.report.gates.find((gate) => gate.gateKey === "MAX_LATENCY_MS")?.verdict, "PASS");
  } finally { successful.close(); }

  const blocked = await createTargetFixture();
  try {
    const source = blocked.sources.getById(blocked.sourceId)!;
    blocked.sources.appendRevision({ id: source.id, expectedRevision: source.currentRevision, content: { key: source.key, subjectKey: source.subjectKey, sourceType: source.sourceType, displayName: source.displayName, language: source.language, edition: source.edition, authorityName: source.authorityName, authorityType: source.authorityType, trustTier: source.trustTier, rightsStatus: "RESTRICTED", rightsBasis: null, licenseName: source.licenseName, attribution: source.attribution, rightsNotes: source.rightsNotes, sourceUrl: source.sourceUrl, sourceAssetId: source.sourceAssetId, enabled: source.enabled, preparationMethod: source.preparationMethod, producerKey: source.producerKey, producerRevision: source.producerRevision }, actor: blocked.owner, now: BASE_TIME + 23 });
    let now = BASE_TIME + 22;
    const retrieval = { retrieve: async (request: AIHybridRetrievalRequest) => { const pack = await blocked.hybrid.retrieve(request); now = BASE_TIME + 32; return pack; }, assertEvidencePackCurrent: (pack: Parameters<HybridRetrievalService["assertEvidencePackCurrent"]>[0]) => blocked.hybrid.assertEvidencePackCurrent(pack) };
    const { run, caseId } = createTargetRun(blocked, QUERY_MARKER, "BLOCKED", 5);
    scheduleTarget(blocked, run.id);
    const result = await createTargetService(blocked, retrieval, () => now).execute({ runId: run.id, caseId, caseRevision: 1 });
    assert.equal(result.status, "BLOCKED");
    assert.equal((blocked.database.client.prepare("select elapsed_latency_ms as value from ai_eval_case_results where run_id=?").get(run.id) as { value: number }).value, 10);
    assert.equal(blocked.generation.calls, 0);
    const scored = blocked.evalRuns.completeRun(blocked.evalRuns.beginScoring(run.id, BASE_TIME + 40).id, BASE_TIME + 41);
    assert.equal(scored.report.gates.find((gate) => gate.gateKey === "MAX_LATENCY_MS")?.verdict, "BLOCKED");
  } finally { blocked.close(); }

  const failed = await createTargetFixture();
  try {
    let now = BASE_TIME + 22;
    failed.generation.failure = "UNAVAILABLE";
    failed.generation.onCall = () => { now = BASE_TIME + 32; };
    const { run, caseId } = createTargetRun(failed, QUERY_MARKER, "FAILED", 20);
    scheduleTarget(failed, run.id);
    const result = await createTargetService(failed, failed.hybrid, () => now).execute({ runId: run.id, caseId, caseRevision: 1 });
    assert.equal(result.status, "FAILED");
    assert.equal((failed.database.client.prepare("select elapsed_latency_ms as value from ai_eval_case_results where run_id=?").get(run.id) as { value: number }).value, 10);
  } finally { failed.close(); }

  const cancelled = await createTargetFixture();
  try {
    let now = BASE_TIME + 22;
    cancelled.generation.waitForAbort = true;
    cancelled.generation.onCall = () => { now = BASE_TIME + 32; };
    const { run, caseId } = createTargetRun(cancelled, QUERY_MARKER, "CANCELLED");
    scheduleTarget(cancelled, run.id);
    const controller = new AbortController();
    const pending = createTargetService(cancelled, cancelled.hybrid, () => now).execute({ runId: run.id, caseId, caseRevision: 1, signal: controller.signal });
    await cancelled.generation.started;
    controller.abort();
    const result = await pending;
    assert.equal(result.status, "CANCELLED");
    assert.equal((cancelled.database.client.prepare("select elapsed_latency_ms as value from ai_eval_case_results where run_id=?").get(run.id) as { value: number }).value, 10);
  } finally { cancelled.close(); }

  const overflow = await createTargetFixture();
  try {
    let now = BASE_TIME + 22;
    overflow.generation.onCall = () => { now = BASE_TIME + 8_640_000_000_100; };
    const { run, caseId } = createTargetRun(overflow);
    scheduleTarget(overflow, run.id);
    const result = await createTargetService(overflow, overflow.hybrid, () => now).execute({ runId: run.id, caseId, caseRevision: 1 });
    assert.equal(result.status, "FAILED");
    assert.equal((overflow.database.client.prepare("select safe_failure_code, elapsed_latency_ms from ai_eval_case_executions join ai_eval_case_results on ai_eval_case_results.run_id=(select run_id from ai_eval_case_executions where id=?) where ai_eval_case_executions.id=?").get(result.executionId, result.executionId) as { safe_failure_code: string; elapsed_latency_ms: number | null }).safe_failure_code, "EVAL_TARGET_LATENCY_INVALID");
    assert.equal((overflow.database.client.prepare("select elapsed_latency_ms from ai_eval_case_results where run_id=?").get(run.id) as { elapsed_latency_ms: number | null }).elapsed_latency_ms, null);
    assert.equal(overflow.generation.calls, 1);
  } finally { overflow.close(); }
});

test("M9B1 rejects an embedding-space Model revision change before any Provider", async () => {
  const f = await createTargetFixture();
  try {
    const { run, caseId } = createTargetRun(f);
    scheduleTarget(f, run.id);
    const models = new SQLiteAIModelConfigRepository(f.database);
    const model = models.getById(f.embeddingModelId)!;
    models.update({ id: model.id, expectedRevision: model.revision, actor: f.owner, now: BASE_TIME + 23, content: { key: model.key, displayName: "Changed embedding space", providerConfigId: model.providerConfigId, providerModelId: model.providerModelId, capability: model.capability, adapterKey: model.adapterKey, enabled: model.enabled, contextWindowTokens: model.contextWindowTokens, maxOutputTokens: model.maxOutputTokens, embeddingDimensions: model.embeddingDimensions, supportsStreaming: model.supportsStreaming, supportsReasoning: model.supportsReasoning, supportsStructuredOutput: model.supportsStructuredOutput } });
    const result = await createTargetService(f).execute({ runId: run.id, caseId, caseRevision: 1 });
    assert.equal(result.status, "FAILED");
    assert.equal((f.database.client.prepare("select safe_failure_code from ai_eval_case_executions where id=?").get(result.executionId) as { safe_failure_code: string }).safe_failure_code, "EVAL_CANDIDATE_STALE");
    assert.equal(f.embedding.calls, 0);
    assert.equal(f.reranker.calls, 0);
    assert.equal(f.generation.calls, 0);
  } finally { f.close(); }
});

test("M9B1 treats transient rate/concurrency admission denials as retryable infrastructure state", async () => {
  const rate = await createTargetFixture({ evalRateLimit: { maxRequests: 1, maxConcurrentRequests: 100 } });
  try {
    createEvalDummyAdmission(rate);
    const { run, caseId } = createTargetRun(rate, QUERY_MARKER, "COMPLETED", 1_000);
    scheduleTarget(rate, run.id);
    let now = BASE_TIME + 22;
    rate.generation.onCall = () => { now = BASE_TIME + 61_100; };
    const target = createTargetService(rate, rate.hybrid, () => now, new AIBudgetAdmissionService(rate.database, { clock: () => now }));
    const denied = await target.execute({ runId: run.id, caseId, caseRevision: 1 });
    assert.equal(denied.status, "PENDING");
    assert.equal(Number((rate.database.client.prepare("select count(*) as count from ai_eval_case_results where run_id=?").get(run.id) as { count: number }).count), 0);
    assert.equal((rate.database.client.prepare("select status from ai_cost_operations where id=?").get(denied.costOperationId) as { status: string }).status, "OPEN");
    assert.throws(() => rate.database.client.prepare("update ai_eval_case_executions set admission_attempt=99 where id=?").run(denied.executionId), /admission attempt|retry/i);
    assert.throws(() => rate.database.client.prepare("update ai_eval_case_executions set admission_attempt=0 where id=?").run(denied.executionId), /admission attempt|retry/i);
    assert.throws(() => rate.database.client.prepare("update ai_eval_case_executions set started_at=? where id=?").run(BASE_TIME + 23, denied.executionId), /identity|immutable/i);
    now = BASE_TIME + 61_000;
    const retried = await target.execute({ runId: run.id, caseId, caseRevision: 1 });
    assert.equal(retried.status, "COMPLETED");
    assert.equal(rate.generation.calls, 1);
    assert.equal(Number((rate.database.client.prepare("select count(*) as count from ai_cost_operations where eval_run_id=?").get(run.id) as { count: number }).count), 1);
    assert.equal(Number((rate.database.client.prepare("select count(*) as count from ai_eval_case_results where run_id=?").get(run.id) as { count: number }).count), 1);
    assert.equal((rate.database.client.prepare("select admission_attempt from ai_eval_case_executions where id=?").get(retried.executionId) as { admission_attempt: number }).admission_attempt, 1);
    assert.equal((rate.database.client.prepare("select safe_failure_code, started_at from ai_eval_case_executions where id=?").get(retried.executionId) as { safe_failure_code: string | null; started_at: number }).safe_failure_code, null);
    assert.equal((rate.database.client.prepare("select elapsed_latency_ms from ai_eval_case_results where run_id=?").get(run.id) as { elapsed_latency_ms: number }).elapsed_latency_ms, 100);
    assert.equal(rate.evalRuns.completeRun(rate.evalRuns.beginScoring(run.id, BASE_TIME + 62_000).id, BASE_TIME + 62_001).report.gates.find((gate) => gate.gateKey === "MAX_LATENCY_MS")?.verdict, "PASS");
  } finally { rate.close(); }

  const concurrency = await createTargetFixture({ evalRateLimit: { maxRequests: 100, maxConcurrentRequests: 1 } });
  try {
    const dummyOperationId = createEvalDummyAdmission(concurrency);
    const dummyReservation = concurrency.admission.getReservationByOperationId(dummyOperationId)!;
    const { run, caseId } = createTargetRun(concurrency, QUERY_MARKER, "COMPLETED", 1_000);
    scheduleTarget(concurrency, run.id);
    let now = BASE_TIME + 22;
    concurrency.generation.onCall = () => { now = BASE_TIME + 131; };
    const target = createTargetService(concurrency, concurrency.hybrid, () => now, new AIBudgetAdmissionService(concurrency.database, { clock: () => now }));
    const denied = await target.execute({ runId: run.id, caseId, caseRevision: 1 });
    assert.equal(denied.status, "PENDING");
    assert.equal(Number((concurrency.database.client.prepare("select count(*) as count from ai_eval_case_results where run_id=?").get(run.id) as { count: number }).count), 0);
    concurrency.admission.releaseBeforeExecution(dummyReservation.id, BASE_TIME + 30);
    now = BASE_TIME + 31;
    const retried = await target.execute({ runId: run.id, caseId, caseRevision: 1 });
    assert.equal(retried.status, "COMPLETED");
    assert.equal(concurrency.generation.calls, 1);
    assert.equal(Number((concurrency.database.client.prepare("select count(*) as count from ai_eval_case_results where run_id=?").get(run.id) as { count: number }).count), 1);
    assert.equal((concurrency.database.client.prepare("select safe_failure_code from ai_eval_case_executions where id=?").get(retried.executionId) as { safe_failure_code: string | null }).safe_failure_code, null);
    assert.equal((concurrency.database.client.prepare("select elapsed_latency_ms from ai_eval_case_results where run_id=?").get(run.id) as { elapsed_latency_ms: number }).elapsed_latency_ms, 100);
    assert.equal(concurrency.evalRuns.completeRun(concurrency.evalRuns.beginScoring(run.id, BASE_TIME + 32_000).id, BASE_TIME + 32_001).report.gates.find((gate) => gate.gateKey === "MAX_LATENCY_MS")?.verdict, "PASS");
  } finally { concurrency.close(); }
});

test("M9B1 transaction-only Conversation creation helper fails closed outside a transaction", async () => {
  const f = await createTargetFixture();
  try {
    const principal = { principalRef: `eval-target-${uuidv7().replace(/-/gu, "")}`, status: "ACTIVE" as const };
    const conversationId = uuidv7();
    assert.throws(() => f.conversations.createConversationInTransaction(principal, { conversationId, subjectKey: "biology", createdAt: BASE_TIME + 22 }), /transaction/i);
    const conversation = f.database.client.transaction(() => f.conversations.createConversationInTransaction(principal, { conversationId, subjectKey: "biology", createdAt: BASE_TIME + 22 }))();
    assert.equal(conversation.id, conversationId);
    f.conversations.deleteConversation(principal, conversationId);
  } finally { f.close(); }
});
