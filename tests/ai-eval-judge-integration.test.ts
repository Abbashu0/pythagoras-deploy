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
import { AIContextService } from "../src/server/ai/context";
import {
  AIBillingUsageNormalizerRegistry,
  AICostAccountingService,
  AICostCalculator,
  AIRateCardResolver,
  SQLiteAIAccountingRepository,
  SQLiteAIRateCardModelRevisionRepository,
  SQLiteAIRateCardRepository,
} from "../src/server/ai/economics";
import type {
  EmbeddingProviderAdapter,
  EmbeddingProviderRequest,
  EmbeddingProviderResult,
  GenerationProviderAdapter,
  GenerationProviderRequest,
  NormalizedProviderUsage,
  ProviderAdapterExecutionContext,
  ProviderGenerationStreamEvent,
} from "../src/server/ai/gateway";
import { AIProviderGateway, ProviderAdapterRegistry } from "../src/server/ai/gateway";
import {
  AIEmbeddingProjectionHealthService,
  AIEmbeddingProjectionService,
  createAIEmbeddingJobHandler,
  createSQLiteAIEmbeddingCostEstimator,
  SQLiteAIEmbeddingProjectionRepository,
  SQLiteAIVectorIndexAdapter,
} from "../src/server/ai/embedding";
import {
  AIEvalRunService,
  AIEvalTargetExecutionService,
  AIEvalTargetOrchestrator,
  createAIEvalTargetExecutionJobHandler,
  AI_EVAL_GRADER_KEYS,
  AI_EVAL_EXECUTION_CONFIG_RESOURCE_TYPE,
  AI_EVAL_CASE_RESOURCE_TYPE,
  AI_EVAL_SUITE_RESOURCE_TYPE,
  AI_EVAL_JUDGE_CONFIG_RESOURCE_TYPE,
  AI_EVAL_JUDGE_PROTOCOL_KEY,
  AI_EVAL_JUDGE_PROTOCOL_REVISION,
  AIEvalJudgeExecutionService,
  SQLiteAIEvalExecutionConfigRepository,
  SQLiteAIEvalJudgeConfigRepository,
  SQLiteAIEvalJudgeExecutionRepository,
  SQLiteAIEvalRunRepository,
  normalizeAIEvalCandidateSnapshot,
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
const QUERY_MARKER = "TOP_SECRET_M9B2_TARGET_QUERY_77";
const EVIDENCE_MARKER = "PRIVATE_EVIDENCE_M9B2_33";
const TARGET_OUTPUT_MARKER = "SECRET_TARGET_RAW_TEXT_44";
const JUDGE_RATIONALE_MARKER = "SECRET_JUDGE_RATIONALE_TEXT_55";

const usage = (inputTokens: number, outputTokens: number): NormalizedProviderUsage => ({
  inputTokens,
  outputTokens,
  reasoningTokens: 0,
  cacheHitInputTokens: 0,
  cacheMissInputTokens: 0,
});
const billable = (value: NormalizedProviderUsage) => ({
  standardInputTokens: value.inputTokens,
  cacheHitInputTokens: value.cacheHitInputTokens,
  cacheMissInputTokens: value.cacheMissInputTokens,
  outputTokens: value.outputTokens,
  reasoningTokens: value.reasoningTokens,
  requestUnits: 1,
});

class TargetGenerationAdapter implements GenerationProviderAdapter {
  readonly adapterKey = "test.m9b2.target-generation";
  readonly capability = "GENERATION" as const;
  calls = 0;
  requests: GenerationProviderRequest[] = [];
  deltas = [`safe answer with citation [E1] and ${TARGET_OUTPUT_MARKER}`];
  finalUsage = usage(25, 10);

  async *generate(request: GenerationProviderRequest, _context: ProviderAdapterExecutionContext): AsyncIterable<ProviderGenerationStreamEvent> {
    this.calls += 1;
    this.requests.push(request);
    yield { type: "STARTED", providerRequestId: `m9b2-target-gen-${this.calls}` };
    for (const delta of this.deltas) yield { type: "TEXT_DELTA", text: delta };
    yield { type: "USAGE", usage: this.finalUsage };
    yield { type: "COMPLETED", finishReason: "STOP", usage: this.finalUsage, providerRequestId: `m9b2-target-gen-${this.calls}` };
  }
}

class JudgeGenerationAdapter implements GenerationProviderAdapter {
  readonly adapterKey = "test.m9b2.judge-generation";
  readonly capability = "GENERATION" as const;
  calls = 0;
  requests: GenerationProviderRequest[] = [];
  scoresResponse: string | null = null;
  finalUsage = usage(80, 25);
  malformed = false;

  async *generate(request: GenerationProviderRequest, _context: ProviderAdapterExecutionContext): AsyncIterable<ProviderGenerationStreamEvent> {
    this.calls += 1;
    this.requests.push(request);
    yield { type: "STARTED", providerRequestId: `m9b2-judge-gen-${this.calls}` };
    const text = this.malformed
      ? "{ invalid json: true ..."
      : (this.scoresResponse ?? JSON.stringify({
          protocol: AI_EVAL_JUDGE_PROTOCOL_KEY,
          revision: AI_EVAL_JUDGE_PROTOCOL_REVISION,
          scores: [
            {
              dimension: "ARABIC_QUALITY",
              scoreUnits: 920_000,
              rubricBand: "EXCELLENT",
            },
            {
              dimension: "IRAQI_NATURALNESS",
              scoreUnits: 880_000,
              rubricBand: "PASS",
            },
          ],
        }));
    yield { type: "TEXT_DELTA", text };
    yield { type: "USAGE", usage: this.finalUsage };
    yield { type: "COMPLETED", finishReason: "STOP", usage: this.finalUsage, providerRequestId: `m9b2-judge-gen-${this.calls}` };
  }
}

class TargetEmbeddingAdapter implements EmbeddingProviderAdapter {
  readonly adapterKey = "test.m9b2.embedding";
  readonly capability = "EMBEDDING" as const;
  calls = 0;
  async embed(request: EmbeddingProviderRequest, _context: ProviderAdapterExecutionContext): Promise<EmbeddingProviderResult> {
    this.calls += 1;
    return { vectors: request.inputs.map(() => [1, 0, 0]), dimensions: 3, usage: usage(12, 0), providerRequestId: `m9b2-embedding-${this.calls}` };
  }
}

interface JudgeIntegrationFixture {
  root: string;
  database: ContentDatabase;
  owner: AdminActor;
  accounting: AICostAccountingService;
  accountingRepository: SQLiteAIAccountingRepository;
  admission: AIBudgetAdmissionService;
  gateway: AIProviderGateway;
  hybrid: HybridRetrievalService;
  sources: SQLiteAIKnowledgeSourceRepository;
  sourceId: string;
  packages: SQLiteAIKnowledgePackageRepository;
  packageId: string;
  documentId: string;
  conversations: AIConversationService;
  preflight: AITutorPreflightService;
  adapters: ProviderAdapterRegistry;
  targetGeneration: TargetGenerationAdapter;
  judgeGeneration: JudgeGenerationAdapter;
  embedding: TargetEmbeddingAdapter;
  tutorConfigId: string;
  retrievalConfigId: string;
  embeddingModelId: string;
  targetGenerationModelId: string;
  judgeModelId: string;
  providerId: string;
  m7bRevisionId: string;
  evalBudgetPolicyId: string;
  evalRateLimitPolicyId: string;
  executionConfigId: string;
  judgeConfigId: string;
  judgeConfigKey: string;
  evalRuns: AIEvalRunService;
  judgeService: AIEvalJudgeExecutionService;
  targetService: AIEvalTargetExecutionService;
  orchestrator: AIEvalTargetOrchestrator;
  now(): number;
  close(): void;
}

async function createJudgeIntegrationFixture(): Promise<JudgeIntegrationFixture> {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-m9b2-integration-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory: MIGRATIONS });
  createCanonicalContentRepository(database).bootstrap();

  const ownerUser = new SQLiteAdminIdentityRepository(database).createInitialOwner({
    id: uuidv7(),
    email: `owner-${uuidv7()}@m9b2.test`,
    displayName: "M9B2 Integration Owner",
    passwordHash: "fixture",
    createdAt: BASE_TIME,
  });
  const owner: AdminActor = { actorUserId: ownerUser.id, actorRole: "OWNER" };

  const secrets = createLocalAISecretStore(database, { masterKey: MASTER_KEY, clock: () => BASE_TIME });
  const secret = await secrets.create({ secret: `m9b2-secret-${uuidv7()}`, actor: { type: "ADMIN", actorUserId: owner.actorUserId } });

  const providers = new SQLiteAIProviderConfigRepository(database);
  const providerId = uuidv7();
  providers.create({
    id: providerId,
    content: {
      key: `m9b2-provider-${uuidv7()}`,
      displayName: "M9B2 Provider",
      baseUrl: "https://provider.example/v1",
      credentialRef: secret.credentialRef,
      enabled: true,
      retentionPolicy: "UNKNOWN",
      trainingPolicy: "UNKNOWN",
      zdrSupported: false,
      zdrRequired: false,
    },
    actor: owner,
    now: BASE_TIME - 100,
  });

  const models = new SQLiteAIModelConfigRepository(database);
  const targetGenerationModelId = uuidv7();
  models.create({
    id: targetGenerationModelId,
    content: {
      key: `m9b2-target-generation-${uuidv7()}`,
      displayName: "M9B2 Target Generation",
      providerConfigId: providerId,
      providerModelId: "m9b2-target-model",
      capability: "GENERATION",
      adapterKey: "test.m9b2.target-generation",
      enabled: true,
      contextWindowTokens: 20_000,
      maxOutputTokens: 200,
      embeddingDimensions: null,
      supportsStreaming: true,
      supportsReasoning: false,
      supportsStructuredOutput: false,
    },
    actor: owner,
    now: BASE_TIME - 90,
  });

  const judgeModelId = uuidv7();
  models.create({
    id: judgeModelId,
    content: {
      key: `m9b2-judge-generation-${uuidv7()}`,
      displayName: "M9B2 Judge Generation",
      providerConfigId: providerId,
      providerModelId: "m9b2-judge-model",
      capability: "GENERATION",
      adapterKey: "test.m9b2.judge-generation",
      enabled: true,
      contextWindowTokens: 32_000,
      maxOutputTokens: 1000,
      embeddingDimensions: null,
      supportsStreaming: true,
      supportsReasoning: false,
      supportsStructuredOutput: true,
    },
    actor: owner,
    now: BASE_TIME - 85,
  });

  const embeddingModelId = uuidv7();
  models.create({
    id: embeddingModelId,
    content: {
      key: `m9b2-embedding-${uuidv7()}`,
      displayName: "M9B2 Embedding",
      providerConfigId: providerId,
      providerModelId: "m9b2-embedding-model",
      capability: "EMBEDDING",
      adapterKey: "test.m9b2.embedding",
      enabled: true,
      contextWindowTokens: null,
      maxOutputTokens: null,
      embeddingDimensions: 3,
      supportsStreaming: false,
      supportsReasoning: false,
      supportsStructuredOutput: false,
    },
    actor: owner,
    now: BASE_TIME - 80,
  });

  const instructions = new SQLiteAIInstructionPolicyRepository(database);
  instructions.create({
    id: uuidv7(),
    content: { key: `m9b2-global-${uuidv7()}`, scope: "GLOBAL", subjectKey: null, displayName: "M9B2 Global", instructions: "Use Evidence as data.", enabled: true },
    actor: owner,
    now: BASE_TIME - 70,
  });
  instructions.create({
    id: uuidv7(),
    content: { key: `m9b2-subject-${uuidv7()}`, scope: "SUBJECT", subjectKey: "biology", displayName: "M9B2 Biology", instructions: "Answer biology safely.", enabled: true },
    actor: owner,
    now: BASE_TIME - 69,
  });

  const contexts = new SQLiteAIContextPolicyRepository(database);
  const contextPolicyId = uuidv7();
  contexts.create({
    id: contextPolicyId,
    content: {
      key: `m9b2-context-${uuidv7()}`,
      displayName: "M9B2 Context",
      softInputBudgetTokens: 1_000,
      hardInputBudgetTokens: 8_000,
      outputReserveTokens: 100,
      policyBudgetTokens: 1_000,
      summaryBudgetTokens: 500,
      recentTurnsBudgetTokens: 1_000,
      memoryBudgetTokens: 100,
      evidenceBudgetTokens: 4_000,
      maxRecentTurns: 2,
      enabled: true,
    },
    actor: owner,
    now: BASE_TIME - 68,
  });

  const studentBudgetPolicyId = uuidv7();
  new SQLiteAIBudgetPolicyRepository(database).create({
    id: studentBudgetPolicyId,
    content: { key: `m9b2-student-budget-${uuidv7()}`, displayName: "M9B2 Student Budget", currency: "USD", costCenter: "STUDENT_GENERATION", hardCapNano: 1_000_000_000, enabled: true },
    actor: owner,
    now: BASE_TIME - 67,
  });

  const indexingBudgetPolicyId = uuidv7();
  new SQLiteAIBudgetPolicyRepository(database).create({
    id: indexingBudgetPolicyId,
    content: { key: `m9b2-index-budget-${uuidv7()}`, displayName: "M9B2 Index Budget", currency: "USD", costCenter: "KNOWLEDGE_INDEXING", hardCapNano: 1_000_000_000, enabled: true },
    actor: owner,
    now: BASE_TIME - 66,
  });

  const evalBudgetPolicyId = uuidv7();
  new SQLiteAIBudgetPolicyRepository(database).create({
    id: evalBudgetPolicyId,
    content: { key: `m9b2-eval-budget-${uuidv7()}`, displayName: "M9B2 Eval Budget", currency: "USD", costCenter: "EVALS", hardCapNano: 1_000_000_000, enabled: true },
    actor: owner,
    now: BASE_TIME - 65,
  });

  const evalRateLimitPolicyId = uuidv7();
  new SQLiteAIRateLimitPolicyRepository(database).create({
    id: evalRateLimitPolicyId,
    content: { key: `m9b2-eval-rate-${uuidv7()}`, displayName: "M9B2 Eval Rate", windowMs: 60_000, maxRequests: 100, maxConcurrentRequests: 100, enabled: true },
    actor: owner,
    now: BASE_TIME - 64,
  });

  const tutorRateLimitPolicyId = uuidv7();
  new SQLiteAIRateLimitPolicyRepository(database).create({
    id: tutorRateLimitPolicyId,
    content: { key: `m9b2-tutor-rate-${uuidv7()}`, displayName: "M9B2 Tutor Rate", windowMs: 60_000, maxRequests: 100, maxConcurrentRequests: 100, enabled: true },
    actor: owner,
    now: BASE_TIME - 63,
  });

  const rateCards = new SQLiteAIRateCardRepository(database);
  const rateLines = [
    { component: "STANDARD_INPUT" as const, unit: "PER_MILLION_TOKENS" as const, amountNano: 1_000_000 },
    { component: "OUTPUT" as const, unit: "PER_MILLION_TOKENS" as const, amountNano: 2_000_000 },
    { component: "REQUEST" as const, unit: "PER_REQUEST" as const, amountNano: 100 },
  ];
  rateCards.create({
    id: uuidv7(),
    content: {
      key: `m9b2-embedding-rate-${uuidv7()}`,
      displayName: "Embedding Rate",
      modelConfigId: embeddingModelId,
      modelConfigRevision: 1,
      currency: "USD",
      billingUsageNormalizerKey: "m9b2.embedding",
      effectiveFrom: 0,
      effectiveTo: null,
      enabled: true,
      priceLines: [{ component: "STANDARD_INPUT", unit: "PER_MILLION_TOKENS", amountNano: 1_000_000 }, { component: "REQUEST", unit: "PER_REQUEST", amountNano: 100 }],
      timeBands: [],
    },
    actor: owner,
    now: BASE_TIME - 60,
  });
  rateCards.create({
    id: uuidv7(),
    content: {
      key: `m9b2-target-generation-rate-${uuidv7()}`,
      displayName: "Target Generation Rate",
      modelConfigId: targetGenerationModelId,
      modelConfigRevision: 1,
      currency: "USD",
      billingUsageNormalizerKey: "m9b2.target-generation",
      effectiveFrom: 0,
      effectiveTo: null,
      enabled: true,
      priceLines: rateLines,
      timeBands: [],
    },
    actor: owner,
    now: BASE_TIME - 59,
  });
  rateCards.create({
    id: uuidv7(),
    content: {
      key: `m9b2-judge-generation-rate-${uuidv7()}`,
      displayName: "Judge Generation Rate",
      modelConfigId: judgeModelId,
      modelConfigRevision: 1,
      currency: "USD",
      billingUsageNormalizerKey: "m9b2.judge-generation",
      effectiveFrom: 0,
      effectiveTo: null,
      enabled: true,
      priceLines: rateLines,
      timeBands: [],
    },
    actor: owner,
    now: BASE_TIME - 58,
  });

  const accountingRepository = new SQLiteAIAccountingRepository(database);
  const rateCardResolver = new AIRateCardResolver(rateCards, new SQLiteAIRateCardModelRevisionRepository(database));
  const accounting = new AICostAccountingService({
    rateCardResolver,
    billingNormalizers: new AIBillingUsageNormalizerRegistry([
      { key: "m9b2.embedding", normalize: billable },
      { key: "m9b2.target-generation", normalize: billable },
      { key: "m9b2.judge-generation", normalize: billable },
    ]),
    costCalculator: new AICostCalculator(),
    accounting: accountingRepository,
  });

  const targetGeneration = new TargetGenerationAdapter();
  const judgeGeneration = new JudgeGenerationAdapter();
  const embedding = new TargetEmbeddingAdapter();
  const adapters = new ProviderAdapterRegistry([targetGeneration, judgeGeneration, embedding]);

  const gateway = new AIProviderGateway({ providerConfigs: providers, modelConfigs: models, secrets, adapters }, { clock: () => BASE_TIME + 10 });

  const changes = createChangeManagementService(database);
  const publish = (resourceType: string, resourceId: string, desired: unknown) => {
    let change = changes.createChangeSet({ title: "M9B2 publication", initialItem: { resourceType, resourceId, expectedRevision: 0, operation: "CREATE", desired } }, owner);
    change = changes.submit(change.changeSet.id, change.changeSet.revision, owner);
    change = changes.approve(change.changeSet.id, change.changeSet.revision, owner);
    changes.publish(change.changeSet.id, change.changeSet.revision, owner);
  };

  const retrievalConfigId = uuidv7();
  publish(AI_RETRIEVAL_CONFIG_RESOURCE_TYPE, retrievalConfigId, {
    key: `m9b2-retrieval-${uuidv7()}`,
    subjectKey: "biology",
    displayName: "M9B2 Retrieval",
    enabled: true,
    embeddingModelConfigId: embeddingModelId,
    rerankModelConfigId: null,
    lexicalCandidateLimit: 10,
    semanticCandidateLimit: 10,
    fusionCandidateLimit: 10,
    rerankCandidateLimit: 10,
    evidenceItemLimit: 5,
    rrfConstant: 60,
    lexicalWeightUnits: 1,
    semanticWeightUnits: 1,
    minimumFusedScoreUnits: 0,
    minimumEvidenceItemCount: 1,
    maximumEvidencePackBytes: 32_768,
    maxEvidenceChunksPerSourceItem: 5,
    allowedTrustTiers: ["PYTHAGORAS_APPROVED"],
    semanticFailureBehavior: "FAIL_RETRIEVAL",
    rerankerFailureBehavior: "USE_FUSION",
  });

  const sources = new SQLiteAIKnowledgeSourceRepository(database);
  const sourceId = uuidv7();
  const source: AIKnowledgeSourceContent = {
    key: `m9b2-source-${uuidv7()}`,
    subjectKey: "biology",
    sourceType: "PYTHAGORAS_APPROVED",
    displayName: "M9B2 Source",
    language: "ar",
    edition: "test",
    authorityName: "Pythagoras",
    authorityType: "TEST",
    trustTier: "PYTHAGORAS_APPROVED",
    rightsStatus: "CLEARED",
    rightsBasis: "OWNED",
    licenseName: null,
    attribution: "M9B2",
    rightsNotes: null,
    sourceUrl: null,
    sourceAssetId: null,
    enabled: true,
    preparationMethod: "DETERMINISTIC",
    producerKey: "m9b2",
    producerRevision: "1",
  };
  sources.create({ id: sourceId, content: source, actor: owner, now: BASE_TIME - 50 });

  const packages = new SQLiteAIKnowledgePackageRepository(database);
  const packageId = uuidv7();
  const documentId = uuidv7();
  const richContent: CanonicalRichDocument = {
    type: "doc",
    version: 1,
    blocks: [{ id: uuidv7(), type: "paragraph", spans: [{ text: `${EVIDENCE_MARKER} cellular biology knowledge.` }] }],
  };
  packages.create({
    id: packageId,
    content: {
      key: `m9b2-package-${uuidv7()}`,
      subjectKey: "biology",
      title: "M9B2 Knowledge",
      language: "ar",
      contentRevision: 1,
      sourceId,
      sourceRevision: 1,
      artifactRef: "b".repeat(64),
      artifactSha256: "b".repeat(64),
      artifactByteSize: 1,
    },
    documents: [{ packageRevisionId: "pending", documentId, displayOrder: 1, title: "Evidence", provenance: { pageStart: 1, section: "cells" }, content: richContent }],
    assets: [],
    actor: owner,
    now: BASE_TIME - 49,
  });

  new AIChunkProjectionBuilder(database).build({ originKind: "KNOWLEDGE_PACKAGE", originId: packageId, subjectKey: "biology" });
  const m7aRepository = new SQLiteAIRetrievalProjectionRepository(database);
  const m7aSet = m7aRepository.getSet({ originKind: "KNOWLEDGE_PACKAGE", originId: packageId, subjectKey: "biology", strategyKey: "structured-rich-v1", normalizerKey: "retrieval-text-v1" });
  assert.ok(m7aSet);

  const embeddingRepository = new SQLiteAIEmbeddingProjectionRepository(database);
  const embeddingHealth = new AIEmbeddingProjectionHealthService(database, { projections: embeddingRepository, models });
  const vectorIndex = new SQLiteAIVectorIndexAdapter(database, { isRevisionSearchable: (revision) => embeddingHealth.isRevisionSearchable(revision) });
  const jobHandlers = new AIJobHandlerRegistry();
  const indexingAdmission = new AIBudgetAdmissionService(database, { clock: () => BASE_TIME + 1 });
  const embeddingService = new AIEmbeddingProjectionService(database, {
    m7aProjections: m7aRepository,
    m7aHealth: new AIRetrievalProjectionHealthService(database),
    projections: embeddingRepository,
    vectorIndex,
    models,
    providers,
    secrets,
    adapters,
    gateway,
    jobs: new AIJobQueueService(database, jobHandlers, { clock: () => BASE_TIME + 1 }),
    admission: indexingAdmission,
    accounting,
    costEstimator: createSQLiteAIEmbeddingCostEstimator(rateCardResolver),
    clock: () => BASE_TIME + 1,
  });
  const indexingJobs = new AIJobQueueService(database, jobHandlers, { clock: () => BASE_TIME + 1 });
  jobHandlers.register(createAIEmbeddingJobHandler(embeddingService));
  const worker = new AIWorker({ jobs: indexingJobs, handlers: jobHandlers, workerId: `m9b2-indexer-${uuidv7()}`, clock: () => BASE_TIME + 1 });
  const embeddingBuild = embeddingService.startBuild({
    subjectKey: "biology",
    chunkProjectionSetId: m7aSet.id,
    modelConfigId: embeddingModelId,
    budgetPolicyId: indexingBudgetPolicyId,
    budgetPolicyRevision: 1,
    rateLimitPolicyId: tutorRateLimitPolicyId,
    rateLimitPolicyRevision: 1,
    budgetPeriod: { startAt: 0, endAt: BASE_TIME + 100_000 },
    batchSize: 50,
  });
  await worker.runOnce(BASE_TIME + 1);
  assert.equal(embeddingBuild.status, "BUILDING");
  embedding.calls = 0;

  const retrievals = new SQLiteAIRetrievalConfigRepository(database);
  const hybrid = new HybridRetrievalService({
    database,
    configs: retrievals,
    models,
    providers,
    m7aHealth: new AIRetrievalProjectionHealthService(database),
    lexical: new SQLiteAILexicalRetrievalAdapter(database),
    embeddings: embeddingRepository,
    embeddingHealth,
    vectors: vectorIndex,
    sources,
    gateway,
    accounting,
    admission: indexingAdmission,
  });

  const tutorConfigId = uuidv7();
  publish("ai.tutor-config", tutorConfigId, {
    key: `m9b2-tutor-${uuidv7()}`,
    subjectKey: "biology",
    displayName: "M9B2 Tutor",
    enabled: true,
    generationModelConfigId: targetGenerationModelId,
    contextPolicyId,
    retrievalConfigId,
    budgetPolicyId: studentBudgetPolicyId,
    rateLimitPolicyId: tutorRateLimitPolicyId,
    maxOutputTokens: 60,
  });

  const executionConfigId = uuidv7();
  publish(AI_EVAL_EXECUTION_CONFIG_RESOURCE_TYPE, executionConfigId, {
    key: `m9b2-execution-${uuidv7()}`,
    subjectKey: "biology",
    displayName: "M9B2 Target Execution",
    enabled: true,
    budgetPolicyId: evalBudgetPolicyId,
    budgetPolicyRevision: 1,
    rateLimitPolicyId: evalRateLimitPolicyId,
    rateLimitPolicyRevision: 1,
    protocolKey: "eval-target-v1",
    protocolRevision: 1,
    targetTimeoutMs: 30_000,
    maxConcurrency: 2,
    cleanupProtocolKey: "synthetic-c4-cleanup-v1",
    cleanupProtocolRevision: 1,
  });

  // Publish Supplementary LLM Judge Config
  const judgeConfigId = uuidv7();
  const judgeConfigKey = `judge-bio-qualitative-${uuidv7().slice(0, 8)}`;
  publish(AI_EVAL_JUDGE_CONFIG_RESOURCE_TYPE, judgeConfigId, {
    key: judgeConfigKey,
    subjectKey: "biology",
    displayName: "M9B2 Qualitative Judge",
    enabled: true,
    modelConfigId: judgeModelId,
    modelConfigRevision: 1,
    providerConfigId: providerId,
    providerConfigRevision: 1,
    budgetPolicyId: evalBudgetPolicyId,
    budgetPolicyRevision: 1,
    rateLimitPolicyId: evalRateLimitPolicyId,
    rateLimitPolicyRevision: 1,
    protocolKey: AI_EVAL_JUDGE_PROTOCOL_KEY,
    protocolRevision: AI_EVAL_JUDGE_PROTOCOL_REVISION,
    timeoutMs: 30_000,
    maxOutputTokens: 1000,
  });

  let currentTime = BASE_TIME + 20;
  const now = () => ++currentTime;

  const admission = new AIBudgetAdmissionService(database, { clock: now });
  const conversations = new AIConversationService(database, { clock: now });
  const preflight = new AITutorPreflightService(database, {
    conversations: new SQLiteAIConversationRepository(database),
    context: new AIContextService(database, { clock: now }),
    models,
    providers,
    retrievalConfigs: retrievals,
    contextPolicies: contexts,
    adapters,
    clock: now,
  });

  const runsRepo = new SQLiteAIEvalRunRepository(database);
  const judgeConfigsRepo = new SQLiteAIEvalJudgeConfigRepository(database);
  const judgeExecutionsRepo = new SQLiteAIEvalJudgeExecutionRepository(database);

  const judgeService = new AIEvalJudgeExecutionService({
    database,
    runs: runsRepo,
    judgeConfigs: judgeConfigsRepo,
    judgeExecutions: judgeExecutionsRepo,
    gateway,
    accounting,
    admission,
    models,
    providers,
    rateCards: rateCardResolver,
    budgetPeriodResolver: { resolve: () => ({ startAt: 0, endAt: BASE_TIME + 100_000 }) },
    clock: now,
  });

  const targetService = new AIEvalTargetExecutionService({
    database,
    conversations,
    preflight,
    planner: new AITutorGenerationPlanner(),
    retrieval: hybrid,
    gateway,
    accounting,
    admission,
    estimator: { estimatorKey: "m9b2.integration", estimate: (_text: string) => 1 },
    budgetPeriodResolver: { resolve: () => ({ startAt: 0, endAt: BASE_TIME + 100_000 }) },
    clock: now,
    judgeExecution: judgeService,
  });

  const evalRuns = new AIEvalRunService(database, { runs: runsRepo, judgeExecutions: judgeExecutionsRepo, accounting: accountingRepository });
  const targetJobHandlers = new AIJobHandlerRegistry();
  targetJobHandlers.register(createAIEvalTargetExecutionJobHandler(targetService));
  const targetJobs = new AIJobQueueService(database, targetJobHandlers, { clock: now });
  const orchestrator = new AIEvalTargetOrchestrator({
    database,
    jobs: targetJobs,
    evalRuns,
    clock: now,
  });

  return {
    root,
    database,
    owner,
    accounting,
    accountingRepository,
    admission,
    gateway,
    hybrid,
    sources,
    sourceId,
    packages,
    packageId,
    documentId,
    conversations,
    preflight,
    adapters,
    targetGeneration,
    judgeGeneration,
    embedding,
    tutorConfigId,
    retrievalConfigId,
    embeddingModelId,
    targetGenerationModelId,
    judgeModelId,
    providerId,
    m7bRevisionId: embeddingBuild.embeddingProjectionRevisionId,
    evalBudgetPolicyId,
    evalRateLimitPolicyId,
    executionConfigId,
    judgeConfigId,
    judgeConfigKey,
    evalRuns,
    judgeService,
    targetService,
    orchestrator,
    now,
    close() {
      database.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function candidateSnapshotForFixture(f: JudgeIntegrationFixture) {
  const tutor = new SQLiteAITutorConfigRepository(f.database).getById(f.tutorConfigId)!;
  const instructions = new SQLiteAIInstructionPolicyRepository(f.database);
  const global = instructions.getByScope("GLOBAL", null)!;
  const subject = instructions.getByScope("SUBJECT", "biology")!;
  const context = new SQLiteAIContextPolicyRepository(f.database).getById(tutor.contextPolicyId)!;
  const retrieval = new SQLiteAIRetrievalConfigRepository(f.database).getById(f.retrievalConfigId)!;
  const model = new SQLiteAIModelConfigRepository(f.database).getById(f.targetGenerationModelId)!;
  const provider = new SQLiteAIProviderConfigRepository(f.database).getById(f.providerId)!;
  return normalizeAIEvalCandidateSnapshot({
    tutorConfig: { id: tutor.id, revision: tutor.currentRevision },
    globalPolicy: { id: global.id, revision: global.currentRevision },
    subjectPolicy: { id: subject.id, revision: subject.currentRevision },
    contextPolicy: { id: context.id, revision: context.currentRevision },
    retrievalConfig: { id: retrieval.id, revision: retrieval.currentRevision },
    generationModel: { id: model.id, revision: model.revision },
    generationProvider: { id: provider.id, revision: provider.revision },
    embeddingSpace: { projectionRevisionId: f.m7bRevisionId, modelConfigId: f.embeddingModelId, modelConfigRevision: 1 },
    rerank: null,
    groundingProtocol: { key: "evidence-grounded-v1", revision: 1 },
    citationProtocol: { key: "evidence-ref-v1", revision: 1 },
  });
}

function publishResource(f: JudgeIntegrationFixture, resourceType: string, resourceId: string, desired: unknown, expectedRevision = 0): void {
  const changes = createChangeManagementService(f.database);
  let change = changes.createChangeSet({
    title: `M9B2 publication of ${resourceType}`,
    initialItem: { resourceType, resourceId, expectedRevision, operation: expectedRevision === 0 ? "CREATE" : "UPDATE", desired },
  }, f.owner);
  change = changes.submit(change.changeSet.id, change.changeSet.revision, f.owner);
  change = changes.approve(change.changeSet.id, change.changeSet.revision, f.owner);
  changes.publish(change.changeSet.id, change.changeSet.revision, f.owner);
}

function createSuiteWithJudge(f: JudgeIntegrationFixture, caseId: string, judgeKey = f.judgeConfigKey, judgeRevision = 1) {
  const suiteId = uuidv7();
  publishResource(f, AI_EVAL_SUITE_RESOURCE_TYPE, suiteId, {
    key: `m9b2.suite.${uuidv7()}`,
    subjectKey: "biology",
    displayName: "M9B2 Qualitative Eval Suite",
    enabled: true,
    caseManifest: [{ ordinal: 1, caseId, caseRevision: 1 }],
    requiredDimensions: [
      { dimension: "SECURITY", mode: "DETERMINISTICALLY_GRADED" },
      { dimension: "CORRECTNESS", mode: "DETERMINISTICALLY_GRADED" },
      { dimension: "ARABIC_QUALITY", mode: "JUDGE_REQUIRED" },
      { dimension: "IRAQI_NATURALNESS", mode: "JUDGE_REQUIRED" },
    ],
    graderConfigs: [
      { graderKey: AI_EVAL_GRADER_KEYS.SECURITY_LEAK, graderRevision: 1, dimension: "SECURITY", required: true },
      { graderKey: AI_EVAL_GRADER_KEYS.LITERAL_OUTPUT, graderRevision: 1, dimension: "CORRECTNESS", required: true },
    ],
    gateConfig: {
      minimumScores: [
        { dimension: "ARABIC_QUALITY", scoreUnits: 800_000 },
        { dimension: "IRAQI_NATURALNESS", scoreUnits: 800_000 },
      ],
      maximumCostNano: null,
      maximumLatencyMs: 1_000,
      requireSecurityPass: true,
    },
    permittedRegressionDeltas: [],
    baselineMode: "OPTIONAL",
    supplementaryJudgeConfig: { referenceKey: judgeKey, revision: judgeRevision },
  });
  return suiteId;
}

function createCase(f: JudgeIntegrationFixture, inputText = QUERY_MARKER, requiredOutputLiterals = ["safe"]) {
  const caseId = uuidv7();
  publishResource(f, AI_EVAL_CASE_RESOURCE_TYPE, caseId, {
    key: `m9b2.case.${uuidv7()}`,
    subjectKey: "biology",
    displayName: "M9B2 Qualitative Test Case",
    description: null,
    inputText,
    origin: "SYNTHETIC",
    privacyClass: "SYNTHETIC_PUBLIC_SAFE",
    deidentificationProof: null,
    expectedStatus: "COMPLETED",
    allowedFinishReasons: ["STOP"],
    requiredOutputLiterals,
    forbiddenOutputLiterals: [],
    requiredEvidenceOrigins: [],
    forbiddenEvidenceOrigins: [],
    requiredCitationLabels: ["[E1]"],
    minimumEvidenceItemCount: 1,
    securityLeakageMarkers: ["TOP_SECRET_LEAK"],
    maximumOutputBytes: 2_048,
    sourceRevisionReferences: [],
    enabled: true,
  });
  return caseId;
}

test("M9B2 End-to-End: Target execution handoff to LLM Judge, distinct EVALS accounting, strict scoring finalization, and latency purity", async () => {
  const f = await createJudgeIntegrationFixture();
  try {
    const caseId = createCase(f);
    const suiteId = createSuiteWithJudge(f, caseId);
    const candidateSnapshot = candidateSnapshotForFixture(f);

    const run = f.evalRuns.createRun({
      id: uuidv7(),
      suiteId,
      suiteRevision: 1,
      candidateSnapshot,
      createdAt: BASE_TIME + 20,
    });

    const executionConfig = new SQLiteAIEvalExecutionConfigRepository(f.database).getById(f.executionConfigId)!;
    f.orchestrator.scheduleRun({
      runId: run.id,
      executionConfigId: f.executionConfigId,
      executionConfigRevision: executionConfig.currentRevision,
      createdBy: f.owner.actorUserId,
      now: BASE_TIME + 21,
    });

    // Execute target + runtime-only judge handoff
    const result = await f.targetService.execute({ runId: run.id, caseId, caseRevision: 1 });
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.providerInvoked, true);

    // Both Target and Judge adapters were invoked
    assert.equal(f.targetGeneration.calls, 1);
    assert.equal(f.judgeGeneration.calls, 1);

    // Verify Judge request received in-memory only (evidence + candidate output)
    const judgeRequest = f.judgeGeneration.requests[0];
    assert.ok(judgeRequest);
    assert.ok(judgeRequest.instructions);
    assert.equal(judgeRequest.instructions.includes("Protocol: eval-judge-v1"), true);
    assert.equal(judgeRequest.messages.length, 1);
    assert.equal(judgeRequest.messages[0].role, "user");
    assert.equal(judgeRequest.messages[0].content.includes(TARGET_OUTPUT_MARKER), true);
    assert.equal(judgeRequest.messages[0].content.includes("ARABIC_QUALITY"), true);
    assert.equal(judgeRequest.messages[0].content.includes("IRAQI_NATURALNESS"), true);

    // Inspect Cost Operations: exactly TWO operations under EVALS cost center
    const evalOps = f.database.client
      .prepare("select id, cost_center, eval_run_id, subject_key, opaque_principal_ref, conversation_id, response_id, job_id from ai_cost_operations where eval_run_id=? order by started_at asc")
      .all(run.id) as Array<Record<string, unknown>>;

    assert.equal(evalOps.length, 2);
    // Op 1: Target Operation
    assert.equal(evalOps[0].id, result.costOperationId);
    assert.equal(evalOps[0].cost_center, "EVALS");
    assert.equal(evalOps[0].opaque_principal_ref, null);
    assert.equal(evalOps[0].conversation_id, null);
    assert.equal(evalOps[0].response_id, null);
    assert.equal(evalOps[0].job_id, null);

    // Op 2: Judge Operation
    const judgeExecutions = new SQLiteAIEvalJudgeExecutionRepository(f.database).listForRun(run.id);
    assert.equal(judgeExecutions.length, 1);
    assert.equal(judgeExecutions[0].status, "COMPLETED");
    assert.equal(judgeExecutions[0].providerInvoked, true);
    assert.equal(evalOps[1].id, judgeExecutions[0].judgeCostOperationId);
    assert.equal(evalOps[1].cost_center, "EVALS");
    assert.equal(evalOps[1].opaque_principal_ref, null);
    assert.equal(evalOps[1].conversation_id, null);
    assert.equal(evalOps[1].response_id, null);
    assert.equal(evalOps[1].job_id, null);

    // Inspect Judge Results inserted into ai_eval_judge_results
    const judgeResults = new SQLiteAIEvalRunRepository(f.database).listJudgeResultsForRun(run.id);
    assert.equal(judgeResults.length, 2);
    const arabicResult = judgeResults.find((r) => r.dimension === "ARABIC_QUALITY")!;
    const iraqiResult = judgeResults.find((r) => r.dimension === "IRAQI_NATURALNESS")!;
    assert.ok(arabicResult);
    assert.ok(iraqiResult);
    assert.equal(arabicResult.scoreUnits, 920_000);
    assert.equal(arabicResult.rubricBand, "EXCELLENT");
    assert.equal(iraqiResult.scoreUnits, 880_000);
    assert.equal(iraqiResult.rubricBand, "PASS");

    // Coverage check passes
    assert.equal(f.orchestrator.getCoverage(run.id).complete, true);
    assert.equal(f.orchestrator.getJudgeCoverage(run.id).complete, true);
    assert.doesNotThrow(() => f.orchestrator.assertCanBeginScoring(run.id));

    // Finalize and score Run
    const scored = f.orchestrator.finalizeAndScoreRun(run.id, BASE_TIME + 40);
    assert.equal(scored.run.status, "COMPLETED");
    assert.ok(scored.report);

    // Check aggregates
    const arabicDim = scored.report.aggregates.find((a) => a.dimension === "ARABIC_QUALITY")!;
    const iraqiDim = scored.report.aggregates.find((a) => a.dimension === "IRAQI_NATURALNESS")!;
    assert.ok(arabicDim);
    assert.ok(iraqiDim);
    assert.equal(arabicDim.scoreUnits, 920_000);
    assert.equal(arabicDim.passedCaseCount, 1);
    assert.equal(arabicDim.failedCaseCount, 0);
    assert.equal(iraqiDim.scoreUnits, 880_000);
    assert.equal(iraqiDim.passedCaseCount, 1);
    assert.equal(iraqiDim.failedCaseCount, 0);

    // Check accounting basis
    const basis = f.evalRuns.resolveRunAccountingBasis(run);
    assert.ok(basis);
    assert.equal(basis.operations.length, 2);
    const opIds = basis.operations.map((o) => o.operationId);
    assert.ok(opIds.includes(result.costOperationId!));
    assert.ok(opIds.includes(judgeExecutions[0].judgeCostOperationId!));

    // Latency purity: MAX_LATENCY_MS gate evaluates ONLY candidate latency (not judge latency)
    const latencyGate = scored.report.gates.find((g) => g.gateKey === "MAX_LATENCY_MS")!;
    assert.ok(latencyGate);
    assert.equal(latencyGate.verdict, "PASS");
  } finally {
    f.close();
  }
});

test("M9B2 Baseline comparability: matching judge identity passes, divergent judge config revision returns BASELINE_NOT_COMPARABLE", async () => {
  const f = await createJudgeIntegrationFixture();
  try {
    const caseId = createCase(f);
    const suiteId = createSuiteWithJudge(f, caseId);
    const candidateSnapshot = candidateSnapshotForFixture(f);

    // Run 1: Baseline run
    const run1 = f.evalRuns.createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot, createdAt: f.now() });
    const executionConfig = new SQLiteAIEvalExecutionConfigRepository(f.database).getById(f.executionConfigId)!;
    f.orchestrator.scheduleRun({ runId: run1.id, executionConfigId: f.executionConfigId, executionConfigRevision: executionConfig.currentRevision, createdBy: f.owner.actorUserId, now: f.now() });
    await f.targetService.execute({ runId: run1.id, caseId, caseRevision: 1 });
    const scored1 = f.orchestrator.finalizeAndScoreRun(run1.id, f.now());
    assert.equal(scored1.run.status, "COMPLETED");

    // Run 2: Candidate run with SAME judge configuration, pinned to Baseline Run 1
    const run2 = f.evalRuns.createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot, baselineRunId: run1.id, createdAt: f.now() });
    f.orchestrator.scheduleRun({ runId: run2.id, executionConfigId: f.executionConfigId, executionConfigRevision: executionConfig.currentRevision, createdBy: f.owner.actorUserId, now: f.now() });
    await f.targetService.execute({ runId: run2.id, caseId, caseRevision: 1 });
    const scored2 = f.orchestrator.finalizeAndScoreRun(run2.id, f.now());

    // Compare Run 2 against Baseline Run 1 -> identical judge identity matches
    assert.ok(scored2.baseline);
    assert.equal(scored2.baseline.comparable, true);
    assert.equal(scored2.baseline.recommendation, "PASS_RECOMMENDED");

    // Now update Judge Config to revision 2 (e.g. timeout change)
    publishResource(
      f,
      AI_EVAL_JUDGE_CONFIG_RESOURCE_TYPE,
      f.judgeConfigId,
      {
        key: f.judgeConfigKey,
        subjectKey: "biology",
        displayName: "M9B2 Qualitative Judge Revision 2",
        enabled: true,
        modelConfigId: f.judgeModelId,
        modelConfigRevision: 1,
        providerConfigId: f.providerId,
        providerConfigRevision: 1,
        budgetPolicyId: f.evalBudgetPolicyId,
        budgetPolicyRevision: 1,
        rateLimitPolicyId: f.evalRateLimitPolicyId,
        rateLimitPolicyRevision: 1,
        protocolKey: AI_EVAL_JUDGE_PROTOCOL_KEY,
        protocolRevision: AI_EVAL_JUDGE_PROTOCOL_REVISION,
        timeoutMs: 45_000,
        maxOutputTokens: 1000,
      },
      1,
    );

    // Create Suite revision 2 referencing Judge Config revision 2
    const suiteId2 = createSuiteWithJudge(f, caseId, f.judgeConfigKey, 2);

    // Run 3: Candidate run with Judge Config Revision 2
    const run3 = f.evalRuns.createRun({ id: uuidv7(), suiteId: suiteId2, suiteRevision: 1, candidateSnapshot, baselineRunId: run1.id, createdAt: f.now() });
    f.orchestrator.scheduleRun({ runId: run3.id, executionConfigId: f.executionConfigId, executionConfigRevision: executionConfig.currentRevision, createdBy: f.owner.actorUserId, now: f.now() });
    await f.targetService.execute({ runId: run3.id, caseId, caseRevision: 1 });
    const scored3 = f.orchestrator.finalizeAndScoreRun(run3.id, f.now());

    // Compare Run 3 against Baseline Run 1 -> MUST be rejected because judge identity differs
    assert.ok(scored3.baseline);
    assert.equal(scored3.baseline.comparable, false);
    assert.equal(scored3.baseline.safeReasonCode, "BASELINE_NOT_COMPARABLE");
  } finally {
    f.close();
  }
});

test("M9B2 Deterministic Blocker: deterministic security violation blocks the run even with perfect qualitative Judge scores", async () => {
  const f = await createJudgeIntegrationFixture();
  try {
    // Target outputs a security leak marker
    f.targetGeneration.deltas = ["safe answer [E1] TOP_SECRET_LEAK"];
    // Judge awards 1,000,000 (maximum)
    f.judgeGeneration.scoresResponse = JSON.stringify({
      protocol: AI_EVAL_JUDGE_PROTOCOL_KEY,
      revision: AI_EVAL_JUDGE_PROTOCOL_REVISION,
      scores: [
        { dimension: "ARABIC_QUALITY", scoreUnits: 1_000_000, rubricBand: "EXCELLENT" },
        { dimension: "IRAQI_NATURALNESS", scoreUnits: 1_000_000, rubricBand: "EXCELLENT" },
      ],
    });

    const caseId = createCase(f);
    const suiteId = createSuiteWithJudge(f, caseId);
    const candidateSnapshot = candidateSnapshotForFixture(f);

    const run = f.evalRuns.createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot, createdAt: BASE_TIME + 10 });
    const executionConfig = new SQLiteAIEvalExecutionConfigRepository(f.database).getById(f.executionConfigId)!;
    f.orchestrator.scheduleRun({ runId: run.id, executionConfigId: f.executionConfigId, executionConfigRevision: executionConfig.currentRevision, createdBy: f.owner.actorUserId, now: BASE_TIME + 11 });

    await f.targetService.execute({ runId: run.id, caseId, caseRevision: 1 });
    const scored = f.orchestrator.finalizeAndScoreRun(run.id, BASE_TIME + 30);

    // Scored run has BLOCKED gate verdict due to deterministic security leak
    assert.equal(scored.run.status, "COMPLETED");
    const securityGate = scored.report.gates.find((g) => g.gateKey === "SECURITY_REQUIRED")!;
    assert.ok(securityGate);
    assert.equal(securityGate.verdict, "BLOCKED");

    // Overall recommendation fails even though qualitative dimensions are 1,000,000
    assert.equal(scored.report.recommendation, "BLOCKED");
  } finally {
    f.close();
  }
});

test("M9B2 Judge Failure Isolation: malformed judge response leaves target results intact but blocks scoring finalization", async () => {
  const f = await createJudgeIntegrationFixture();
  try {
    f.judgeGeneration.malformed = true;

    const caseId = createCase(f);
    const suiteId = createSuiteWithJudge(f, caseId);
    const candidateSnapshot = candidateSnapshotForFixture(f);

    const run = f.evalRuns.createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot, createdAt: BASE_TIME + 10 });
    const executionConfig = new SQLiteAIEvalExecutionConfigRepository(f.database).getById(f.executionConfigId)!;
    f.orchestrator.scheduleRun({ runId: run.id, executionConfigId: f.executionConfigId, executionConfigRevision: executionConfig.currentRevision, createdBy: f.owner.actorUserId, now: BASE_TIME + 11 });

    const result = await f.targetService.execute({ runId: run.id, caseId, caseRevision: 1 });

    // Target execution itself succeeded
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.providerInvoked, true);

    // Target Case Result was recorded in DB
    const targetResults = f.database.client.prepare("select * from ai_eval_case_results where run_id=?").all(run.id) as Array<Record<string, unknown>>;
    assert.equal(targetResults.length, 1);
    assert.equal(targetResults[0].observed_status, "COMPLETED");

    // Judge Execution failed safely
    const judgeExecutions = new SQLiteAIEvalJudgeExecutionRepository(f.database).listForRun(run.id);
    assert.equal(judgeExecutions.length, 1);
    assert.equal(judgeExecutions[0].status, "FAILED");
    assert.equal(judgeExecutions[0].safeFailureCode, "EVAL_JUDGE_OUTPUT_MALFORMED");

    // No Judge results fabricated
    const judgeResults = new SQLiteAIEvalRunRepository(f.database).listJudgeResultsForRun(run.id);
    assert.equal(judgeResults.length, 0);

    // Target coverage is complete, but Judge coverage is INCOMPLETE
    assert.equal(f.orchestrator.getCoverage(run.id).complete, true);
    assert.equal(f.orchestrator.getJudgeCoverage(run.id).complete, false);

    // Scoring cannot begin!
    assert.throws(
      () => f.orchestrator.assertCanBeginScoring(run.id),
      /judge evaluation is not complete/i,
    );
  } finally {
    f.close();
  }
});

test("M9B2 Privacy Markers: raw target output, evidence text, and judge rationale are NEVER persisted to DB", async () => {
  const f = await createJudgeIntegrationFixture();
  try {
    const caseId = createCase(f);
    const suiteId = createSuiteWithJudge(f, caseId);
    const candidateSnapshot = candidateSnapshotForFixture(f);

    const run = f.evalRuns.createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot, createdAt: BASE_TIME + 10 });
    const executionConfig = new SQLiteAIEvalExecutionConfigRepository(f.database).getById(f.executionConfigId)!;
    f.orchestrator.scheduleRun({ runId: run.id, executionConfigId: f.executionConfigId, executionConfigRevision: executionConfig.currentRevision, createdBy: f.owner.actorUserId, now: BASE_TIME + 11 });

    await f.targetService.execute({ runId: run.id, caseId, caseRevision: 1 });
    f.orchestrator.finalizeAndScoreRun(run.id, BASE_TIME + 40);

    // Query all eval execution and result tables for private markers
    const evalTables = [
      "ai_eval_case_executions",
      "ai_eval_case_results",
      "ai_eval_judge_executions",
      "ai_eval_judge_results",
    ];

    const secretMarkers = [
      TARGET_OUTPUT_MARKER,
      EVIDENCE_MARKER,
      QUERY_MARKER,
    ];

    for (const table of evalTables) {
      const rows = f.database.client.prepare(`select * from ${table}`).all() as Array<Record<string, unknown>>;
      const tableJson = JSON.stringify(rows);
      for (const marker of secretMarkers) {
        assert.equal(
          tableJson.includes(marker),
          false,
          `Marker "${marker}" was leaked into table "${table}"!`,
        );
      }
    }
  } finally {
    f.close();
  }
});
