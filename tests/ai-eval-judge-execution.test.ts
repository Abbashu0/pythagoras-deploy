import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../src/server/admin-auth";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import { AIBudgetAdmissionService } from "../src/server/ai/admission";
import { SQLiteAIBudgetPolicyRepository } from "../src/server/ai/budget";
import { SQLiteAIProviderConfigRepository } from "../src/server/ai/configuration";
import {
  AICostAccountingService,
  AICostCalculator,
  SQLiteAIAccountingRepository,
  SQLiteAIRateCardRepository,
  type AIRateCardResolver,
} from "../src/server/ai/economics";
import { SQLiteAIModelConfigRepository } from "../src/server/ai/model-registry";
import { SQLiteAIRateLimitPolicyRepository } from "../src/server/ai/rate-limits";
import { AIProviderGatewayError, type AIProviderAttemptTrace, type AIProviderGateway } from "../src/server/ai/gateway";
import {
  AI_TUTOR_CITATION_PROTOCOL_KEY,
  AI_TUTOR_CITATION_PROTOCOL_REVISION,
  AI_TUTOR_GROUNDING_PROTOCOL_KEY,
  AI_TUTOR_GROUNDING_PROTOCOL_REVISION,
} from "../src/server/ai/tutor";
import { AIJobError } from "../src/server/ai/operations/jobs";
import {
  AIEvalError,
  AIEvalJudgeExecutionService,
  AI_EVAL_CASE_RESOURCE_TYPE,
  AI_EVAL_JUDGE_CONFIG_RESOURCE_TYPE,
  AI_EVAL_JUDGE_PROTOCOL_KEY,
  AI_EVAL_JUDGE_PROTOCOL_REVISION,
  AI_EVAL_SCORE_SCALE,
  AI_EVAL_SUITE_RESOURCE_TYPE,
  fingerprintAIEvalCandidate,
  fingerprintAIEvalManifest,
  SQLiteAIEvalCaseRepository,
  SQLiteAIEvalJudgeConfigRepository,
  SQLiteAIEvalJudgeExecutionRepository,
  SQLiteAIEvalRunRepository,
  SQLiteAIEvalSuiteRepository,
  normalizeAIEvalCandidateSnapshot,
  type AIEvalCaseContent,
  type AIEvalCaseResult,
  type AIEvalCaseRevision,
  type AIEvalDimension,
  type AIEvalJudgeConfigContent,
  type AIEvalRun,
  type AIEvalSuiteContent,
  type AIEvalSuiteRevision,
} from "../src/server/ai/evals";
import { createCanonicalContentRepository } from "../src/server/canonical-content";
import { createChangeManagementService } from "../src/server/change-management";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";
import type { AIEvidencePack } from "../src/server/ai/retrieval";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const BASE_TIME = 1_905_000_000_000;

interface FakeGatewayCall {
  request: unknown;
  expectedIdentity: unknown;
}

interface Fixture {
  root: string;
  database: ContentDatabase;
  owner: AdminActor;
  targetModelId: string;
  judgeModelId: string;
  providerId: string;
  budgetPolicyId: string;
  rateLimitPolicyId: string;
  accounting: AICostAccountingService;
  admission: AIBudgetAdmissionService;
  judgeConfigs: SQLiteAIEvalJudgeConfigRepository;
  judgeExecutions: SQLiteAIEvalJudgeExecutionRepository;
  runs: SQLiteAIEvalRunRepository;
  changes: ReturnType<typeof createChangeManagementService>;
  rateCardResolver: AIRateCardResolver;
  close(): void;
}

function createFixture(): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-judge-exec-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  createCanonicalContentRepository(database).bootstrap();

  const identities = new SQLiteAdminIdentityRepository(database);
  const ownerUser = identities.createInitialOwner({
    id: uuidv7(),
    email: `owner-${uuidv7()}@judge-exec.test`,
    displayName: "Judge Execution Owner",
    passwordHash: "fixture",
    createdAt: BASE_TIME,
  });
  const owner: AdminActor = { actorUserId: ownerUser.id, actorRole: "OWNER" };

  const credentialRef = uuidv7();
  database.client
    .prepare("insert into ai_secret_refs (credential_ref, status, secret_version, created_at, updated_at, revision) values (?, 'ACTIVE', 1, ?, ?, 1)")
    .run(credentialRef, BASE_TIME, BASE_TIME);

  const providerId = uuidv7();
  new SQLiteAIProviderConfigRepository(database).create({
    id: providerId,
    content: {
      key: `prov-${providerId.slice(0, 8)}`,
      displayName: "Fake Provider",
      baseUrl: "https://fake.provider.test",
      enabled: true,
      credentialRef,
      retentionPolicy: "ZERO_RETENTION",
      trainingPolicy: "NOT_USED_FOR_TRAINING",
      zdrSupported: true,
      zdrRequired: false,
    },
    actor: owner,
    now: BASE_TIME,
  });

  const models = new SQLiteAIModelConfigRepository(database);
  const targetModelId = uuidv7();
  models.create({
    id: targetModelId,
    content: {
      key: `target-model-${targetModelId.slice(0, 8)}`,
      displayName: "Candidate Target Model",
      providerConfigId: providerId,
      providerModelId: "target-v1",
      capability: "GENERATION",
      adapterKey: "fake-target",
      enabled: true,
      contextWindowTokens: 8192,
      maxOutputTokens: 2048,
      embeddingDimensions: null,
      supportsStreaming: true,
      supportsReasoning: false,
      supportsStructuredOutput: true,
    },
    actor: owner,
    now: BASE_TIME,
  });

  const judgeModelId = uuidv7();
  models.create({
    id: judgeModelId,
    content: {
      key: `judge-model-${judgeModelId.slice(0, 8)}`,
      displayName: "Independent Judge Model",
      providerConfigId: providerId,
      providerModelId: "judge-v1",
      capability: "GENERATION",
      adapterKey: "fake-judge",
      enabled: true,
      contextWindowTokens: 16384,
      maxOutputTokens: 4096,
      embeddingDimensions: null,
      supportsStreaming: true,
      supportsReasoning: false,
      supportsStructuredOutput: true,
    },
    actor: owner,
    now: BASE_TIME,
  });

  const budgetPolicyId = uuidv7();
  new SQLiteAIBudgetPolicyRepository(database).create({
    id: budgetPolicyId,
    content: {
      key: `evals-bgt-${budgetPolicyId.slice(0, 8)}`,
      displayName: "EVALS Budget Policy",
      currency: "USD",
      costCenter: "EVALS",
      hardCapNano: 1_000_000_000,
      enabled: true,
    },
    actor: owner,
    now: BASE_TIME,
  });

  const rateLimitPolicyId = uuidv7();
  new SQLiteAIRateLimitPolicyRepository(database).create({
    id: rateLimitPolicyId,
    content: {
      key: `evals-rl-${rateLimitPolicyId.slice(0, 8)}`,
      displayName: "EVALS Rate Limit Policy",
      windowMs: 60_000,
      maxRequests: 1000,
      maxConcurrentRequests: 100,
      enabled: true,
    },
    actor: owner,
    now: BASE_TIME,
  });

  const rateCardRepo = new SQLiteAIRateCardRepository(database);
  const judgeRateCardId = uuidv7();
  const judgeRateCard = rateCardRepo.create({
    id: judgeRateCardId,
    content: {
      key: `judge-rate-card-${judgeRateCardId.slice(0, 8)}`,
      displayName: "Judge Rate Card",
      modelConfigId: judgeModelId,
      modelConfigRevision: 1,
      currency: "USD",
      billingUsageNormalizerKey: "default",
      effectiveFrom: 0,
      effectiveTo: null,
      enabled: true,
      priceLines: [
        { component: "STANDARD_INPUT", unit: "PER_MILLION_TOKENS", amountNano: 1_000 },
        { component: "CACHE_HIT_INPUT", unit: "PER_MILLION_TOKENS", amountNano: 500 },
        { component: "CACHE_MISS_INPUT", unit: "PER_MILLION_TOKENS", amountNano: 1_000 },
        { component: "OUTPUT", unit: "PER_MILLION_TOKENS", amountNano: 2_000 },
        { component: "REASONING", unit: "PER_MILLION_TOKENS", amountNano: 2_000 },
        { component: "REQUEST", unit: "PER_REQUEST", amountNano: 0 },
      ],
      timeBands: [],
    },
    actor: owner,
    now: BASE_TIME,
  });

  const targetRateCardId = uuidv7();
  const targetRateCard = rateCardRepo.create({
    id: targetRateCardId,
    content: {
      key: `target-rate-card-${targetRateCardId.slice(0, 8)}`,
      displayName: "Target Rate Card",
      modelConfigId: targetModelId,
      modelConfigRevision: 1,
      currency: "USD",
      billingUsageNormalizerKey: "default",
      effectiveFrom: 0,
      effectiveTo: null,
      enabled: true,
      priceLines: [
        { component: "STANDARD_INPUT", unit: "PER_MILLION_TOKENS", amountNano: 1_000 },
        { component: "CACHE_HIT_INPUT", unit: "PER_MILLION_TOKENS", amountNano: 500 },
        { component: "CACHE_MISS_INPUT", unit: "PER_MILLION_TOKENS", amountNano: 1_000 },
        { component: "OUTPUT", unit: "PER_MILLION_TOKENS", amountNano: 2_000 },
        { component: "REASONING", unit: "PER_MILLION_TOKENS", amountNano: 2_000 },
        { component: "REQUEST", unit: "PER_REQUEST", amountNano: 0 },
      ],
      timeBands: [],
    },
    actor: owner,
    now: BASE_TIME,
  });

  const rateCardResolver = {
    resolve: (input: { modelConfigId: string }) => {
      const card = input.modelConfigId === judgeModelId ? judgeRateCard : targetRateCard;
      return {
        rateCardId: card.rateCardId,
        rateCardRevision: card.revision,
        rateCardRevisionId: card.revisionId,
        modelConfigId: card.modelConfigId,
        modelConfigRevision: card.modelConfigRevision,
        currency: card.currency,
        billingUsageNormalizerKey: card.billingUsageNormalizerKey,
        effectiveFrom: card.effectiveFrom,
        effectiveTo: card.effectiveTo,
        pricingRuleId: card.revisionId,
        pricingRuleKind: "DEFAULT",
        timeZone: null,
        priceLines: card.priceLines,
      };
    },
  } as unknown as AIRateCardResolver;

  const accountingRepo = new SQLiteAIAccountingRepository(database);
  const accounting = new AICostAccountingService({
    rateCardResolver,
    billingNormalizers: {
      normalize: (_key, usage) => ({
        standardInputTokens: usage.inputTokens,
        cacheHitInputTokens: usage.cacheHitInputTokens,
        cacheMissInputTokens: usage.cacheMissInputTokens,
        outputTokens: usage.outputTokens,
        reasoningTokens: usage.reasoningTokens,
        requestUnits: 1,
      }),
    },
    costCalculator: new AICostCalculator(),
    accounting: accountingRepo,
  });
  const admission = new AIBudgetAdmissionService(database, { clock: () => BASE_TIME });

  return {
    root,
    database,
    owner,
    targetModelId,
    judgeModelId,
    providerId,
    budgetPolicyId,
    rateLimitPolicyId,
    accounting,
    admission,
    judgeConfigs: new SQLiteAIEvalJudgeConfigRepository(database),
    judgeExecutions: new SQLiteAIEvalJudgeExecutionRepository(database),
    runs: new SQLiteAIEvalRunRepository(database),
    changes: createChangeManagementService(database),
    rateCardResolver,
    close() {
      database.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function publishJudgeConfig(
  fixture: Fixture,
  overrides: Partial<AIEvalJudgeConfigContent> = {},
): { id: string; referenceKey: string; revision: number } {
  const id = uuidv7();
  const key = `eval-judge-${id}`;
  const content: AIEvalJudgeConfigContent = {
    key,
    subjectKey: "biology",
    displayName: "Biology Supplementary Judge",
    enabled: true,
    modelConfigId: fixture.judgeModelId,
    modelConfigRevision: 1,
    providerConfigId: fixture.providerId,
    providerConfigRevision: 1,
    budgetPolicyId: fixture.budgetPolicyId,
    budgetPolicyRevision: 1,
    rateLimitPolicyId: fixture.rateLimitPolicyId,
    rateLimitPolicyRevision: 1,
    protocolKey: AI_EVAL_JUDGE_PROTOCOL_KEY,
    protocolRevision: AI_EVAL_JUDGE_PROTOCOL_REVISION,
    timeoutMs: 15_000,
    maxOutputTokens: 2048,
    ...overrides,
  };

  let draft = fixture.changes.createChangeSet(
    {
      title: "Publish Judge Config",
      initialItem: {
        resourceType: AI_EVAL_JUDGE_CONFIG_RESOURCE_TYPE,
        resourceId: id,
        operation: "CREATE",
        expectedRevision: 0,
        desired: content,
      },
    },
    fixture.owner,
  );
  draft = fixture.changes.submit(draft.changeSet.id, draft.changeSet.revision, fixture.owner);
  draft = fixture.changes.approve(draft.changeSet.id, draft.changeSet.revision, fixture.owner);
  fixture.changes.publish(draft.changeSet.id, draft.changeSet.revision, fixture.owner);

  return { id, referenceKey: key, revision: 1 };
}

function setupCaseAndSuite(
  fixture: Fixture,
  judgeRef: { referenceKey: string; revision: number },
  options?: {
    requiredDimensions?: Array<{ dimension: AIEvalDimension; mode: "JUDGE_REQUIRED" | "DETERMINISTICALLY_GRADED" | "NOT_APPLICABLE" }>;
  },
): {
  caseId: string;
  caseRevision: AIEvalCaseRevision;
  suiteId: string;
  suite: AIEvalSuiteRevision;
} {
  const caseId = uuidv7();
  const caseContent: AIEvalCaseContent = {
    key: `case-${uuidv7()}`,
    subjectKey: "biology",
    displayName: "Biology Case",
    description: null,
    inputText: "ما هي وظيفة الميتوكوندريا في الخلية؟",
    origin: "SYNTHETIC",
    privacyClass: "SYNTHETIC_PUBLIC_SAFE",
    deidentificationProof: null,
    expectedStatus: "COMPLETED",
    allowedFinishReasons: ["STOP"],
    requiredOutputLiterals: [],
    forbiddenOutputLiterals: [],
    requiredEvidenceOrigins: [],
    forbiddenEvidenceOrigins: [],
    requiredCitationLabels: [],
    minimumEvidenceItemCount: 0,
    securityLeakageMarkers: [],
    maximumOutputBytes: 4096,
    sourceRevisionReferences: [],
    enabled: true,
  };

  let caseDraft = fixture.changes.createChangeSet(
    {
      title: "Publish Case",
      initialItem: {
        resourceType: AI_EVAL_CASE_RESOURCE_TYPE,
        resourceId: caseId,
        operation: "CREATE",
        expectedRevision: 0,
        desired: caseContent,
      },
    },
    fixture.owner,
  );
  caseDraft = fixture.changes.submit(caseDraft.changeSet.id, caseDraft.changeSet.revision, fixture.owner);
  caseDraft = fixture.changes.approve(caseDraft.changeSet.id, caseDraft.changeSet.revision, fixture.owner);
  fixture.changes.publish(caseDraft.changeSet.id, caseDraft.changeSet.revision, fixture.owner);

  const suiteId = uuidv7();
  const suiteContent: AIEvalSuiteContent = {
    key: `suite-${uuidv7()}`,
    subjectKey: "biology",
    displayName: "Biology Test Suite",
    enabled: true,
    caseManifest: [{ ordinal: 1, caseId, caseRevision: 1 }],
    requiredDimensions: options?.requiredDimensions ?? [{ dimension: "ARABIC_QUALITY", mode: "JUDGE_REQUIRED" }],
    graderConfigs: [],
    gateConfig: { minimumScores: [], maximumCostNano: null, maximumLatencyMs: null, requireSecurityPass: true },
    permittedRegressionDeltas: [],
    baselineMode: "OPTIONAL",
    supplementaryJudgeConfig: { referenceKey: judgeRef.referenceKey, revision: judgeRef.revision },
  };

  let suiteDraft = fixture.changes.createChangeSet(
    {
      title: "Publish Suite",
      initialItem: {
        resourceType: AI_EVAL_SUITE_RESOURCE_TYPE,
        resourceId: suiteId,
        operation: "CREATE",
        expectedRevision: 0,
        desired: suiteContent,
      },
    },
    fixture.owner,
  );
  suiteDraft = fixture.changes.submit(suiteDraft.changeSet.id, suiteDraft.changeSet.revision, fixture.owner);
  suiteDraft = fixture.changes.approve(suiteDraft.changeSet.id, suiteDraft.changeSet.revision, fixture.owner);
  fixture.changes.publish(suiteDraft.changeSet.id, suiteDraft.changeSet.revision, fixture.owner);

  const caseRev = new SQLiteAIEvalCaseRepository(fixture.database).getRevision(caseId, 1)!;
  const suiteRev = new SQLiteAIEvalSuiteRepository(fixture.database).getRevision(suiteId, 1)!;

  return {
    caseId,
    caseRevision: caseRev,
    suiteId,
    suite: suiteRev,
  };
}

function createFakeGateway(responseGenerator: () => {
  events: AsyncIterable<{ type: string; [key: string]: unknown }>;
  trace: Promise<readonly any[]>;
}): Pick<AIProviderGateway, "generate"> & { calls: FakeGatewayCall[] } {
  const calls: FakeGatewayCall[] = [];
  return {
    calls,
    generate(_plan, request, options) {
      calls.push({ request, expectedIdentity: options?.expectedIdentity });
      return responseGenerator() as any;
    },
  };
}

function buildMockAttemptTrace(f: Fixture, overrides: Partial<AIProviderAttemptTrace> = {}): AIProviderAttemptTrace {
  return {
    gatewayRequestId: uuidv7(),
    capability: "GENERATION",
    attemptIndex: 1,
    modelConfigId: f.judgeModelId,
    modelConfigRevision: 1,
    providerConfigId: f.providerId,
    providerConfigRevision: 1,
    adapterKey: "fake-judge",
    providerModelId: "judge-v1",
    startedAt: BASE_TIME + 10,
    completedAt: BASE_TIME + 50,
    latencyMs: 40,
    status: "SUCCEEDED",
    providerInvoked: true,
    ...overrides,
  };
}

function buildMockEvidencePack(): AIEvidencePack {
  return {
    evidencePackId: uuidv7(),
    requestId: uuidv7(),
    subjectKey: "biology",
    retrievalConfigId: uuidv7(),
    retrievalConfigRevision: 1,
    fusionAlgorithmKey: "rrf-v1",
    fusionAlgorithmRevision: 1,
    mode: "HYBRID",
    degraded: false,
    safeReason: null,
    embeddingModelConfigId: null,
    embeddingModelConfigRevision: null,
    embeddingProviderConfigId: null,
    embeddingProviderConfigRevision: null,
    rerankModelConfigId: null,
    rerankModelConfigRevision: null,
    rerankProviderConfigId: null,
    rerankProviderConfigRevision: null,
    candidateCounts: { lexical: 1, semantic: 1, fused: 1, reranked: 1, evidence: 1 },
    evidenceByteCount: 100,
    sufficient: true,
    status: "SUFFICIENT",
    items: [
      {
        sourceId: uuidv7(),
        sourceRevision: 1,
        sourceType: "TEXTBOOK",
        trustTier: "PYTHAGORAS_APPROVED",
        sourceItemId: uuidv7(),
        sourceItemOrder: 1,
        questionId: null,
        questionRevision: null,
        variantId: null,
        variantRevision: null,
        text: "الميتوكوندريا هي عضيات خلوية مسؤولة عن إنتاج الطاقة.",
        language: "ar",
        provenance: null,
        originMetadata: {},
        ordinal: 1,
        inclusionSignals: [],
        lexicalRank: 1,
        semanticRank: 1,
        cosineSimilarity: 0.95,
        fusionScoreUnits: 1000,
        retrievalSignals: ["BOTH"],
        rerankRank: 1,
        rerankScore: 0.98,
      },
    ],
    trace: {
      retrievalConfigId: uuidv7(),
      retrievalConfigRevision: 1,
      fusionAlgorithmKey: "rrf-v1",
      fusionAlgorithmRevision: 1,
      m7aProjectionRevisionIds: [],
      eligibleOriginIdentities: [],
      m7aProjectionRefs: [],
      m7bEmbeddingProjectionRevisionIds: [],
      embeddingModelConfigId: null,
      embeddingModelConfigRevision: null,
      embeddingProviderConfigId: null,
      embeddingProviderConfigRevision: null,
      rerankModelConfigId: null,
      rerankModelConfigRevision: null,
      rerankProviderConfigId: null,
      rerankProviderConfigRevision: null,
      latencyMs: 10,
      degraded: false,
      safeReason: null,
      candidateCounts: { lexical: 1, semantic: 1, fused: 1, reranked: 1, evidence: 1 },
      lexicalCandidates: [],
      semanticCandidates: [],
      fusedCandidates: [],
      rerankedCandidates: [],
      items: [],
    },
  } as unknown as AIEvidencePack;
}

test("Self-judge prevention: candidate model cannot be evaluated by the same model revision", async () => {
  const f = createFixture();
  try {
    // Judge config configured with targetModelId (attempting self-judging)
    const judgeRef = publishJudgeConfig(f, {
      modelConfigId: f.targetModelId,
      modelConfigRevision: 1,
    });

    const { caseId, caseRevision, suiteId, suite } = setupCaseAndSuite(f, judgeRef);

    const runId = uuidv7();
    const candidateSnapshot = normalizeAIEvalCandidateSnapshot({
      tutorConfig: { id: uuidv7(), revision: 1 },
      globalPolicy: { id: uuidv7(), revision: 1 },
      subjectPolicy: { id: uuidv7(), revision: 1 },
      contextPolicy: { id: uuidv7(), revision: 1 },
      retrievalConfig: { id: uuidv7(), revision: 1 },
      generationModel: { id: f.targetModelId, revision: 1 },
      generationProvider: { id: f.providerId, revision: 1 },
      embeddingSpace: null,
      rerank: null,
      groundingProtocol: { key: AI_TUTOR_GROUNDING_PROTOCOL_KEY, revision: AI_TUTOR_GROUNDING_PROTOCOL_REVISION },
      citationProtocol: { key: AI_TUTOR_CITATION_PROTOCOL_KEY, revision: AI_TUTOR_CITATION_PROTOCOL_REVISION },
    });

    const manifest = [{ caseId, caseRevision: 1, ordinal: 1 }];
    f.runs.create({
      id: runId,
      suiteId,
      suiteRevision: 1,
      manifestFingerprint: fingerprintAIEvalManifest(suite.caseManifest),
      candidateSnapshot,
      candidateFingerprint: fingerprintAIEvalCandidate(candidateSnapshot),
      baselineRunId: null,
      createdAt: BASE_TIME,
    });
    const run = f.runs.transition({
      id: runId,
      expectedStatus: "CREATED",
      status: "RUNNING",
      startedAt: BASE_TIME,
      updatedAt: BASE_TIME,
    });

    const caseResult: AIEvalCaseResult = {
      id: uuidv7(),
      runId,
      caseId,
      caseRevision: 1,
      ordinal: 1,
      observedSubjectKey: "biology",
      observedStatus: "COMPLETED",
      finishReason: "STOP",
      outputSha256: "0".repeat(64),
      outputByteSize: 50,
      evidence: [],
      retrievalStatus: "SUFFICIENT",
      elapsedLatencyMs: 120,
      costOperationId: null,
      privacyClass: "SYNTHETIC_PUBLIC_SAFE",
      createdAt: BASE_TIME + 1,
    };
    f.runs.insertCaseResult(caseResult);

    let providerCalls = 0;
    const fakeGateway = createFakeGateway(() => {
      providerCalls++;
      throw new Error("Provider should not have been called");
    });

    const judgeService = new AIEvalJudgeExecutionService({
      database: f.database,
      gateway: fakeGateway,
      accounting: f.accounting,
      admission: f.admission,
      rateCards: f.rateCardResolver,
      clock: () => BASE_TIME + 10,
    });

    const execution = await judgeService.executeJudgeForCase({
      run,
      suite,
      caseRevision,
      caseResult,
      outputText: "Target answer",
      evidencePack: buildMockEvidencePack(),
      finishReason: "STOP",
    });

    assert.ok(execution);
    assert.equal(execution.status, "FAILED");
    assert.equal(execution.safeFailureCode, "EVAL_JUDGE_SELF_JUDGE_FORBIDDEN");
    assert.equal(execution.providerInvoked, false);
    assert.equal(providerCalls, 0);
  } finally {
    f.close();
  }
});

test("Judge execution creates a separate EVALS Cost Operation without student identities", async () => {
  const f = createFixture();
  try {
    const judgeRef = publishJudgeConfig(f);
    const { caseId, caseRevision, suiteId, suite } = setupCaseAndSuite(f, judgeRef);

    const runId = uuidv7();
    const candidateSnapshot = normalizeAIEvalCandidateSnapshot({
      tutorConfig: { id: uuidv7(), revision: 1 },
      globalPolicy: { id: uuidv7(), revision: 1 },
      subjectPolicy: { id: uuidv7(), revision: 1 },
      contextPolicy: { id: uuidv7(), revision: 1 },
      retrievalConfig: { id: uuidv7(), revision: 1 },
      generationModel: { id: f.targetModelId, revision: 1 },
      generationProvider: { id: f.providerId, revision: 1 },
      embeddingSpace: null,
      rerank: null,
      groundingProtocol: { key: AI_TUTOR_GROUNDING_PROTOCOL_KEY, revision: AI_TUTOR_GROUNDING_PROTOCOL_REVISION },
      citationProtocol: { key: AI_TUTOR_CITATION_PROTOCOL_KEY, revision: AI_TUTOR_CITATION_PROTOCOL_REVISION },
    });

    const manifest = [{ caseId, caseRevision: 1, ordinal: 1 }];
    f.runs.create({
      id: runId,
      suiteId,
      suiteRevision: 1,
      manifestFingerprint: fingerprintAIEvalManifest(suite.caseManifest),
      candidateSnapshot,
      candidateFingerprint: fingerprintAIEvalCandidate(candidateSnapshot),
      baselineRunId: null,
      createdAt: BASE_TIME,
    });
    const run = f.runs.transition({
      id: runId,
      expectedStatus: "CREATED",
      status: "RUNNING",
      startedAt: BASE_TIME,
      updatedAt: BASE_TIME,
    });

    const caseResult: AIEvalCaseResult = {
      id: uuidv7(),
      runId,
      caseId,
      caseRevision: 1,
      ordinal: 1,
      observedSubjectKey: "biology",
      observedStatus: "COMPLETED",
      finishReason: "STOP",
      outputSha256: "0".repeat(64),
      outputByteSize: 50,
      evidence: [],
      retrievalStatus: "SUFFICIENT",
      elapsedLatencyMs: 120,
      costOperationId: null,
      privacyClass: "SYNTHETIC_PUBLIC_SAFE",
      createdAt: BASE_TIME + 1,
    };
    f.runs.insertCaseResult(caseResult);

    const fakeResponseJson = JSON.stringify({
      protocol: AI_EVAL_JUDGE_PROTOCOL_KEY,
      revision: AI_EVAL_JUDGE_PROTOCOL_REVISION,
      scores: [
        {
          dimension: "ARABIC_QUALITY",
          scoreUnits: 920_000,
          rubricBand: "EXCELLENT",
        },
      ],
    });

    const fakeGateway = createFakeGateway(() => ({
      events: (async function* () {
        yield { type: "TEXT_DELTA", text: fakeResponseJson };
        yield {
          type: "USAGE",
          usage: {
            inputTokens: 150,
            cacheHitInputTokens: 0,
            cacheMissInputTokens: 0,
            outputTokens: 45,
            reasoningTokens: 0,
          },
        };
        yield { type: "COMPLETED", finishReason: "STOP" };
      })(),
      trace: Promise.resolve([buildMockAttemptTrace(f)]),
    }));

    const judgeService = new AIEvalJudgeExecutionService({
      database: f.database,
      gateway: fakeGateway,
      accounting: f.accounting,
      admission: f.admission,
      rateCards: f.rateCardResolver,
      clock: () => BASE_TIME + 10,
    });

    const execution = await judgeService.executeJudgeForCase({
      run,
      suite,
      caseRevision,
      caseResult,
      outputText: "Target answer",
      evidencePack: buildMockEvidencePack(),
      finishReason: "STOP",
    });

    assert.ok(execution);
    assert.equal(execution.status, "COMPLETED");
    assert.equal(execution.providerInvoked, true);
    assert.ok(execution.judgeCostOperationId);

    // Inspect the Cost Operation in SQLite
    const op = f.database.client
      .prepare("select * from ai_cost_operations where id=?")
      .get(execution.judgeCostOperationId) as Record<string, unknown>;

    assert.ok(op);
    assert.equal(op.cost_center, "EVALS");
    assert.equal(op.eval_run_id, run.id);
    assert.equal(op.subject_key, "biology");
    assert.equal(op.opaque_principal_ref, null);
    assert.equal(op.conversation_id, null);
    assert.equal(op.response_id, null);
    assert.equal(op.job_id, null);
    assert.equal(op.status, "COMPLETED");

    // Inspect Judge Results
    const results = f.runs.listJudgeResultsForRun(run.id);
    assert.equal(results.length, 1);
    assert.equal(results[0].dimension, "ARABIC_QUALITY");
    assert.equal(results[0].scoreUnits, 920_000);
    assert.equal(results[0].rubricBand, "EXCELLENT");
  } finally {
    f.close();
  }
});

test("Provider work is recorded in accounting even when Judge output is malformed", async () => {
  const f = createFixture();
  try {
    const judgeRef = publishJudgeConfig(f);
    const { caseId, caseRevision, suiteId, suite } = setupCaseAndSuite(f, judgeRef);

    const runId = uuidv7();
    const candidateSnapshot = normalizeAIEvalCandidateSnapshot({
      tutorConfig: { id: uuidv7(), revision: 1 },
      globalPolicy: { id: uuidv7(), revision: 1 },
      subjectPolicy: { id: uuidv7(), revision: 1 },
      contextPolicy: { id: uuidv7(), revision: 1 },
      retrievalConfig: { id: uuidv7(), revision: 1 },
      generationModel: { id: f.targetModelId, revision: 1 },
      generationProvider: { id: f.providerId, revision: 1 },
      embeddingSpace: null,
      rerank: null,
      groundingProtocol: { key: AI_TUTOR_GROUNDING_PROTOCOL_KEY, revision: AI_TUTOR_GROUNDING_PROTOCOL_REVISION },
      citationProtocol: { key: AI_TUTOR_CITATION_PROTOCOL_KEY, revision: AI_TUTOR_CITATION_PROTOCOL_REVISION },
    });

    const manifest = [{ caseId, caseRevision: 1, ordinal: 1 }];
    f.runs.create({
      id: runId,
      suiteId,
      suiteRevision: 1,
      manifestFingerprint: fingerprintAIEvalManifest(suite.caseManifest),
      candidateSnapshot,
      candidateFingerprint: fingerprintAIEvalCandidate(candidateSnapshot),
      baselineRunId: null,
      createdAt: BASE_TIME,
    });
    const run = f.runs.transition({
      id: runId,
      expectedStatus: "CREATED",
      status: "RUNNING",
      startedAt: BASE_TIME,
      updatedAt: BASE_TIME,
    });

    const caseResult: AIEvalCaseResult = {
      id: uuidv7(),
      runId,
      caseId,
      caseRevision: 1,
      ordinal: 1,
      observedSubjectKey: "biology",
      observedStatus: "COMPLETED",
      finishReason: "STOP",
      outputSha256: "0".repeat(64),
      outputByteSize: 50,
      evidence: [],
      retrievalStatus: "SUFFICIENT",
      elapsedLatencyMs: 120,
      costOperationId: null,
      privacyClass: "SYNTHETIC_PUBLIC_SAFE",
      createdAt: BASE_TIME + 1,
    };
    f.runs.insertCaseResult(caseResult);

    // Provider returns invalid JSON
    const malformedText = "{ broken json: true ...";

    const fakeGateway = createFakeGateway(() => ({
      events: (async function* () {
        yield { type: "TEXT_DELTA", text: malformedText };
        yield {
          type: "USAGE",
          usage: {
            inputTokens: 100,
            cacheHitInputTokens: 0,
            cacheMissInputTokens: 0,
            outputTokens: 20,
            reasoningTokens: 0,
          },
        };
        yield { type: "COMPLETED", finishReason: "STOP" };
      })(),
      trace: Promise.resolve([buildMockAttemptTrace(f)]),
    }));

    const judgeService = new AIEvalJudgeExecutionService({
      database: f.database,
      gateway: fakeGateway,
      accounting: f.accounting,
      admission: f.admission,
      rateCards: f.rateCardResolver,
      clock: () => BASE_TIME + 10,
    });

    const execution = await judgeService.executeJudgeForCase({
      run,
      suite,
      caseRevision,
      caseResult,
      outputText: "Target answer",
      evidencePack: buildMockEvidencePack(),
      finishReason: "STOP",
    });

    assert.ok(execution);
    assert.equal(execution.status, "FAILED");
    assert.equal(execution.safeFailureCode, "EVAL_JUDGE_OUTPUT_MALFORMED");
    assert.equal(execution.providerInvoked, true);

    // Cost operation is recorded and usage is preserved!
    const usageRecords = f.accounting.listUsageCostRecords(execution.judgeCostOperationId!);
    assert.equal(usageRecords.length, 1);
    assert.equal(usageRecords[0].normalizedInputTokens, 100);
    assert.equal(usageRecords[0].normalizedOutputTokens, 20);

    // No Judge results fabricated
    const results = f.runs.listJudgeResultsForRun(run.id);
    assert.equal(results.length, 0);
  } finally {
    f.close();
  }
});

test("Provider ambiguity: in-flight timeout after providerInvoked is marked AMBIGUOUS and not blindly retried", async () => {
  const f = createFixture();
  try {
    const judgeRef = publishJudgeConfig(f);
    const { caseId, caseRevision, suiteId, suite } = setupCaseAndSuite(f, judgeRef);

    const runId = uuidv7();
    const candidateSnapshot = normalizeAIEvalCandidateSnapshot({
      tutorConfig: { id: uuidv7(), revision: 1 },
      globalPolicy: { id: uuidv7(), revision: 1 },
      subjectPolicy: { id: uuidv7(), revision: 1 },
      contextPolicy: { id: uuidv7(), revision: 1 },
      retrievalConfig: { id: uuidv7(), revision: 1 },
      generationModel: { id: f.targetModelId, revision: 1 },
      generationProvider: { id: f.providerId, revision: 1 },
      embeddingSpace: null,
      rerank: null,
      groundingProtocol: { key: AI_TUTOR_GROUNDING_PROTOCOL_KEY, revision: AI_TUTOR_GROUNDING_PROTOCOL_REVISION },
      citationProtocol: { key: AI_TUTOR_CITATION_PROTOCOL_KEY, revision: AI_TUTOR_CITATION_PROTOCOL_REVISION },
    });

    const manifest = [{ caseId, caseRevision: 1, ordinal: 1 }];
    f.runs.create({
      id: runId,
      suiteId,
      suiteRevision: 1,
      manifestFingerprint: fingerprintAIEvalManifest(suite.caseManifest),
      candidateSnapshot,
      candidateFingerprint: fingerprintAIEvalCandidate(candidateSnapshot),
      baselineRunId: null,
      createdAt: BASE_TIME,
    });
    const run = f.runs.transition({
      id: runId,
      expectedStatus: "CREATED",
      status: "RUNNING",
      startedAt: BASE_TIME,
      updatedAt: BASE_TIME,
    });

    const caseResult: AIEvalCaseResult = {
      id: uuidv7(),
      runId,
      caseId,
      caseRevision: 1,
      ordinal: 1,
      observedSubjectKey: "biology",
      observedStatus: "COMPLETED",
      finishReason: "STOP",
      outputSha256: "0".repeat(64),
      outputByteSize: 50,
      evidence: [],
      retrievalStatus: "SUFFICIENT",
      elapsedLatencyMs: 120,
      costOperationId: null,
      privacyClass: "SYNTHETIC_PUBLIC_SAFE",
      createdAt: BASE_TIME + 1,
    };
    f.runs.insertCaseResult(caseResult);

    // Gateway throws TIMEOUT during streaming after providerInvoked
    const fakeGateway = createFakeGateway(() => ({
      events: (async function* () {
        yield { type: "TEXT_DELTA", text: "Partial" };
        throw new AIProviderGatewayError("TIMEOUT", "Provider socket timed out.");
      })(),
      trace: Promise.resolve([buildMockAttemptTrace(f)]),
    }));

    const judgeService = new AIEvalJudgeExecutionService({
      database: f.database,
      gateway: fakeGateway,
      accounting: f.accounting,
      admission: f.admission,
      rateCards: f.rateCardResolver,
      clock: () => BASE_TIME + 10,
    });

    const execution = await judgeService.executeJudgeForCase({
      run,
      suite,
      caseRevision,
      caseResult,
      outputText: "Target answer",
      evidencePack: buildMockEvidencePack(),
      finishReason: "STOP",
    });

    assert.ok(execution);
    assert.equal(execution.status, "AMBIGUOUS");
    assert.equal(execution.providerInvocationState, "AMBIGUOUS");
    assert.equal(execution.safeFailureCode, "EVAL_JUDGE_PROVIDER_AMBIGUOUS");

    // Re-invocation does NOT call provider again
    const secondCall = await judgeService.executeJudgeForCase({
      run,
      suite,
      caseRevision,
      caseResult,
      outputText: "Target answer",
      evidencePack: buildMockEvidencePack(),
      finishReason: "STOP",
    });

    assert.equal(secondCall?.status, "AMBIGUOUS");
    assert.equal(fakeGateway.calls.length, 1); // No blind retry!
  } finally {
    f.close();
  }
});

test("Privacy markers: raw target/judge outputs, evidence, and system rubrics do NOT persist in DB", async () => {
  const f = createFixture();
  try {
    const judgeRef = publishJudgeConfig(f);
    const { caseId, caseRevision, suiteId, suite } = setupCaseAndSuite(f, judgeRef);

    const runId = uuidv7();
    const candidateSnapshot = normalizeAIEvalCandidateSnapshot({
      tutorConfig: { id: uuidv7(), revision: 1 },
      globalPolicy: { id: uuidv7(), revision: 1 },
      subjectPolicy: { id: uuidv7(), revision: 1 },
      contextPolicy: { id: uuidv7(), revision: 1 },
      retrievalConfig: { id: uuidv7(), revision: 1 },
      generationModel: { id: f.targetModelId, revision: 1 },
      generationProvider: { id: f.providerId, revision: 1 },
      embeddingSpace: null,
      rerank: null,
      groundingProtocol: { key: AI_TUTOR_GROUNDING_PROTOCOL_KEY, revision: AI_TUTOR_GROUNDING_PROTOCOL_REVISION },
      citationProtocol: { key: AI_TUTOR_CITATION_PROTOCOL_KEY, revision: AI_TUTOR_CITATION_PROTOCOL_REVISION },
    });

    const manifest = [{ caseId, caseRevision: 1, ordinal: 1 }];
    f.runs.create({
      id: runId,
      suiteId,
      suiteRevision: 1,
      manifestFingerprint: fingerprintAIEvalManifest(suite.caseManifest),
      candidateSnapshot,
      candidateFingerprint: fingerprintAIEvalCandidate(candidateSnapshot),
      baselineRunId: null,
      createdAt: BASE_TIME,
    });
    const run = f.runs.transition({
      id: runId,
      expectedStatus: "CREATED",
      status: "RUNNING",
      startedAt: BASE_TIME,
      updatedAt: BASE_TIME,
    });

    const caseResult: AIEvalCaseResult = {
      id: uuidv7(),
      runId,
      caseId,
      caseRevision: 1,
      ordinal: 1,
      observedSubjectKey: "biology",
      observedStatus: "COMPLETED",
      finishReason: "STOP",
      outputSha256: "0".repeat(64),
      outputByteSize: 50,
      evidence: [],
      retrievalStatus: "SUFFICIENT",
      elapsedLatencyMs: 120,
      costOperationId: null,
      privacyClass: "SYNTHETIC_PUBLIC_SAFE",
      createdAt: BASE_TIME + 1,
    };
    f.runs.insertCaseResult(caseResult);

    const MARKER_TARGET_OUTPUT = "PRIVATE_M9B2_TARGET_OUTPUT_91";
    const MARKER_JUDGE_OUTPUT = "PRIVATE_M9B2_JUDGE_OUTPUT_92";
    const MARKER_EVIDENCE = "PRIVATE_M9B2_EVIDENCE_93";
    const MARKER_SYSTEM_RUBRIC = "PRIVATE_M9B2_SYSTEM_RUBRIC_94";

    const fakeResponseJson = JSON.stringify({
      protocol: AI_EVAL_JUDGE_PROTOCOL_KEY,
      revision: AI_EVAL_JUDGE_PROTOCOL_REVISION,
      scores: [
        {
          dimension: "ARABIC_QUALITY",
          scoreUnits: 850_000,
          rubricBand: "PASS",
        },
      ],
    });

    const fakeGateway = createFakeGateway(() => ({
      events: (async function* () {
        // Output text contains MARKER_JUDGE_OUTPUT before ending with JSON
        yield { type: "TEXT_DELTA", text: fakeResponseJson };
        yield {
          type: "USAGE",
          usage: {
            standardInputTokens: 50,
            cacheHitInputTokens: 0,
            cacheMissInputTokens: 0,
            outputTokens: 50,
            reasoningTokens: 0,
            totalTokens: 100,
          },
        };
        yield { type: "COMPLETED", finishReason: "STOP" };
      })(),
      trace: Promise.resolve([buildMockAttemptTrace(f)]),
    }));

    const pack = buildMockEvidencePack();
    // Inject evidence marker in memory only
    (pack.items[0] as any).text = `Evidence text with ${MARKER_EVIDENCE}`;

    const judgeService = new AIEvalJudgeExecutionService({
      database: f.database,
      gateway: fakeGateway,
      accounting: f.accounting,
      admission: f.admission,
      rateCards: f.rateCardResolver,
      clock: () => BASE_TIME + 10,
    });

    await judgeService.executeJudgeForCase({
      run,
      suite,
      caseRevision,
      caseResult,
      outputText: `Target answer with ${MARKER_TARGET_OUTPUT}`,
      evidencePack: pack,
      finishReason: "STOP",
    });

    // Check all tables in SQLite database to confirm NO private markers were written
    const tables = [
      "ai_eval_judge_executions",
      "ai_eval_judge_results",
      "ai_cost_operations",
      "ai_usage_cost_records",
      "ai_budget_reservations",
      "ai_eval_runs",
      "ai_eval_case_results",
    ];

    for (const table of tables) {
      const rows = f.database.client.prepare(`select * from ${table}`).all();
      const stringified = JSON.stringify(rows);
      assert.equal(stringified.includes(MARKER_TARGET_OUTPUT), false, `Marker found in ${table}`);
      assert.equal(stringified.includes(MARKER_JUDGE_OUTPUT), false, `Marker found in ${table}`);
      assert.equal(stringified.includes(MARKER_EVIDENCE), false, `Marker found in ${table}`);
      assert.equal(stringified.includes(MARKER_SYSTEM_RUBRIC), false, `Marker found in ${table}`);
    }
  } finally {
    f.close();
  }
});

function setupStandardRun(
  f: Fixture,
  judgeOverrides: Partial<AIEvalJudgeConfigContent> = {},
) {
  const judgeRef = publishJudgeConfig(f, judgeOverrides);
  const { caseId, caseRevision, suiteId, suite } = setupCaseAndSuite(f, judgeRef);

  const runId = uuidv7();
  const candidateSnapshot = normalizeAIEvalCandidateSnapshot({
    tutorConfig: { id: uuidv7(), revision: 1 },
    globalPolicy: { id: uuidv7(), revision: 1 },
    subjectPolicy: { id: uuidv7(), revision: 1 },
    contextPolicy: { id: uuidv7(), revision: 1 },
    retrievalConfig: { id: uuidv7(), revision: 1 },
    generationModel: { id: f.targetModelId, revision: 1 },
    generationProvider: { id: f.providerId, revision: 1 },
    embeddingSpace: null,
    rerank: null,
    groundingProtocol: { key: AI_TUTOR_GROUNDING_PROTOCOL_KEY, revision: AI_TUTOR_GROUNDING_PROTOCOL_REVISION },
    citationProtocol: { key: AI_TUTOR_CITATION_PROTOCOL_KEY, revision: AI_TUTOR_CITATION_PROTOCOL_REVISION },
  });

  f.runs.create({
    id: runId,
    suiteId,
    suiteRevision: 1,
    manifestFingerprint: fingerprintAIEvalManifest(suite.caseManifest),
    candidateSnapshot,
    candidateFingerprint: fingerprintAIEvalCandidate(candidateSnapshot),
    baselineRunId: null,
    createdAt: BASE_TIME,
  });
  const run = f.runs.transition({
    id: runId,
    expectedStatus: "CREATED",
    status: "RUNNING",
    startedAt: BASE_TIME,
    updatedAt: BASE_TIME,
  });

  const caseResult: AIEvalCaseResult = {
    id: uuidv7(),
    runId,
    caseId,
    caseRevision: 1,
    ordinal: 1,
    observedSubjectKey: "biology",
    observedStatus: "COMPLETED",
    finishReason: "STOP",
    outputSha256: "0".repeat(64),
    outputByteSize: 50,
    evidence: [],
    retrievalStatus: "SUFFICIENT",
    elapsedLatencyMs: 120,
    costOperationId: null,
    privacyClass: "SYNTHETIC_PUBLIC_SAFE",
    createdAt: BASE_TIME + 1,
  };
  f.runs.insertCaseResult(caseResult);

  return { run, suite, caseRevision, caseResult, judgeRef };
}

test("Crash/re-entry: existing RUNNING + INVOKING Judge Execution transitions to AMBIGUOUS with ZERO second Gateway calls", async () => {
  const f = createFixture();
  try {
    const { run, suite, caseRevision, caseResult, judgeRef } = setupStandardRun(f);

    const execId = uuidv7();
    const judgeConfig = f.judgeConfigs.getRevision(judgeRef.id, judgeRef.revision)!;
    f.judgeExecutions.create({
      id: execId,
      runId: run.id,
      caseId: caseRevision.caseId,
      caseRevision: caseRevision.revision,
      ordinal: 1,
      subjectKey: "biology",
      judgeConfigId: judgeConfig.judgeConfigId,
      judgeConfigRevision: judgeConfig.revision,
      judgeConfigFingerprint: judgeConfig.fingerprint,
      protocolKey: AI_EVAL_JUDGE_PROTOCOL_KEY,
      protocolRevision: AI_EVAL_JUDGE_PROTOCOL_REVISION,
      judgeModelConfigId: judgeConfig.modelConfigId,
      judgeModelConfigRevision: judgeConfig.modelConfigRevision,
      judgeProviderConfigId: judgeConfig.providerConfigId,
      judgeProviderConfigRevision: judgeConfig.providerConfigRevision,
      judgeCostOperationId: null,
      budgetReservationId: null,
      status: "PENDING",
      providerInvocationState: "NOT_INVOKED",
      providerInvoked: false,
      judgeOutputSha256: null,
      judgeOutputByteSize: null,
      safeFailureCode: null,
      latencyMs: null,
      createdAt: BASE_TIME + 2,
      startedAt: null,
      completedAt: null,
      updatedAt: BASE_TIME + 2,
    });
    f.judgeExecutions.markRunning(execId, BASE_TIME + 3);
    f.judgeExecutions.markInvoking(execId, BASE_TIME + 4);

    let gatewayCalls = 0;
    const fakeGateway = createFakeGateway(() => {
      gatewayCalls++;
      throw new Error("Gateway must not be called on re-entry");
    });

    const judgeService = new AIEvalJudgeExecutionService({
      database: f.database,
      gateway: fakeGateway,
      accounting: f.accounting,
      admission: f.admission,
      rateCards: f.rateCardResolver,
      clock: () => BASE_TIME + 10,
    });

    const result = await judgeService.executeJudgeForCase({
      run,
      suite,
      caseRevision,
      caseResult,
      outputText: "Target output",
      evidencePack: buildMockEvidencePack(),
      finishReason: "STOP",
    });

    assert.equal(gatewayCalls, 0, "Expected ZERO Gateway calls on re-entry");
    assert.ok(result);
    assert.equal(result.status, "AMBIGUOUS");
    assert.equal(result.providerInvocationState, "AMBIGUOUS");
    assert.equal(result.safeFailureCode, "EVAL_JUDGE_PROVIDER_AMBIGUOUS");

    const updated = f.judgeExecutions.getById(execId)!;
    assert.equal(updated.status, "AMBIGUOUS");
  } finally {
    f.close();
  }
});

test("Crash/re-entry: existing execution with Provider Usage already recorded transitions to AMBIGUOUS with ZERO second Gateway calls", async () => {
  const f = createFixture();
  try {
    const { run, suite, caseRevision, caseResult, judgeRef } = setupStandardRun(f);

    const execId = uuidv7();
    const judgeConfig = f.judgeConfigs.getRevision(judgeRef.id, judgeRef.revision)!;

    const op = f.accounting.createOperation({
      costCenter: "EVALS",
      idempotencyKey: null,
      opaquePrincipalRef: null,
      subjectKey: "biology",
      conversationId: null,
      responseId: null,
      jobId: null,
      evalRunId: run.id,
      knowledgeRevision: null,
      status: "OPEN",
      startedAt: BASE_TIME + 2,
      completedAt: null,
    });

    f.accounting.recordAttempt({
      operationId: op.id,
      attempt: buildMockAttemptTrace(f),
      normalizedUsage: {
        inputTokens: 100,
        outputTokens: 50,
        reasoningTokens: 0,
        cacheHitInputTokens: 0,
        cacheMissInputTokens: 0,
      },
      capability: "GENERATION",
      providerModelId: "judge-v1",
      at: BASE_TIME + 3,
      latencyMs: 40,
    });

    f.judgeExecutions.create({
      id: execId,
      runId: run.id,
      caseId: caseRevision.caseId,
      caseRevision: caseRevision.revision,
      ordinal: 1,
      subjectKey: "biology",
      judgeConfigId: judgeConfig.judgeConfigId,
      judgeConfigRevision: judgeConfig.revision,
      judgeConfigFingerprint: judgeConfig.fingerprint,
      protocolKey: AI_EVAL_JUDGE_PROTOCOL_KEY,
      protocolRevision: AI_EVAL_JUDGE_PROTOCOL_REVISION,
      judgeModelConfigId: judgeConfig.modelConfigId,
      judgeModelConfigRevision: judgeConfig.modelConfigRevision,
      judgeProviderConfigId: judgeConfig.providerConfigId,
      judgeProviderConfigRevision: judgeConfig.providerConfigRevision,
      judgeCostOperationId: null,
      budgetReservationId: null,
      status: "PENDING",
      providerInvocationState: "NOT_INVOKED",
      providerInvoked: false,
      judgeOutputSha256: null,
      judgeOutputByteSize: null,
      safeFailureCode: null,
      latencyMs: null,
      createdAt: BASE_TIME + 2,
      startedAt: null,
      completedAt: null,
      updatedAt: BASE_TIME + 2,
    });
    f.judgeExecutions.bindOperation(execId, op.id, BASE_TIME + 3);
    f.judgeExecutions.markRunning(execId, BASE_TIME + 4);

    let gatewayCalls = 0;
    const fakeGateway = createFakeGateway(() => {
      gatewayCalls++;
      throw new Error("Gateway must not be called");
    });

    const judgeService = new AIEvalJudgeExecutionService({
      database: f.database,
      gateway: fakeGateway,
      accounting: f.accounting,
      admission: f.admission,
      rateCards: f.rateCardResolver,
      clock: () => BASE_TIME + 10,
    });

    const result = await judgeService.executeJudgeForCase({
      run,
      suite,
      caseRevision,
      caseResult,
      outputText: "Target output",
      evidencePack: buildMockEvidencePack(),
      finishReason: "STOP",
    });

    assert.equal(gatewayCalls, 0, "Expected ZERO Gateway calls on re-entry with existing usage");
    assert.ok(result);
    assert.equal(result.status, "AMBIGUOUS");

    assert.ok(f.accounting.listUsageCostRecords(op.id).length > 0, "Usage records must be preserved");
  } finally {
    f.close();
  }
});

test("Crash/re-entry: process interruption before Provider invocation fails closed as INPUT_LOST with ZERO Gateway calls", async () => {
  const f = createFixture();
  try {
    const { run, suite, caseRevision, caseResult, judgeRef } = setupStandardRun(f);

    const execId = uuidv7();
    const judgeConfig = f.judgeConfigs.getRevision(judgeRef.id, judgeRef.revision)!;

    f.judgeExecutions.create({
      id: execId,
      runId: run.id,
      caseId: caseRevision.caseId,
      caseRevision: caseRevision.revision,
      ordinal: 1,
      subjectKey: "biology",
      judgeConfigId: judgeConfig.judgeConfigId,
      judgeConfigRevision: judgeConfig.revision,
      judgeConfigFingerprint: judgeConfig.fingerprint,
      protocolKey: AI_EVAL_JUDGE_PROTOCOL_KEY,
      protocolRevision: AI_EVAL_JUDGE_PROTOCOL_REVISION,
      judgeModelConfigId: judgeConfig.modelConfigId,
      judgeModelConfigRevision: judgeConfig.modelConfigRevision,
      judgeProviderConfigId: judgeConfig.providerConfigId,
      judgeProviderConfigRevision: judgeConfig.providerConfigRevision,
      judgeCostOperationId: null,
      budgetReservationId: null,
      status: "PENDING",
      providerInvocationState: "NOT_INVOKED",
      providerInvoked: false,
      judgeOutputSha256: null,
      judgeOutputByteSize: null,
      safeFailureCode: null,
      latencyMs: null,
      createdAt: BASE_TIME + 2,
      startedAt: null,
      completedAt: null,
      updatedAt: BASE_TIME + 2,
    });
    f.judgeExecutions.markRunning(execId, BASE_TIME + 3);

    let gatewayCalls = 0;
    const fakeGateway = createFakeGateway(() => {
      gatewayCalls++;
      throw new Error("Gateway must not be called");
    });

    const judgeService = new AIEvalJudgeExecutionService({
      database: f.database,
      gateway: fakeGateway,
      accounting: f.accounting,
      admission: f.admission,
      rateCards: f.rateCardResolver,
      clock: () => BASE_TIME + 10,
    });

    const result = await judgeService.executeJudgeForCase({
      run,
      suite,
      caseRevision,
      caseResult,
      outputText: "Target output",
      evidencePack: buildMockEvidencePack(),
      finishReason: "STOP",
    });

    assert.equal(gatewayCalls, 0, "Expected ZERO Gateway calls when runtime target input is lost");
    assert.ok(result);
    assert.equal(result.status, "INPUT_LOST");
    assert.equal(result.safeFailureCode, "EVAL_JUDGE_INPUT_LOST");

    const updated = f.judgeExecutions.getById(execId)!;
    assert.equal(updated.status, "INPUT_LOST");
  } finally {
    f.close();
  }
});

test("Lease loss before Judge Provider invocation: ZERO Provider calls, no usage, no result, releases reservation and rethrows AI_JOB_LEASE_LOST", async () => {
  const f = createFixture();
  try {
    const { run, suite, caseRevision, caseResult } = setupStandardRun(f);

    let gatewayCalls = 0;
    const fakeGateway = createFakeGateway(() => {
      gatewayCalls++;
      throw new Error("Gateway must not be called");
    });

    const judgeService = new AIEvalJudgeExecutionService({
      database: f.database,
      gateway: fakeGateway,
      accounting: f.accounting,
      admission: f.admission,
      rateCards: f.rateCardResolver,
      clock: () => BASE_TIME + 10,
    });

    const checkLease = () => {
      throw new AIJobError("AI_JOB_LEASE_LOST", "Job lease expired during judge execution");
    };

    await assert.rejects(
      async () => {
        await judgeService.executeJudgeForCase({
          run,
          suite,
          caseRevision,
          caseResult,
          outputText: "Target output",
          evidencePack: buildMockEvidencePack(),
          finishReason: "STOP",
          checkLease,
        });
      },
      (err: any) => err instanceof AIJobError && err.code === "AI_JOB_LEASE_LOST",
    );

    assert.equal(gatewayCalls, 0, "Expected ZERO Gateway calls on early lease loss");

    const exec = f.judgeExecutions.getForCase({
      runId: run.id,
      caseId: caseRevision.caseId,
      caseRevision: caseRevision.revision,
    })!;
    assert.ok(exec);
    assert.equal(exec.status, "FAILED");
    assert.equal(exec.safeFailureCode, "EVAL_JUDGE_LEASE_LOST");

    const results = f.runs.listJudgeResultsForRun(run.id);
    assert.equal(results.length, 0);
  } finally {
    f.close();
  }
});

test("Lease loss after Provider invocation: usage preserved, transitions to AMBIGUOUS, zero duplicate results, rethrows AI_JOB_LEASE_LOST", async () => {
  const f = createFixture();
  try {
    const { run, suite, caseRevision, caseResult } = setupStandardRun(f);

    const fakeResponseJson = JSON.stringify({
      protocol: AI_EVAL_JUDGE_PROTOCOL_KEY,
      revision: AI_EVAL_JUDGE_PROTOCOL_REVISION,
      scores: [{ dimension: "ARABIC_QUALITY", scoreUnits: 850_000, rubricBand: "PASS" }],
    });

    let gatewayCalls = 0;
    const fakeGateway = createFakeGateway(() => {
      gatewayCalls++;
      return {
        events: (async function* () {
          yield { type: "TEXT_DELTA", text: fakeResponseJson };
          yield {
            type: "USAGE",
            usage: {
              standardInputTokens: 50,
              cacheHitInputTokens: 0,
              cacheMissInputTokens: 0,
              outputTokens: 50,
              reasoningTokens: 0,
              totalTokens: 100,
            },
          };
          yield { type: "COMPLETED", finishReason: "STOP" };
        })(),
        trace: Promise.resolve([buildMockAttemptTrace(f)]),
      };
    });

    const judgeService = new AIEvalJudgeExecutionService({
      database: f.database,
      gateway: fakeGateway,
      accounting: f.accounting,
      admission: f.admission,
      rateCards: f.rateCardResolver,
      clock: () => BASE_TIME + 10,
    });

    let callIndex = 0;
    const checkLease = () => {
      callIndex++;
      if (callIndex > 4) {
        throw new AIJobError("AI_JOB_LEASE_LOST", "Job lease expired after provider call");
      }
    };

    await assert.rejects(
      async () => {
        await judgeService.executeJudgeForCase({
          run,
          suite,
          caseRevision,
          caseResult,
          outputText: "Target output",
          evidencePack: buildMockEvidencePack(),
          finishReason: "STOP",
          checkLease,
        });
      },
      (err: any) => err instanceof AIJobError && err.code === "AI_JOB_LEASE_LOST",
    );

    assert.equal(gatewayCalls, 1);

    const exec = f.judgeExecutions.getForCase({
      runId: run.id,
      caseId: caseRevision.caseId,
      caseRevision: caseRevision.revision,
    })!;
    assert.ok(exec);
    assert.equal(exec.status, "AMBIGUOUS");
    assert.equal(exec.providerInvocationState, "AMBIGUOUS");

    const results = f.runs.listJudgeResultsForRun(run.id);
    assert.equal(results.length, 0);

    assert.ok(exec.judgeCostOperationId);
    assert.ok(f.accounting.listUsageCostRecords(exec.judgeCostOperationId!).length > 0);

    const reentered = await judgeService.executeJudgeForCase({
      run,
      suite,
      caseRevision,
      caseResult,
      outputText: "Target output",
      evidencePack: buildMockEvidencePack(),
      finishReason: "STOP",
    });
    assert.equal(gatewayCalls, 1, "Expected ZERO retry on re-entry after AMBIGUOUS");
    assert.ok(reentered);
    assert.equal(reentered.status, "AMBIGUOUS");
  } finally {
    f.close();
  }
});

test("Provider proof: valid structured Judge output but providerInvoked=false fails execution and inserts ZERO judge results", async () => {
  const f = createFixture();
  try {
    const { run, suite, caseRevision, caseResult } = setupStandardRun(f);

    const fakeResponseJson = JSON.stringify({
      protocol: AI_EVAL_JUDGE_PROTOCOL_KEY,
      revision: AI_EVAL_JUDGE_PROTOCOL_REVISION,
      scores: [{ dimension: "ARABIC_QUALITY", scoreUnits: 950_000, rubricBand: "EXCELLENT" }],
    });

    let gatewayCalls = 0;
    const fakeGateway = createFakeGateway(() => {
      gatewayCalls++;
      return {
        events: (async function* () {
          yield { type: "TEXT_DELTA", text: fakeResponseJson };
          yield { type: "COMPLETED", finishReason: "STOP" };
        })(),
        trace: Promise.resolve([buildMockAttemptTrace(f, { providerInvoked: false })]),
      };
    });

    const judgeService = new AIEvalJudgeExecutionService({
      database: f.database,
      gateway: fakeGateway,
      accounting: f.accounting,
      admission: f.admission,
      rateCards: f.rateCardResolver,
      clock: () => BASE_TIME + 10,
    });

    const execution = await judgeService.executeJudgeForCase({
      run,
      suite,
      caseRevision,
      caseResult,
      outputText: "Target output",
      evidencePack: buildMockEvidencePack(),
      finishReason: "STOP",
    });

    assert.equal(gatewayCalls, 1);
    assert.ok(execution);
    assert.equal(execution.status, "FAILED");
    assert.equal(execution.safeFailureCode, "EVAL_JUDGE_PROVIDER_NOT_INVOKED");
    assert.equal(execution.providerInvoked, false);

    const results = f.runs.listJudgeResultsForRun(run.id);
    assert.equal(results.length, 0);
  } finally {
    f.close();
  }
});

test("Provider proof (DB trust boundary): direct DB insert into ai_eval_judge_results is rejected unless execution proves invocation with accounting", () => {
  const f = createFixture();
  try {
    const { run, suite, caseRevision, caseResult, judgeRef } = setupStandardRun(f);
    const judgeConfig = f.judgeConfigs.getRevision(judgeRef.id, judgeRef.revision)!;

    const execId = uuidv7();
    f.judgeExecutions.create({
      id: execId,
      runId: run.id,
      caseId: caseRevision.caseId,
      caseRevision: caseRevision.revision,
      ordinal: 1,
      subjectKey: "biology",
      judgeConfigId: judgeConfig.judgeConfigId,
      judgeConfigRevision: judgeConfig.revision,
      judgeConfigFingerprint: judgeConfig.fingerprint,
      protocolKey: judgeConfig.protocolKey,
      protocolRevision: judgeConfig.protocolRevision,
      judgeModelConfigId: judgeConfig.modelConfigId,
      judgeModelConfigRevision: judgeConfig.modelConfigRevision,
      judgeProviderConfigId: judgeConfig.providerConfigId,
      judgeProviderConfigRevision: judgeConfig.providerConfigRevision,
      judgeCostOperationId: null,
      budgetReservationId: null,
      status: "PENDING",
      providerInvocationState: "NOT_INVOKED",
      providerInvoked: false,
      judgeOutputSha256: null,
      judgeOutputByteSize: null,
      safeFailureCode: null,
      latencyMs: null,
      createdAt: BASE_TIME + 2,
      startedAt: null,
      completedAt: null,
      updatedAt: BASE_TIME + 2,
    });
    f.judgeExecutions.markRunning(execId, BASE_TIME + 3);

    const insertSql = `INSERT INTO ai_eval_judge_results (
      id, judge_execution_id, case_result_id, run_id, case_id, case_revision,
      dimension, judge_config_id, judge_config_revision, protocol_key, protocol_revision,
      judge_model_config_id, judge_model_config_revision, judge_provider_config_id, judge_provider_config_revision,
      score_units, rubric_band, safe_reason_code, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'ARABIC_QUALITY', ?, 1, ?, 1, ?, 1, ?, 1, 800000, 'PASS', 'OK', 1000)`;

    // 1. provider_invoked is 0 -> trigger rejects
    assert.throws(
      () => {
        f.database.client.prepare(insertSql).run(
          uuidv7(), execId, caseResult.id, run.id, caseRevision.caseId, caseRevision.revision,
          judgeConfig.judgeConfigId, judgeConfig.protocolKey, judgeConfig.modelConfigId, judgeConfig.providerConfigId,
        );
      },
      (err: any) => /Eval Judge Result is invalid, unproven, or dimension is not configured as JUDGE_REQUIRED/.test(err.message),
    );

    // 2. markInvoking (provider_invoked = 0, state = INVOKING) -> trigger rejects
    f.judgeExecutions.markInvoking(execId, BASE_TIME + 4);
    assert.throws(
      () => {
        f.database.client.prepare(insertSql).run(
          uuidv7(), execId, caseResult.id, run.id, caseRevision.caseId, caseRevision.revision,
          judgeConfig.judgeConfigId, judgeConfig.protocolKey, judgeConfig.modelConfigId, judgeConfig.providerConfigId,
        );
      },
      (err: any) => /Eval Judge Result is invalid, unproven, or dimension is not configured as JUDGE_REQUIRED/.test(err.message),
    );

    // 3. markInvokedWithAccounting but judge_cost_operation_id is still NULL -> trigger rejects
    f.judgeExecutions.markInvokedWithAccounting(execId, BASE_TIME + 5);
    assert.throws(
      () => {
        f.database.client.prepare(insertSql).run(
          uuidv7(), execId, caseResult.id, run.id, caseRevision.caseId, caseRevision.revision,
          judgeConfig.judgeConfigId, judgeConfig.protocolKey, judgeConfig.modelConfigId, judgeConfig.providerConfigId,
        );
      },
      (err: any) => /Eval Judge Result is invalid, unproven, or dimension is not configured as JUDGE_REQUIRED/.test(err.message),
    );

    // 4. Bind cost operation -> now proven invocation with accounting is complete, insert succeeds
    const op = f.accounting.createOperation({
      costCenter: "EVALS",
      idempotencyKey: null,
      opaquePrincipalRef: null,
      subjectKey: "biology",
      conversationId: null,
      responseId: null,
      jobId: null,
      evalRunId: run.id,
      knowledgeRevision: null,
      status: "OPEN",
      startedAt: BASE_TIME + 2,
      completedAt: null,
    });
    f.judgeExecutions.bindOperation(execId, op.id, BASE_TIME + 6);

    const resultId = uuidv7();
    f.database.client.prepare(insertSql).run(
      resultId, execId, caseResult.id, run.id, caseRevision.caseId, caseRevision.revision,
      judgeConfig.judgeConfigId, judgeConfig.protocolKey, judgeConfig.modelConfigId, judgeConfig.providerConfigId,
    );

    const inserted = f.database.client.prepare(`SELECT id FROM ai_eval_judge_results WHERE id = ?`).get(resultId);
    assert.ok(inserted);
  } finally {
    f.close();
  }
});

test("Rubric consistency: repository insertJudgeResult enforces exact band boundaries and rejects cross-band mismatches", () => {
  const f = createFixture();
  try {
    const valid = [
      { band: "FAIL" as const, score: 0 },
      { band: "FAIL" as const, score: 499_999 },
      { band: "MARGINAL" as const, score: 500_000 },
      { band: "MARGINAL" as const, score: 699_999 },
      { band: "PASS" as const, score: 700_000 },
      { band: "PASS" as const, score: 899_999 },
      { band: "EXCELLENT" as const, score: 900_000 },
      { band: "EXCELLENT" as const, score: 1_000_000 },
    ];

    for (const item of valid) {
      const { run, caseRevision, caseResult, judgeRef } = setupStandardRun(f);
      const judgeConfig = f.judgeConfigs.getRevision(judgeRef.id, judgeRef.revision)!;

      const op = f.accounting.createOperation({
        costCenter: "EVALS",
        idempotencyKey: null,
        opaquePrincipalRef: null,
        subjectKey: "biology",
        conversationId: null,
        responseId: null,
        jobId: null,
        evalRunId: run.id,
        knowledgeRevision: null,
        status: "OPEN",
        startedAt: BASE_TIME + 2,
        completedAt: null,
      });

      const execId = uuidv7();
      f.judgeExecutions.create({
        id: execId,
        runId: run.id,
        caseId: caseRevision.caseId,
        caseRevision: caseRevision.revision,
        ordinal: 1,
        subjectKey: "biology",
        judgeConfigId: judgeConfig.judgeConfigId,
        judgeConfigRevision: judgeConfig.revision,
        judgeConfigFingerprint: judgeConfig.fingerprint,
        protocolKey: judgeConfig.protocolKey,
        protocolRevision: judgeConfig.protocolRevision,
        judgeModelConfigId: judgeConfig.modelConfigId,
        judgeModelConfigRevision: judgeConfig.modelConfigRevision,
        judgeProviderConfigId: judgeConfig.providerConfigId,
        judgeProviderConfigRevision: judgeConfig.providerConfigRevision,
        judgeCostOperationId: null,
        budgetReservationId: null,
        status: "PENDING",
        providerInvocationState: "NOT_INVOKED",
        providerInvoked: false,
        judgeOutputSha256: null,
        judgeOutputByteSize: null,
        safeFailureCode: null,
        latencyMs: null,
        createdAt: BASE_TIME + 2,
        startedAt: null,
        completedAt: null,
        updatedAt: BASE_TIME + 2,
      });
      f.judgeExecutions.bindOperation(execId, op.id, BASE_TIME + 3);
      f.judgeExecutions.markRunning(execId, BASE_TIME + 3);
      f.judgeExecutions.markInvokedWithAccounting(execId, BASE_TIME + 4);

      const inserted = f.runs.insertJudgeResult({
        id: uuidv7(),
        runId: run.id,
        caseId: caseRevision.caseId,
        caseRevision: caseRevision.revision,
        caseResultId: caseResult.id,
        judgeExecutionId: execId,
        judgeConfigId: judgeConfig.judgeConfigId,
        judgeConfigRevision: 1,
        protocolKey: judgeConfig.protocolKey,
        protocolRevision: judgeConfig.protocolRevision,
        judgeModelConfigId: judgeConfig.modelConfigId,
        judgeModelConfigRevision: 1,
        judgeProviderConfigId: judgeConfig.providerConfigId,
        judgeProviderConfigRevision: 1,
        dimension: "ARABIC_QUALITY",
        scoreUnits: item.score,
        rubricBand: item.band,
        safeReasonCode: "OK",
        createdAt: 1000,
      });
      assert.equal(inserted.scoreUnits, item.score);
      assert.equal(inserted.rubricBand, item.band);
    }

    const { run, caseRevision, caseResult, judgeRef } = setupStandardRun(f);
    const judgeConfig = f.judgeConfigs.getRevision(judgeRef.id, judgeRef.revision)!;

    const op = f.accounting.createOperation({
      costCenter: "EVALS",
      idempotencyKey: null,
      opaquePrincipalRef: null,
      subjectKey: "biology",
      conversationId: null,
      responseId: null,
      jobId: null,
      evalRunId: run.id,
      knowledgeRevision: null,
      status: "OPEN",
      startedAt: BASE_TIME + 2,
      completedAt: null,
    });

    const execId = uuidv7();
    f.judgeExecutions.create({
      id: execId,
      runId: run.id,
      caseId: caseRevision.caseId,
      caseRevision: caseRevision.revision,
      ordinal: 1,
      subjectKey: "biology",
      judgeConfigId: judgeConfig.judgeConfigId,
      judgeConfigRevision: judgeConfig.revision,
      judgeConfigFingerprint: judgeConfig.fingerprint,
      protocolKey: judgeConfig.protocolKey,
      protocolRevision: judgeConfig.protocolRevision,
      judgeModelConfigId: judgeConfig.modelConfigId,
      judgeModelConfigRevision: judgeConfig.modelConfigRevision,
      judgeProviderConfigId: judgeConfig.providerConfigId,
      judgeProviderConfigRevision: judgeConfig.providerConfigRevision,
      judgeCostOperationId: null,
      budgetReservationId: null,
      status: "PENDING",
      providerInvocationState: "NOT_INVOKED",
      providerInvoked: false,
      judgeOutputSha256: null,
      judgeOutputByteSize: null,
      safeFailureCode: null,
      latencyMs: null,
      createdAt: BASE_TIME + 2,
      startedAt: null,
      completedAt: null,
      updatedAt: BASE_TIME + 2,
    });
    f.judgeExecutions.bindOperation(execId, op.id, BASE_TIME + 3);
    f.judgeExecutions.markRunning(execId, BASE_TIME + 3);
    f.judgeExecutions.markInvokedWithAccounting(execId, BASE_TIME + 4);

    const baseResult = {
      runId: run.id,
      caseId: caseRevision.caseId,
      caseRevision: caseRevision.revision,
      caseResultId: caseResult.id,
      judgeExecutionId: execId,
      judgeConfigId: judgeConfig.judgeConfigId,
      judgeConfigRevision: 1,
      protocolKey: judgeConfig.protocolKey,
      protocolRevision: judgeConfig.protocolRevision,
      judgeModelConfigId: judgeConfig.modelConfigId,
      judgeModelConfigRevision: 1,
      judgeProviderConfigId: judgeConfig.providerConfigId,
      judgeProviderConfigRevision: 1,
      dimension: "ARABIC_QUALITY" as AIEvalDimension,
      safeReasonCode: "OK",
      createdAt: 1000,
    };

    const invalid = [
      { band: "EXCELLENT" as any, score: 0 },
      { band: "PASS" as any, score: 699_999 },
      { band: "MARGINAL" as any, score: 900_000 },
      { band: "FAIL" as any, score: 500_000 },
      { band: "INVALID_BAND" as any, score: 800_000 },
    ];

    for (const item of invalid) {
      assert.throws(
        () => {
          f.runs.insertJudgeResult({
            ...baseResult,
            id: uuidv7(),
            rubricBand: item.band,
            scoreUnits: item.score,
          });
        },
        (err: any) => err instanceof AIEvalError && err.code === "AI_EVAL_RUN_INVALID",
        `Expected rejection for band ${item.band} with score ${item.score}`,
      );
    }
  } finally {
    f.close();
  }
});

test("Rubric consistency (DB trust boundary): direct DB insert rejects invalid rubric band and score combinations", () => {
  const f = createFixture();
  try {
    const { run, suite, caseRevision, caseResult, judgeRef } = setupStandardRun(f);
    const judgeConfig = f.judgeConfigs.getRevision(judgeRef.id, judgeRef.revision)!;

    const op = f.accounting.createOperation({
      costCenter: "EVALS",
      idempotencyKey: null,
      opaquePrincipalRef: null,
      subjectKey: "biology",
      conversationId: null,
      responseId: null,
      jobId: null,
      evalRunId: run.id,
      knowledgeRevision: null,
      status: "OPEN",
      startedAt: BASE_TIME + 2,
      completedAt: null,
    });

    const execId = uuidv7();
    f.judgeExecutions.create({
      id: execId,
      runId: run.id,
      caseId: caseRevision.caseId,
      caseRevision: caseRevision.revision,
      ordinal: 1,
      subjectKey: "biology",
      judgeConfigId: judgeConfig.judgeConfigId,
      judgeConfigRevision: judgeConfig.revision,
      judgeConfigFingerprint: judgeConfig.fingerprint,
      protocolKey: judgeConfig.protocolKey,
      protocolRevision: judgeConfig.protocolRevision,
      judgeModelConfigId: judgeConfig.modelConfigId,
      judgeModelConfigRevision: judgeConfig.modelConfigRevision,
      judgeProviderConfigId: judgeConfig.providerConfigId,
      judgeProviderConfigRevision: judgeConfig.providerConfigRevision,
      judgeCostOperationId: null,
      budgetReservationId: null,
      status: "PENDING",
      providerInvocationState: "NOT_INVOKED",
      providerInvoked: false,
      judgeOutputSha256: null,
      judgeOutputByteSize: null,
      safeFailureCode: null,
      latencyMs: null,
      createdAt: BASE_TIME + 2,
      startedAt: null,
      completedAt: null,
      updatedAt: BASE_TIME + 2,
    });
    f.judgeExecutions.bindOperation(execId, op.id, BASE_TIME + 3);
    f.judgeExecutions.markRunning(execId, BASE_TIME + 3);
    f.judgeExecutions.markInvokedWithAccounting(execId, BASE_TIME + 4);

    const insertSql = `INSERT INTO ai_eval_judge_results (
      id, judge_execution_id, case_result_id, run_id, case_id, case_revision,
      dimension, judge_config_id, judge_config_revision, protocol_key, protocol_revision,
      judge_model_config_id, judge_model_config_revision, judge_provider_config_id, judge_provider_config_revision,
      score_units, rubric_band, safe_reason_code, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'ARABIC_QUALITY', ?, 1, ?, 1, ?, 1, ?, 1, ?, ?, 'OK', 1000)`;

    assert.throws(
      () => f.database.client.prepare(insertSql).run(
        uuidv7(), execId, caseResult.id, run.id, caseRevision.caseId, caseRevision.revision,
        judgeConfig.judgeConfigId, judgeConfig.protocolKey, judgeConfig.modelConfigId, judgeConfig.providerConfigId, 0, "EXCELLENT",
      ),
      (err: any) => /Eval Judge Result is invalid, unproven, or dimension is not configured as JUDGE_REQUIRED/.test(err.message),
    );

    assert.throws(
      () => f.database.client.prepare(insertSql).run(
        uuidv7(), execId, caseResult.id, run.id, caseRevision.caseId, caseRevision.revision,
        judgeConfig.judgeConfigId, judgeConfig.protocolKey, judgeConfig.modelConfigId, judgeConfig.providerConfigId, 699999, "PASS",
      ),
      (err: any) => /Eval Judge Result is invalid, unproven, or dimension is not configured as JUDGE_REQUIRED/.test(err.message),
    );

    assert.throws(
      () => f.database.client.prepare(insertSql).run(
        uuidv7(), execId, caseResult.id, run.id, caseRevision.caseId, caseRevision.revision,
        judgeConfig.judgeConfigId, judgeConfig.protocolKey, judgeConfig.modelConfigId, judgeConfig.providerConfigId, 900000, "MARGINAL",
      ),
      (err: any) => /Eval Judge Result is invalid, unproven, or dimension is not configured as JUDGE_REQUIRED/.test(err.message),
    );

    assert.throws(
      () => f.database.client.prepare(insertSql).run(
        uuidv7(), execId, caseResult.id, run.id, caseRevision.caseId, caseRevision.revision,
        judgeConfig.judgeConfigId, judgeConfig.protocolKey, judgeConfig.modelConfigId, judgeConfig.providerConfigId, 500000, "FAIL",
      ),
      (err: any) => /Eval Judge Result is invalid, unproven, or dimension is not configured as JUDGE_REQUIRED/.test(err.message),
    );

    assert.throws(
      () => f.database.client.prepare(insertSql).run(
        uuidv7(), execId, caseResult.id, run.id, caseRevision.caseId, caseRevision.revision,
        judgeConfig.judgeConfigId, judgeConfig.protocolKey, judgeConfig.modelConfigId, judgeConfig.providerConfigId, 800000, "UNKNOWN",
      ),
      (err: any) => /Eval Judge Result is invalid, unproven, or dimension is not configured as JUDGE_REQUIRED/.test(err.message),
    );
  } finally {
    f.close();
  }
});

test("Migration 0038: fresh 0000->0038 and populated 0037->0038 migration preserves data and enforces invariants", () => {
  const freshRoot = mkdtempSync(path.join(os.tmpdir(), "pythagoras-m9b2-fresh-"));
  const oldRoot = mkdtempSync(path.join(os.tmpdir(), "pythagoras-m9b2-old-"));
  const oldMigrations = mkdtempSync(path.join(os.tmpdir(), "pythagoras-m9b2-migrations-"));
  let oldDb: ContentDatabase | null = null;
  let upgradedDb: ContentDatabase | null = null;
  try {
    // 1. Fresh DB 0000 -> 0038
    const freshDb = openContentDatabase({ dataDirectory: freshRoot, migrationsDirectory });
    const freshCount = Number(
      (freshDb.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count,
    );
    assert.equal(freshCount, 39);
    freshDb.close();

    // 2. Prepare 0000..0037 directory
    mkdirSync(path.join(oldMigrations, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(path.join(migrationsDirectory, "meta", "_journal.json"), "utf8"));
    const entries0037 = journal.entries.slice(0, 38); // 0..37 is 38 migrations
    for (const entry of entries0037) {
      copyFileSync(path.join(migrationsDirectory, `${entry.tag}.sql`), path.join(oldMigrations, `${entry.tag}.sql`));
      const snapshotName = `${entry.idx.toString().padStart(4, "0")}_snapshot.json`;
      if (existsSync(path.join(migrationsDirectory, "meta", snapshotName))) {
        copyFileSync(path.join(migrationsDirectory, "meta", snapshotName), path.join(oldMigrations, "meta", snapshotName));
      }
    }
    writeFileSync(path.join(oldMigrations, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: entries0037 }));

    // Open populated 0037 database
    oldDb = openContentDatabase({ dataDirectory: oldRoot, migrationsDirectory: oldMigrations });
    const count37 = Number(
      (oldDb.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count,
    );
    assert.equal(count37, 38);

    // Verify 0037 tables exist
    assert.ok(oldDb.client.prepare("select name from sqlite_master where type='table' and name='ai_eval_judge_executions'").get());
    assert.ok(oldDb.client.prepare("select name from sqlite_master where type='table' and name='ai_eval_judge_results'").get());

    oldDb.close();
    oldDb = null;

    // 3. Upgrade to 0038
    upgradedDb = openContentDatabase({ dataDirectory: oldRoot, migrationsDirectory });
    const upgradedCount = Number(
      (upgradedDb.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count,
    );
    assert.equal(upgradedCount, 39);

    // Verify 0038 trigger exists
    const trigger = upgradedDb.client.prepare(
      "select name from sqlite_master where type='trigger' and name='ai_eval_judge_results_insert_valid'",
    ).get() as { name: string } | undefined;
    assert.ok(trigger);
    assert.equal(trigger.name, "ai_eval_judge_results_insert_valid");
  } finally {
    oldDb?.close();
    upgradedDb?.close();
    rmSync(freshRoot, { recursive: true, force: true });
    rmSync(oldRoot, { recursive: true, force: true });
    rmSync(oldMigrations, { recursive: true, force: true });
  }
});
