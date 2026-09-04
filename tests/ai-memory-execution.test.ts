import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../src/server/admin-auth";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import type { AIStudentPrincipal } from "../src/server/ai/conversations";
import { AIConversationService, SQLiteAIConversationRepository } from "../src/server/ai/conversations";
import {
  AIBillingUsageNormalizerRegistry,
  AICostAccountingService,
  AICostCalculator,
  AIRateCardResolver,
  SQLiteAIAccountingRepository,
  SQLiteAIRateCardModelRevisionRepository,
  SQLiteAIRateCardRepository,
} from "../src/server/ai/economics";
import { AIBudgetAdmissionService } from "../src/server/ai/admission";
import { SQLiteAIBudgetPolicyRepository } from "../src/server/ai/budget";
import { SQLiteAIModelConfigRepository } from "../src/server/ai/model-registry";
import { SQLiteAIProviderConfigRepository } from "../src/server/ai/configuration";
import { ProviderAdapterRegistry, AIProviderGateway, type GenerationProviderAdapter, type GenerationProviderRequest, type ProviderAdapterExecutionContext, type ProviderGenerationStreamEvent } from "../src/server/ai/gateway";
import { createLocalAISecretStore } from "../src/server/ai/secrets";
import { SQLiteAIContextPolicyRepository, SQLiteAIInstructionPolicyRepository } from "../src/server/ai/policy";
import { SQLiteAIRateLimitPolicyRepository } from "../src/server/ai/rate-limits";
import { createAIMemoryExecutionJobHandlers, createAIMemoryExecutionOutboxRouters, createAIMemoryExecutionService, createAIMemoryOrchestrator, AIBoundedMemoryGenerationCostEstimator, AIMemoryService, AIMemoryExecutionError, AI_MEMORY_EXECUTION_CONFIG_RESOURCE_TYPE, SQLiteAIMemoryExecutionConfigRepository, SQLiteAIMemoryExecutionRepository, SQLiteAIMemoryPolicyRepository, SQLiteAIConversationSummaryRepository, parseAIMemoryExtractionOutput, type AIMemoryExecutionConfigContent } from "../src/server/ai/memory";
import { createAIAdmissionRequestFingerprint } from "../src/server/ai/admission";
import { AIJobHandlerRegistry, AIJobQueueService } from "../src/server/ai/operations/jobs";
import { AIOutboxRouterRegistry, AIOutboxService } from "../src/server/ai/operations/outbox";
import { AIWorker } from "../src/server/ai/operations/worker";
import { createChangeManagementService } from "../src/server/change-management";
import { SQLiteCanonicalContentRepository } from "../src/server/canonical-content";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const BASE_TIME = 1_910_000_000_000;
const PRINCIPAL: AIStudentPrincipal = { principalRef: "memory-execution-student", status: "ACTIVE" };
const SECRET_KEY = Buffer.alloc(32, 0x49);

class ExtractionAdapter implements GenerationProviderAdapter {
  readonly adapterKey = "test.memory-extraction";
  readonly capability = "GENERATION" as const;
  calls = 0;
  output = JSON.stringify({ candidates: [{ kind: "EXPLANATION_PREFERENCE", text: "Use a worked example before the rule.", confidenceUnits: 950_000 }] });

  async *generate(_request: GenerationProviderRequest, _context: ProviderAdapterExecutionContext): AsyncIterable<ProviderGenerationStreamEvent> {
    this.calls += 1;
    yield { type: "STARTED" };
    yield { type: "TEXT_DELTA", text: this.output };
    yield { type: "COMPLETED", finishReason: "STOP", usage: { inputTokens: 30, outputTokens: 20, reasoningTokens: 0, cacheHitInputTokens: 0, cacheMissInputTokens: 0 } };
  }
}

interface Fixture {
  root: string;
  database: ContentDatabase;
  owner: AdminActor;
  conversations: AIConversationService;
  configs: SQLiteAIMemoryExecutionConfigRepository;
  memoryPolicies: SQLiteAIMemoryPolicyRepository;
  memories: AIMemoryService;
  executions: SQLiteAIMemoryExecutionRepository;
  executionService: ReturnType<typeof createAIMemoryExecutionService>;
  admission: AIBudgetAdmissionService;
  accountingService: AICostAccountingService;
  orchestrator: ReturnType<typeof createAIMemoryOrchestrator>;
  worker: AIWorker;
  outbox: AIOutboxService;
  adapter: ExtractionAdapter;
  generationModelId: string;
  providerId: string;
  memoryPolicyId: string;
  executionConfigId: string;
  close(): void;
}

async function createFixture(candidateReviewRequired = false): Promise<Fixture> {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-memory-execution-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  const canonical = new SQLiteCanonicalContentRepository(database, () => BASE_TIME);
  canonical.bootstrap();
  const identities = new SQLiteAdminIdentityRepository(database);
  const ownerUser = identities.createInitialOwner({ id: uuidv7(), email: `${uuidv7()}@memory-execution.test`, displayName: "Memory Execution Owner", passwordHash: "fixture", createdAt: BASE_TIME });
  const owner = { actorUserId: ownerUser.id, actorRole: "OWNER" as const };
  const secrets = createLocalAISecretStore(database, { masterKey: SECRET_KEY, clock: () => BASE_TIME + 1 });
  const secret = await secrets.create({ secret: "fixture-secret", actor: { type: "ADMIN", actorUserId: ownerUser.id } });
  const providers = new SQLiteAIProviderConfigRepository(database);
  const providerId = uuidv7();
  providers.create({ id: providerId, content: { key: `memory-execution-provider-${uuidv7()}`, displayName: "Memory Execution Provider", baseUrl: "https://provider.invalid", credentialRef: secret.credentialRef, enabled: true, retentionPolicy: "UNKNOWN", trainingPolicy: "UNKNOWN", zdrSupported: false, zdrRequired: false }, actor: owner, now: BASE_TIME + 2 });
  const models = new SQLiteAIModelConfigRepository(database);
  const generationModelId = uuidv7();
  models.create({ id: generationModelId, content: { key: `memory-execution-generation-${uuidv7()}`, displayName: "Memory Generation", providerConfigId: providerId, providerModelId: "fixture-memory-model", capability: "GENERATION", adapterKey: "test.memory-extraction", enabled: true, contextWindowTokens: 20_000, maxOutputTokens: 2_000, embeddingDimensions: null, supportsStreaming: true, supportsReasoning: false, supportsStructuredOutput: true }, actor: owner, now: BASE_TIME + 3 });
  const budgetPolicyId = uuidv7();
  new SQLiteAIBudgetPolicyRepository(database).create({ id: budgetPolicyId, content: { key: `memory-execution-budget-${uuidv7()}`, displayName: "Memory Execution Budget", currency: "USD", costCenter: "STUDENT_GENERATION", hardCapNano: 1_000_000_000, enabled: true }, actor: owner, now: BASE_TIME + 4 });
  const rateLimitPolicyId = uuidv7();
  new SQLiteAIRateLimitPolicyRepository(database).create({ id: rateLimitPolicyId, content: { key: `memory-execution-rate-${uuidv7()}`, displayName: "Memory Execution Rate", windowMs: 60_000, maxRequests: 100, maxConcurrentRequests: 100, enabled: true }, actor: owner, now: BASE_TIME + 5 });
  const rateCards = new SQLiteAIRateCardRepository(database);
  rateCards.create({ id: uuidv7(), content: { key: `memory-execution-card-${uuidv7()}`, displayName: "Memory Execution Card", modelConfigId: generationModelId, modelConfigRevision: 1, currency: "USD", billingUsageNormalizerKey: "memory.execution", effectiveFrom: 0, effectiveTo: null, enabled: true, priceLines: [{ component: "STANDARD_INPUT", unit: "PER_MILLION_TOKENS", amountNano: 1_000_000 }, { component: "OUTPUT", unit: "PER_MILLION_TOKENS", amountNano: 2_000_000 }, { component: "REQUEST", unit: "PER_REQUEST", amountNano: 100 }], timeBands: [] }, actor: owner, now: BASE_TIME + 6 });
  const policies = new SQLiteAIInstructionPolicyRepository(database);
  policies.create({ id: uuidv7(), content: { key: `memory-execution-global-${uuidv7()}`, scope: "GLOBAL", subjectKey: null, displayName: "Global", instructions: "Global", enabled: true }, actor: owner, now: BASE_TIME + 7 });
  const contextPolicy = new SQLiteAIContextPolicyRepository(database);
  contextPolicy.create({ id: uuidv7(), content: { key: `memory-execution-context-${uuidv7()}`, displayName: "Context", softInputBudgetTokens: 10, hardInputBudgetTokens: 100, outputReserveTokens: 10, policyBudgetTokens: 10, summaryBudgetTokens: 10, recentTurnsBudgetTokens: 10, memoryBudgetTokens: 10, evidenceBudgetTokens: 10, maxRecentTurns: 2, enabled: true }, actor: owner, now: BASE_TIME + 8 });
  const memoryPolicies = new SQLiteAIMemoryPolicyRepository(database);
  const memoryPolicyId = uuidv7();
  const changes = createChangeManagementService(database);
  const policyContent = { key: `memory-execution-policy-${uuidv7()}`, subjectKey: "biology", displayName: "Memory Execution Policy", enabled: true, candidateReviewRequired, retentionDays: 365, maxSelectedMemories: 10 };
  publishChange(changes, owner, { resourceType: "ai.memory-policy", resourceId: memoryPolicyId, expectedRevision: 0, operation: "CREATE", desired: policyContent });
  const configs = new SQLiteAIMemoryExecutionConfigRepository(database);
  const executionConfigId = uuidv7();
  const configContent: AIMemoryExecutionConfigContent = { key: `memory-execution-config-${uuidv7()}`, subjectKey: "biology", displayName: "Memory Execution Config", enabled: true, generationModelConfigId: generationModelId, generationModelConfigRevision: 1, generationProviderConfigId: providerId, generationProviderConfigRevision: 1, budgetPolicyId, budgetPolicyRevision: 1, rateLimitPolicyId, rateLimitPolicyRevision: 1, timeoutMs: 5_000, extractionMaxOutputTokens: 100, compactionMaxOutputTokens: 100, maxExtractionCandidates: 5, autoApprovalMinConfidenceUnits: 800_000, compactionTriggerMessageCount: 8, compactionRetainRecentMessageCount: 4 };
  publishChange(changes, owner, { resourceType: AI_MEMORY_EXECUTION_CONFIG_RESOURCE_TYPE, resourceId: executionConfigId, expectedRevision: 0, operation: "CREATE", desired: configContent });
  const adapter = new ExtractionAdapter();
  const gateway = new AIProviderGateway({ providerConfigs: providers, modelConfigs: models, secrets, adapters: new ProviderAdapterRegistry([adapter]) }, { clock: () => BASE_TIME + 100 });
  const accounting = new SQLiteAIAccountingRepository(database);
  const accountingService = new AICostAccountingService({ rateCardResolver: new AIRateCardResolver(rateCards, new SQLiteAIRateCardModelRevisionRepository(database)), billingNormalizers: new AIBillingUsageNormalizerRegistry([{ key: "memory.execution", normalize: (usage) => ({ standardInputTokens: usage.inputTokens, cacheHitInputTokens: usage.cacheHitInputTokens, cacheMissInputTokens: usage.cacheMissInputTokens, outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens, requestUnits: 1 }) }]), costCalculator: new AICostCalculator(), accounting });
  const admission = new AIBudgetAdmissionService(database, { clock: () => BASE_TIME + 100 });
  const conversations = new AIConversationService(database, { clock: () => BASE_TIME + 100 });
  const conversationRepository = new SQLiteAIConversationRepository(database);
  const memoryService = new AIMemoryService(database, { policies: memoryPolicies, conversations: conversationRepository, clock: () => BASE_TIME + 100 });
  const executions = new SQLiteAIMemoryExecutionRepository(database);
  const executionService = createAIMemoryExecutionService({ database, executions, configs, conversations: conversationRepository, memories: memoryService, memoryPolicies, summaries: new SQLiteAIConversationSummaryRepository(database), gateway, accounting: accountingService, admission, costEstimator: new AIBoundedMemoryGenerationCostEstimator(new AIRateCardResolver(rateCards, new SQLiteAIRateCardModelRevisionRepository(database)), providers, new AICostCalculator()), clock: () => BASE_TIME + 100 });
  const handlers = new AIJobHandlerRegistry();
  for (const handler of createAIMemoryExecutionJobHandlers(executionService)) handlers.register(handler);
  const jobs = new AIJobQueueService(database, handlers);
  const routers = new AIOutboxRouterRegistry();
  for (const router of createAIMemoryExecutionOutboxRouters()) routers.register(router);
  const outbox = new AIOutboxService(database, routers, { jobQueue: jobs, clock: () => BASE_TIME + 100 });
  const orchestrator = createAIMemoryOrchestrator({ database, outbox, executions, configs, memoryPolicies, conversations: conversationRepository, clock: () => BASE_TIME + 100 });
  const worker = new AIWorker({ jobs, handlers, outbox, terminalReconciler: executionService, workerId: `memory-worker-${uuidv7()}`, clock: () => BASE_TIME + 100 });
  return { root, database, owner, conversations, configs, memoryPolicies, memories: memoryService, executions, executionService, admission, accountingService, orchestrator, worker, outbox, adapter, generationModelId, providerId, memoryPolicyId, executionConfigId, close() { database.close(); try { rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }); } catch { /* Windows may hold a WAL handle briefly. */ } } };
}

function publishChange(changes: ReturnType<typeof createChangeManagementService>, owner: AdminActor, item: { resourceType: string; resourceId: string; expectedRevision: number; operation: "CREATE" | "UPDATE"; desired: unknown }): void {
  let change = changes.createChangeSet({ title: "Memory execution fixture", initialItem: item }, owner);
  change = changes.submit(change.changeSet.id, change.changeSet.revision, owner);
  change = changes.approve(change.changeSet.id, change.changeSet.revision, owner);
  changes.publish(change.changeSet.id, change.changeSet.revision, owner);
}

function completeTurn(fixture: Fixture, content = "When explaining cell division, show me a diagram.", conversationId?: string) {
  const conversation = conversationId ? fixture.conversations.getConversation(PRINCIPAL, conversationId) : fixture.conversations.createConversation(PRINCIPAL, "biology");
  const turn = fixture.conversations.beginTurn(PRINCIPAL, { conversationId: conversation.id, idempotencyKey: `memory-execution-turn-${uuidv7()}`, userContent: content });
  fixture.conversations.startResponse(PRINCIPAL, turn.response.id);
  fixture.conversations.appendResponseChunk(PRINCIPAL, turn.response.id, 0, "Here is a safe educational answer.");
  fixture.conversations.completeResponse(PRINCIPAL, turn.response.id, "STOP");
  return { conversation, response: turn.response };
}

test("M10B runs the real Outbox to Worker extraction path and applies automatic review policy", async () => {
  const fixture = await createFixture(false);
  try {
    const { response } = completeTurn(fixture);
    const scheduled = fixture.orchestrator.scheduleForCompletedResponse(PRINCIPAL, response.id);
    const repeated = fixture.orchestrator.scheduleForCompletedResponse(PRINCIPAL, response.id);
    assert.equal(repeated.extractionExecutionId, scheduled.extractionExecutionId);
    assert.equal(repeated.extractionOutboxId, scheduled.extractionOutboxId);
    assert.ok(scheduled.extractionExecutionId);
    const outboxRow = fixture.database.client.prepare("select payload_json from ai_outbox_events where id=?").get(scheduled.extractionOutboxId) as { payload_json: string };
    assert.deepEqual(JSON.parse(outboxRow.payload_json), { executionId: scheduled.extractionExecutionId });
    await fixture.worker.runOnce(BASE_TIME + 100);
    const jobRow = fixture.database.client.prepare("select payload_json from ai_jobs where id=?").get(scheduled.extractionExecutionId) as { payload_json: string };
    assert.deepEqual(JSON.parse(jobRow.payload_json), { executionId: scheduled.extractionExecutionId });
    const execution = fixture.executions.getById(scheduled.extractionExecutionId!)!;
    assert.equal(execution.status, "COMPLETED");
    assert.equal(fixture.adapter.calls, 1);
    const link = fixture.executions.listExtractionResults(execution.id)[0]!;
    const memory = fixture.memories.get(PRINCIPAL, link.memoryId, "biology")!;
    assert.equal(memory.status, "APPROVED");
    assert.equal(memory.safeReviewCode, "SYSTEM_AUTO_APPROVED");
    assert.equal(fixture.memories.listEligible(PRINCIPAL, "biology", { at: BASE_TIME + 200 }).length, 1);
    const operation = fixture.database.client.prepare("select cost_center, opaque_principal_ref, conversation_id, response_id, status from ai_cost_operations where id=?").get(execution.costOperationId) as Record<string, unknown>;
    assert.equal(operation.cost_center, "STUDENT_GENERATION");
    assert.equal(operation.opaque_principal_ref, PRINCIPAL.principalRef);
    assert.equal(operation.conversation_id, response.conversationId);
    assert.equal(operation.response_id, response.id);
    assert.equal(operation.status, "COMPLETED");
    const reservation = fixture.database.client.prepare("select status, operation_id from ai_budget_reservations where id=?").get(execution.budgetReservationId) as { status: string; operation_id: string };
    assert.equal(reservation.status, "SETTLED");
    assert.equal(reservation.operation_id, execution.costOperationId);
    const replay = await fixture.executionService.executeJob(execution.id);
    assert.equal(replay.status, "COMPLETED");
    assert.equal(fixture.adapter.calls, 1);
  } finally {
    fixture.close();
  }
});

test("M10B Execution Config revisions remain governed, exact, and append-only", async () => {
  const fixture = await createFixture(false);
  try {
    const current = fixture.configs.getById(fixture.executionConfigId)!;
    assert.throws(() => fixture.database.client.prepare("update ai_memory_execution_configs set key='mutated' where id=?").run(current.id), /immutable|identity/i);
    assert.throws(() => fixture.database.client.prepare("update ai_memory_execution_config_revisions set display_name='mutated' where memory_execution_config_id=?").run(current.id), /append-only|immutable/i);
    assert.throws(() => fixture.database.client.prepare("delete from ai_memory_execution_config_revisions where memory_execution_config_id=?").run(current.id), /append-only|immutable/i);
    const appended = fixture.configs.appendRevision({ id: current.id, expectedRevision: 1, content: { key: current.key, subjectKey: current.subjectKey, displayName: "Memory Execution v2", enabled: true, generationModelConfigId: current.generationModelConfigId, generationModelConfigRevision: current.generationModelConfigRevision, generationProviderConfigId: current.generationProviderConfigId, generationProviderConfigRevision: current.generationProviderConfigRevision, budgetPolicyId: current.budgetPolicyId, budgetPolicyRevision: current.budgetPolicyRevision, rateLimitPolicyId: current.rateLimitPolicyId, rateLimitPolicyRevision: current.rateLimitPolicyRevision, timeoutMs: current.timeoutMs, extractionMaxOutputTokens: current.extractionMaxOutputTokens, compactionMaxOutputTokens: current.compactionMaxOutputTokens, maxExtractionCandidates: current.maxExtractionCandidates, autoApprovalMinConfidenceUnits: current.autoApprovalMinConfidenceUnits, compactionTriggerMessageCount: current.compactionTriggerMessageCount, compactionRetainRecentMessageCount: current.compactionRetainRecentMessageCount }, actor: fixture.owner, now: BASE_TIME + 600 });
    assert.equal(appended.revision, 2);
    assert.equal(fixture.configs.getRevision(current.id, 1)!.displayName, current.displayName);
    assert.equal(fixture.configs.getById(current.id)!.currentRevision, 2);
    assert.throws(() => fixture.database.client.prepare("update ai_memory_execution_configs set current_revision=1 where id=?").run(current.id), /advance|revision/i);
    assert.throws(() => fixture.database.client.prepare("update ai_memory_execution_configs set current_revision=4 where id=?").run(current.id), /advance|revision/i);
  } finally {
    fixture.close();
  }
});

test("M10B keeps a review-required extraction as a non-eligible Candidate", async () => {
  const fixture = await createFixture(true);
  try {
    const { response } = completeTurn(fixture);
    const scheduled = fixture.orchestrator.scheduleForCompletedResponse(PRINCIPAL, response.id);
    await fixture.worker.runOnce(BASE_TIME + 100);
    const link = fixture.executions.listExtractionResults(scheduled.extractionExecutionId!) [0]!;
    const memory = fixture.memories.get(PRINCIPAL, link.memoryId, "biology")!;
    assert.equal(memory.status, "CANDIDATE");
    assert.equal(fixture.memories.listEligible(PRINCIPAL, "biology", { at: BASE_TIME + 200 }).length, 0);
  } finally {
    fixture.close();
  }
});

test("M10B strict extraction parser rejects unknown kinds, duplicate candidates, and extra fields", () => {
  assert.throws(() => parseAIMemoryExtractionOutput(JSON.stringify({ candidates: [{ kind: "PERSONAL_FACT", text: "x", confidenceUnits: 1 }] }), 5), (error: unknown) => error instanceof AIMemoryExecutionError && error.code === "AI_MEMORY_EXECUTION_PROTOCOL_INVALID");
  assert.throws(() => parseAIMemoryExtractionOutput(JSON.stringify({ candidates: [{ kind: "STUDY_GOAL", text: "x", confidenceUnits: 1 }, { kind: "STUDY_GOAL", text: "x", confidenceUnits: 2 }] }), 5), (error: unknown) => error instanceof AIMemoryExecutionError && error.code === "AI_MEMORY_EXECUTION_PROTOCOL_INVALID");
  assert.throws(() => parseAIMemoryExtractionOutput(JSON.stringify({ candidates: [{ kind: "STUDY_GOAL", text: "x", confidenceUnits: 1, rationale: "no" }] }), 5), (error: unknown) => error instanceof AIMemoryExecutionError && error.code === "AI_MEMORY_EXECUTION_PROTOCOL_INVALID");
});

test("M10B deterministic extraction privacy gate covers Arabic and English personal-sensitive phrasing", () => {
  const rejected = [
    "أنا مصاب بمرض السكري",
    "تم تشخيصي باضطراب القلق",
    "ديانتي خاصة بي",
    "أنا أنتمي إلى حزب سياسي",
    "رقم بطاقتي هو 1234",
    "كلمة المرور الخاصة بي هي secret",
    "أسكن في العنوان المذكور",
    "اليوم أكره الأحياء",
    "I am diabetic",
    "I was diagnosed with anxiety",
    "My religion is private",
    "I belong to a political party",
    "My credit card number is private",
    "My password is secret",
    "I live in a private address",
    "Today I hate biology",
  ];
  for (const text of rejected) assert.throws(() => parseAIMemoryExtractionOutput(JSON.stringify({ candidates: [{ kind: "LEARNING_DIFFICULTY", text, confidenceUnits: 950_000 }] }), 5), (error: unknown) => error instanceof AIMemoryExecutionError && error.code === "AI_MEMORY_EXECUTION_PROTOCOL_INVALID");
  const accepted = [
    "أفضل أن يبدأ شرح الرياضيات بمثال",
    "أخلط بين الطور الاستوائي والطور الانفصالي",
    "أواجه صعوبة في فهم موضوع مرض السكري في الأحياء",
    "I prefer an example before the rule",
    "I confuse metaphase and anaphase",
    "I struggle understanding diabetes in biology",
    "My study goal is to review cells weekly",
  ];
  for (const text of accepted) assert.equal(parseAIMemoryExtractionOutput(JSON.stringify({ candidates: [{ kind: "LEARNING_DIFFICULTY", text, confidenceUnits: 950_000 }] }), 5).candidates.length, 1);
});

test("M10B compaction uses an exact bounded cutoff and preserves M4 history", async () => {
  const fixture = await createFixture(false);
  try {
    let last = completeTurn(fixture, "turn one");
    completeTurn(fixture, "turn two", last.conversation.id);
    completeTurn(fixture, "turn three", last.conversation.id);
    last = completeTurn(fixture, "turn four", last.conversation.id);
    fixture.adapter.output = JSON.stringify({ summary: "The Student prefers worked examples for biology." });
    const scheduled = fixture.orchestrator.scheduleForCompletedResponse(PRINCIPAL, last.response.id);
    assert.ok(scheduled.compactionExecutionId);
    await fixture.worker.runOnce(BASE_TIME + 100);
    await fixture.worker.runOnce(BASE_TIME + 100);
    const execution = fixture.executions.getById(scheduled.compactionExecutionId!)!;
    assert.equal(execution.status, "COMPLETED");
    assert.equal(execution.targetCutoffOrdinal, 4);
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_conversation_summary_revisions where conversation_id=? and status='ACTIVE'").get(last.conversation.id) as { count: number }).count, 1);
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_conversation_messages where conversation_id=?").get(last.conversation.id) as { count: number }).count, 8);
  } finally {
    fixture.close();
  }
});

test("M10B SYSTEM_AUTO_APPROVED is rejected for an exact Policy revision requiring Student review", async () => {
  const fixture = await createFixture(true);
  try {
    const { response } = completeTurn(fixture);
    const scheduled = fixture.orchestrator.scheduleForCompletedResponse(PRINCIPAL, response.id);
    await fixture.worker.runOnce(BASE_TIME + 100);
    const link = fixture.executions.listExtractionResults(scheduled.extractionExecutionId!)[0]!;
    assert.throws(() => fixture.database.client.prepare("update ai_memories set status='APPROVED', reviewed_at=?, safe_review_code='SYSTEM_AUTO_APPROVED' where id=?").run(BASE_TIME + 300, link.memoryId), /lifecycle|invalid|review|automatic|execution/i);
  } finally {
    fixture.close();
  }
});

test("M10B SYSTEM_AUTO_APPROVED is rejected for an unlinked Candidate even when Policy permits automation", async () => {
  const fixture = await createFixture(false);
  try {
    const { conversation } = completeTurn(fixture);
    const candidate = fixture.memories.createCandidate(PRINCIPAL, { conversationId: conversation.id, subjectKey: "biology", kind: "STUDY_GOAL", text: "Keep a weekly study plan.", confidenceUnits: 950_000, sourceStartOrdinal: 1, sourceEndOrdinal: 2, now: BASE_TIME + 200 });
    assert.throws(() => fixture.database.client.prepare("update ai_memories set status='APPROVED', reviewed_at=?, safe_review_code='SYSTEM_AUTO_APPROVED' where id=?").run(BASE_TIME + 300, candidate.id), /automatic|execution|lifecycle|invalid/i);
    assert.equal(fixture.memories.get(PRINCIPAL, candidate.id, "biology")!.status, "CANDIDATE");
  } finally {
    fixture.close();
  }
});

test("M10B result links require proven invocation and exact source ownership at SQLite", async () => {
  const fixture = await createFixture(false);
  try {
    const { conversation, response } = completeTurn(fixture);
    const scheduled = fixture.orchestrator.scheduleForCompletedResponse(PRINCIPAL, response.id);
    const candidate = fixture.memories.createCandidate(PRINCIPAL, { conversationId: conversation.id, subjectKey: "biology", kind: "STUDY_GOAL", text: "Keep a weekly study plan.", confidenceUnits: 950_000, sourceStartOrdinal: 1, sourceEndOrdinal: 2, now: BASE_TIME + 200 });
    assert.throws(() => fixture.database.client.prepare("insert into ai_memory_execution_memory_links (execution_id,ordinal,memory_id) values (?,?,?)").run(scheduled.extractionExecutionId, 1, candidate.id), /ownership|invocation|invalid|execution/i);
    assert.equal(fixture.executions.listExtractionResults(scheduled.extractionExecutionId!).length, 0);
  } finally {
    fixture.close();
  }
});

test("M10B deletion before the Worker resolves to INPUT_LOST without Provider work", async () => {
  const fixture = await createFixture(false);
  try {
    const { conversation, response } = completeTurn(fixture, "PRIVATE_M10B_SOURCE_DELETE_RACE");
    const scheduled = fixture.orchestrator.scheduleForCompletedResponse(PRINCIPAL, response.id);
    fixture.conversations.deleteConversation(PRINCIPAL, conversation.id);
    await fixture.worker.runOnce(BASE_TIME + 100);
    const execution = fixture.executions.getById(scheduled.extractionExecutionId!)!;
    assert.equal(execution.status, "INPUT_LOST");
    assert.equal(execution.providerInvoked, false);
    assert.equal(fixture.adapter.calls, 0);
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_memories where source_conversation_id=? and status <> 'DELETED'").get(conversation.id) as { count: number }).count, 0);
  } finally {
    fixture.close();
  }
});

test("M10B leaves a low-confidence educational candidate pending automatic review", async () => {
  const fixture = await createFixture(false);
  try {
    fixture.adapter.output = JSON.stringify({ candidates: [{ kind: "LEARNING_DIFFICULTY", text: "I confuse the two stages.", confidenceUnits: 700_000 }] });
    const { response } = completeTurn(fixture);
    const scheduled = fixture.orchestrator.scheduleForCompletedResponse(PRINCIPAL, response.id);
    await fixture.worker.runOnce(BASE_TIME + 100);
    const link = fixture.executions.listExtractionResults(scheduled.extractionExecutionId!)[0]!;
    const memory = fixture.memories.get(PRINCIPAL, link.memoryId, "biology")!;
    assert.equal(memory.status, "CANDIDATE");
    assert.equal(memory.safeReviewCode, null);
    assert.throws(() => fixture.database.client.prepare("update ai_memories set status='APPROVED', reviewed_at=?, safe_review_code='SYSTEM_AUTO_APPROVED' where id=?").run(BASE_TIME + 300, memory.id), /automatic|execution|lifecycle|invalid/i);
    assert.throws(() => fixture.database.client.prepare("update ai_memories set memory_policy_revision=999, status='APPROVED', reviewed_at=?, safe_review_code='SYSTEM_AUTO_APPROVED' where id=?").run(BASE_TIME + 300, memory.id), /automatic|execution|lifecycle|invalid/i);
    assert.equal(fixture.adapter.calls, 1);
  } finally {
    fixture.close();
  }
});

test("M10B refuses an Arabic personal-health extraction before any Memory row is stored", async () => {
  const fixture = await createFixture(false);
  try {
    fixture.adapter.output = JSON.stringify({ candidates: [{ kind: "LEARNING_DIFFICULTY", text: "أنا مصاب بمرض السكري", confidenceUnits: 950_000 }] });
    const { response } = completeTurn(fixture);
    const scheduled = fixture.orchestrator.scheduleForCompletedResponse(PRINCIPAL, response.id);
    await fixture.worker.runOnce(BASE_TIME + 100);
    const execution = fixture.executions.getById(scheduled.extractionExecutionId!)!;
    assert.equal(execution.status, "FAILED");
    assert.equal(execution.providerInvoked, true);
    assert.equal(fixture.executions.listExtractionResults(execution.id).length, 0);
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_memories where source_conversation_id=?").get(response.conversationId) as { count: number }).count, 0);
  } finally {
    fixture.close();
  }
});

test("M10B keeps source/output markers out of durable operational metadata", async () => {
  const fixture = await createFixture(false);
  try {
    const sourceMarker = "PRIVATE_M10B_SOURCE_91";
    const outputMarker = "PRIVATE_M10B_CANDIDATE_92";
    fixture.adapter.output = JSON.stringify({ candidates: [{ kind: "STUDY_GOAL", text: outputMarker, confidenceUnits: 900_000 }] });
    const { response } = completeTurn(fixture, sourceMarker);
    const scheduled = fixture.orchestrator.scheduleForCompletedResponse(PRINCIPAL, response.id);
    await fixture.worker.runOnce(BASE_TIME + 100);
    const rows = [
      fixture.database.client.prepare("select payload_json from ai_jobs where id=?").get(scheduled.extractionExecutionId),
      fixture.database.client.prepare("select payload_json from ai_outbox_events where id=?").get(scheduled.extractionOutboxId),
      fixture.database.client.prepare("select * from ai_memory_executions where id=?").get(scheduled.extractionExecutionId),
      fixture.database.client.prepare("select * from ai_cost_operations where id=?").get(fixture.executions.getById(scheduled.extractionExecutionId!)!.costOperationId),
    ];
    const serialized = JSON.stringify(rows);
    assert.equal(serialized.includes(sourceMarker), false);
    assert.equal(serialized.includes(outputMarker), false);
    assert.equal(fixture.conversations.listMessages(PRINCIPAL, response.conversationId).some((message) => message.content === sourceMarker), true);
  } finally {
    fixture.close();
  }
});

test("M10B 0041 to 0042 preserves populated M10A rows and adds trust triggers", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-memory-0041-upgrade-"));
  const oldMigrations = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-memory-0041-migrations-"));
  let oldDatabase: ContentDatabase | null = null;
  let upgraded: ContentDatabase | null = null;
  try {
    mkdirSync(path.join(oldMigrations, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(path.join(migrationsDirectory, "meta", "_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }> };
    const entries = journal.entries.slice(0, 42);
    for (const entry of entries) {
      copyFileSync(path.join(migrationsDirectory, `${entry.tag}.sql`), path.join(oldMigrations, `${entry.tag}.sql`));
      const snapshot = `${entry.idx.toString().padStart(4, "0")}_snapshot.json`;
      if (existsSync(path.join(migrationsDirectory, "meta", snapshot))) copyFileSync(path.join(migrationsDirectory, "meta", snapshot), path.join(oldMigrations, "meta", snapshot));
    }
    writeFileSync(path.join(oldMigrations, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
    oldDatabase = openContentDatabase({ dataDirectory: root, migrationsDirectory: oldMigrations });
    assert.equal((oldDatabase.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count, 42);
    const canonical = new SQLiteCanonicalContentRepository(oldDatabase, () => BASE_TIME);
    canonical.bootstrap();
    const identities = new SQLiteAdminIdentityRepository(oldDatabase);
    const ownerUser = identities.createInitialOwner({ id: uuidv7(), email: `${uuidv7()}@memory-upgrade.test`, displayName: "Upgrade Owner", passwordHash: "fixture", createdAt: BASE_TIME });
    const policyId = uuidv7();
    oldDatabase.client.prepare("insert into ai_memory_policies (id,key,subject_key,current_revision,created_at,updated_at,created_by,updated_by) values (?,?,?,?,?,?,?,?)").run(policyId, `upgrade-policy-${uuidv7()}`, "biology", 1, BASE_TIME + 1, BASE_TIME + 1, ownerUser.id, ownerUser.id);
    oldDatabase.client.prepare("insert into ai_memory_policy_revisions (id,memory_policy_id,revision,display_name,enabled,candidate_review_required,retention_days,max_selected_memories,created_at,created_by) values (?,?,?,?,?,?,?,?,?,?)").run(uuidv7(), policyId, 1, "Upgrade Policy", 1, 1, 365, 10, BASE_TIME + 1, ownerUser.id);
    const conversation = new AIConversationService(oldDatabase, { clock: () => BASE_TIME + 2 }).createConversation(PRINCIPAL, "biology");
    const turn = new AIConversationService(oldDatabase, { clock: () => BASE_TIME + 3 }).beginTurn(PRINCIPAL, { conversationId: conversation.id, idempotencyKey: `upgrade-${uuidv7()}`, userContent: "upgrade source" });
    const conversations = new AIConversationService(oldDatabase, { clock: () => BASE_TIME + 4 });
    conversations.startResponse(PRINCIPAL, turn.response.id);
    conversations.appendResponseChunk(PRINCIPAL, turn.response.id, 0, "upgrade answer");
    conversations.completeResponse(PRINCIPAL, turn.response.id, "STOP");
    oldDatabase.client.prepare("insert into ai_memories (id,principal_ref,subject_key,memory_policy_id,memory_policy_revision,revision,status,visibility_scope,creation_origin,source_conversation_id,source_start_ordinal,source_end_ordinal,memory_text,confidence_units,created_at,reviewed_at,deleted_at,expires_at,safe_review_code) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(uuidv7(), PRINCIPAL.principalRef, "biology", policyId, 1, 1, "CANDIDATE", "PRINCIPAL_SUBJECT", "CONVERSATION", conversation.id, 1, 2, "UPGRADE_MEMORY", 500_000, BASE_TIME + 10, null, null, BASE_TIME + 10 + 365 * 86_400_000, null);
    oldDatabase.close();
    oldDatabase = null;
    upgraded = openContentDatabase({ dataDirectory: root, migrationsDirectory });
    assert.equal((upgraded.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count, 43);
    assert.equal((upgraded.client.prepare("select count(*) as count from ai_memory_execution_configs").get() as { count: number }).count, 0);
    assert.deepEqual(upgraded.client.prepare("select kind,memory_text from ai_memories").get(), { kind: null, memory_text: "UPGRADE_MEMORY" });
    for (const trigger of ["ai_memories_no_delete", "ai_memory_execution_config_revisions_no_update", "ai_memory_execution_memory_links_insert_valid", "ai_memory_execution_memory_links_exact_owner", "ai_memories_system_auto_approved_valid", "ai_memory_executions_result_commit_valid"]) assert.ok(upgraded.client.prepare("select name from sqlite_master where type='trigger' and name=?").get(trigger));
  } finally {
    oldDatabase?.close();
    upgraded?.close();
    try { rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }); } catch { /* Windows may hold a WAL handle briefly. */ }
    try { rmSync(oldMigrations, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }); } catch { /* Windows may hold a WAL handle briefly. */ }
  }
});

test("M10B accounts an invoked malformed extraction response before terminal failure", async () => {
  const fixture = await createFixture(false);
  try {
    fixture.adapter.output = "not-json";
    const { response } = completeTurn(fixture);
    const scheduled = fixture.orchestrator.scheduleForCompletedResponse(PRINCIPAL, response.id);
    await fixture.worker.runOnce(BASE_TIME + 100);
    const execution = fixture.executions.getById(scheduled.extractionExecutionId!)!;
    assert.equal(execution.status, "FAILED");
    assert.equal(execution.providerInvoked, true);
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_usage_cost_records where operation_id=?").get(execution.costOperationId) as { count: number }).count, 1);
    assert.equal((fixture.database.client.prepare("select status from ai_cost_operations where id=?").get(execution.costOperationId) as { status: string }).status, "FAILED");
    assert.equal((fixture.database.client.prepare("select status from ai_budget_reservations where id=?").get(execution.budgetReservationId) as { status: string }).status, "SETTLED");
    assert.equal(fixture.executions.listExtractionResults(execution.id).length, 0);
  } finally {
    fixture.close();
  }
});

test("M10B preserves the exact historical review decision after a later Policy revision", async () => {
  const fixture = await createFixture(false);
  try {
    const { response } = completeTurn(fixture);
    const scheduled = fixture.orchestrator.scheduleForCompletedResponse(PRINCIPAL, response.id);
    await fixture.worker.runOnce(BASE_TIME + 100);
    const link = fixture.executions.listExtractionResults(scheduled.extractionExecutionId!)[0]!;
    const before = fixture.memories.get(PRINCIPAL, link.memoryId, "biology")!;
    assert.equal(before.memoryPolicyRevision, 1);
    assert.equal(before.safeReviewCode, "SYSTEM_AUTO_APPROVED");
    fixture.memoryPolicies.appendRevision({ id: fixture.memoryPolicyId, expectedRevision: 1, content: { key: fixture.memoryPolicies.getById(fixture.memoryPolicyId)!.key, subjectKey: "biology", displayName: "Review required later", enabled: true, candidateReviewRequired: true, retentionDays: 365, maxSelectedMemories: 10 }, actor: fixture.owner, now: BASE_TIME + 400 });
    const after = fixture.memories.get(PRINCIPAL, link.memoryId, "biology")!;
    assert.equal(after.memoryPolicyRevision, 1);
    assert.equal(after.safeReviewCode, "SYSTEM_AUTO_APPROVED");
    assert.equal(fixture.memories.listEligible(PRINCIPAL, "biology", { at: BASE_TIME + 500 }).some((memory) => memory.memoryId === link.memoryId), true);
  } finally {
    fixture.close();
  }
});

test("M10B automatic Memories follow the existing Conversation deletion scrub", async () => {
  const fixture = await createFixture(false);
  try {
    const { conversation, response } = completeTurn(fixture, "private educational preference");
    const scheduled = fixture.orchestrator.scheduleForCompletedResponse(PRINCIPAL, response.id);
    await fixture.worker.runOnce(BASE_TIME + 100);
    const memoryId = fixture.executions.listExtractionResults(scheduled.extractionExecutionId!)[0]!.memoryId;
    assert.equal(fixture.memories.get(PRINCIPAL, memoryId, "biology")!.status, "APPROVED");
    fixture.conversations.deleteConversation(PRINCIPAL, conversation.id);
    const deleted = fixture.memories.get(PRINCIPAL, memoryId, "biology")!;
    assert.equal(deleted.status, "DELETED");
    assert.equal(deleted.memoryText, null);
    assert.equal(deleted.safeReviewCode, "CONVERSATION_DELETED");
  } finally {
    fixture.close();
  }
});

test("M10B terminal execution replay repairs an open Operation and EXECUTING Reservation", async () => {
  const fixture = await createFixture(false);
  try {
    const { response } = completeTurn(fixture);
    const scheduled = fixture.orchestrator.scheduleForCompletedResponse(PRINCIPAL, response.id);
    await fixture.worker.runOnce(BASE_TIME + 100);
    const before = fixture.executions.getById(scheduled.extractionExecutionId!)!;
    const memoryCount = (fixture.database.client.prepare("select count(*) as count from ai_memories where source_conversation_id=?").get(response.conversationId) as { count: number }).count;
    fixture.database.client.prepare("update ai_cost_operations set status='OPEN', completed_at=null where id=?").run(before.costOperationId);
    fixture.database.client.prepare("update ai_budget_reservations set status='EXECUTING', finalized_at=null, overage_nano=null where id=?").run(before.budgetReservationId);
    const replay = await fixture.executionService.executeJob(before.id);
    assert.equal(replay.status, "COMPLETED");
    assert.equal(fixture.adapter.calls, 1);
    assert.equal((fixture.database.client.prepare("select status from ai_cost_operations where id=?").get(before.costOperationId) as { status: string }).status, "COMPLETED");
    assert.equal((fixture.database.client.prepare("select status from ai_budget_reservations where id=?").get(before.budgetReservationId) as { status: string }).status, "SETTLED");
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_memories where source_conversation_id=?").get(response.conversationId) as { count: number }).count, memoryCount);
  } finally {
    fixture.close();
  }
});

test("M10B re-entry after Provider/accounting before result commit becomes AMBIGUOUS without an artifact", async () => {
  const fixture = await createFixture(false);
  try {
    const { response } = completeTurn(fixture);
    const scheduled = fixture.orchestrator.scheduleForCompletedResponse(PRINCIPAL, response.id);
    const execution = fixture.executions.getById(scheduled.extractionExecutionId!)!;
    const config = fixture.configs.getById(fixture.executionConfigId)!;
    const operation = fixture.accountingService.createOperation({ costCenter: "STUDENT_GENERATION", idempotencyKey: null, opaquePrincipalRef: PRINCIPAL.principalRef, subjectKey: "biology", conversationId: response.conversationId, responseId: response.id, jobId: null, evalRunId: null, knowledgeRevision: null, status: "OPEN", startedAt: BASE_TIME + 100, completedAt: null }, execution.id);
    const periodStart = new Date(BASE_TIME + 100);
    const budgetPeriod = { startAt: Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), periodStart.getUTCDate()), endAt: Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), periodStart.getUTCDate()) + 86_400_000 };
    const admissionBase = { principalRef: PRINCIPAL.principalRef, budgetPolicyId: config.budgetPolicyId, budgetPolicyRevision: config.budgetPolicyRevision, rateLimitPolicyId: config.rateLimitPolicyId, rateLimitPolicyRevision: config.rateLimitPolicyRevision, budgetPeriod, costOperationId: operation.id, costEstimate: { currency: "USD", maxCostNano: 10_000, estimateBasis: "crash-fixture" }, idempotencyKey: `crash-admission-${execution.id}` };
    const admission = fixture.admission.admit({ ...admissionBase, requestFingerprint: createAIAdmissionRequestFingerprint(admissionBase) });
    fixture.admission.startExecution(admission.reservation.id, BASE_TIME + 101);
    fixture.accountingService.recordAttempt({ operationId: operation.id, attempt: { gatewayRequestId: execution.id, capability: "GENERATION", attemptIndex: 0, modelConfigId: fixture.generationModelId, modelConfigRevision: 1, providerConfigId: fixture.providerId, providerConfigRevision: 1, adapterKey: "test.memory-extraction", providerModelId: "fixture-memory-model", startedAt: BASE_TIME + 100, completedAt: BASE_TIME + 101, latencyMs: 1, status: "SUCCEEDED", providerInvoked: true }, normalizedUsage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 0, cacheHitInputTokens: 0, cacheMissInputTokens: 0 }, capability: "GENERATION", providerModelId: "fixture-memory-model", at: BASE_TIME + 100 });
    fixture.executions.bindCostOperation(execution.id, operation.id, BASE_TIME + 102);
    fixture.executions.bindReservation(execution.id, admission.reservation.id, BASE_TIME + 102);
    fixture.database.client.prepare("update ai_memory_executions set status='RUNNING', provider_invocation_state='INVOKED_WITH_ACCOUNTING', provider_invoked=1, started_at=? where id=?").run(BASE_TIME + 103, execution.id);
    const result = await fixture.executionService.executeJob(execution.id);
    assert.equal(result.status, "AMBIGUOUS");
    assert.equal(fixture.adapter.calls, 0);
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_memories where source_conversation_id=?").get(response.conversationId) as { count: number }).count, 0);
    assert.equal(fixture.executions.listExtractionResults(execution.id).length, 0);
    assert.equal((fixture.database.client.prepare("select status from ai_cost_operations where id=?").get(operation.id) as { status: string }).status, "FAILED");
    assert.equal((fixture.database.client.prepare("select status from ai_budget_reservations where id=?").get(admission.reservation.id) as { status: string }).status, "SETTLED");
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_usage_cost_records where operation_id=?").get(operation.id) as { count: number }).count, 1);
  } finally {
    fixture.close();
  }
});

test("M10B rolls back the entire extraction result when completion fails", async () => {
  const fixture = await createFixture(false);
  try {
    fixture.adapter.output = JSON.stringify({ candidates: [
      { kind: "STUDY_GOAL", text: "Keep a weekly study plan.", confidenceUnits: 950_000 },
      { kind: "LEARNING_DIFFICULTY", text: "I confuse the two stages.", confidenceUnits: 950_000 },
    ] });
    const { response } = completeTurn(fixture);
    const scheduled = fixture.orchestrator.scheduleForCompletedResponse(PRINCIPAL, response.id);
    const repository = fixture.executions as unknown as { complete: (...args: never[]) => never };
    repository.complete = () => { throw new Error("fault-injected execution completion failure"); };
    await fixture.worker.runOnce(BASE_TIME + 100);
    const execution = fixture.executions.getById(scheduled.extractionExecutionId!)!;
    assert.equal(execution.status, "FAILED");
    assert.equal(fixture.adapter.calls, 1);
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_memories where source_conversation_id=?").get(response.conversationId) as { count: number }).count, 0);
    assert.equal(fixture.executions.listExtractionResults(execution.id).length, 0);
  } finally {
    fixture.close();
  }
});

test("M10B rolls back a Summary when compaction completion fails", async () => {
  const fixture = await createFixture(false);
  try {
    let last = completeTurn(fixture, "one");
    completeTurn(fixture, "two", last.conversation.id);
    completeTurn(fixture, "three", last.conversation.id);
    last = completeTurn(fixture, "four", last.conversation.id);
    fixture.adapter.output = JSON.stringify({ summary: "The Student prefers worked examples." });
    const scheduled = fixture.orchestrator.scheduleForCompletedResponse(PRINCIPAL, last.response.id);
    await fixture.worker.runOnce(BASE_TIME + 100);
    const repository = fixture.executions as unknown as { complete: (...args: never[]) => never };
    repository.complete = () => { throw new Error("fault-injected compaction completion failure"); };
    await fixture.worker.runOnce(BASE_TIME + 100);
    const execution = fixture.executions.getById(scheduled.compactionExecutionId!)!;
    assert.equal(execution.status, "FAILED");
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_conversation_summary_revisions where conversation_id=? and status='ACTIVE'").get(last.conversation.id) as { count: number }).count, 0);
    assert.equal(fixture.adapter.calls, 2);
  } finally {
    fixture.close();
  }
});
