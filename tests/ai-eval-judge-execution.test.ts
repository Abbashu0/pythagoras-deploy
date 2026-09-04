import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
import {
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
  const key = `eval-judge-${id.slice(0, 8)}`;
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
