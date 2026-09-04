import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../src/server/admin-auth";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import { AIConversationService, SQLiteAIConversationRepository, type AIStudentPrincipal } from "../src/server/ai/conversations";
import { AIBillingUsageNormalizerRegistry, AICostAccountingService, AICostCalculator, AIRateCardResolver, SQLiteAIAccountingRepository, SQLiteAIRateCardModelRevisionRepository, SQLiteAIRateCardRepository } from "../src/server/ai/economics";
import { AIBudgetAdmissionService } from "../src/server/ai/admission";
import { SQLiteAIBudgetPolicyRepository } from "../src/server/ai/budget";
import { ProviderAdapterRegistry, AIProviderGateway, type GenerationProviderAdapter, type GenerationProviderRequest, type ProviderAdapterExecutionContext, type ProviderGenerationStreamEvent } from "../src/server/ai/gateway";
import { SQLiteAIModelConfigRepository } from "../src/server/ai/model-registry";
import { SQLiteAIProviderConfigRepository } from "../src/server/ai/configuration";
import { createLocalAISecretStore } from "../src/server/ai/secrets";
import { SQLiteAIContextPolicyRepository, SQLiteAIInstructionPolicyRepository } from "../src/server/ai/policy";
import { SQLiteAIRateLimitPolicyRepository } from "../src/server/ai/rate-limits";
import { AIMemoryService, SQLiteAIMemoryExecutionConfigRepository, SQLiteAIMemoryExecutionRepository, SQLiteAIConversationSummaryRepository, createAIMemoryExecutionJobHandlers, createAIMemoryExecutionOutboxRouters, createAIMemoryExecutionService, createAIMemoryOrchestrator, AIBoundedMemoryGenerationCostEstimator, AI_MEMORY_EXECUTION_CONFIG_RESOURCE_TYPE, type AIMemoryExecutionConfigContent } from "../src/server/ai/memory";
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

class CompactionAdapter implements GenerationProviderAdapter {
  readonly adapterKey = "test.memory-compaction";
  readonly capability = "GENERATION" as const;
  calls = 0;

  async *generate(_request: GenerationProviderRequest, _context: ProviderAdapterExecutionContext): AsyncIterable<ProviderGenerationStreamEvent> {
    this.calls += 1;
    yield { type: "STARTED" };
    yield { type: "TEXT_DELTA", text: JSON.stringify({ summary: "The Student prefers worked examples for biology." }) };
    yield { type: "COMPLETED", finishReason: "STOP", usage: { inputTokens: 30, outputTokens: 20, reasoningTokens: 0, cacheHitInputTokens: 0, cacheMissInputTokens: 0 } };
  }
}

interface Fixture {
  database: ContentDatabase;
  root: string;
  owner: AdminActor;
  conversations: AIConversationService;
  configs: SQLiteAIMemoryExecutionConfigRepository;
  executions: SQLiteAIMemoryExecutionRepository;
  orchestrator: ReturnType<typeof createAIMemoryOrchestrator>;
  worker: AIWorker;
  adapter: CompactionAdapter;
  close(): void;
}

async function createFixture(): Promise<Fixture> {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-memory-execution-cutover-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  new SQLiteCanonicalContentRepository(database, () => BASE_TIME).bootstrap();
  const ownerUser = new SQLiteAdminIdentityRepository(database).createInitialOwner({ id: uuidv7(), email: `${uuidv7()}@memory-cutover.test`, displayName: "Memory Owner", passwordHash: "fixture", createdAt: BASE_TIME });
  const owner = { actorUserId: ownerUser.id, actorRole: "OWNER" as const };
  const secrets = createLocalAISecretStore(database, { masterKey: SECRET_KEY, clock: () => BASE_TIME + 1 });
  const secret = await secrets.create({ secret: "fixture-secret", actor: { type: "ADMIN", actorUserId: ownerUser.id } });
  const providers = new SQLiteAIProviderConfigRepository(database);
  const providerId = uuidv7();
  providers.create({ id: providerId, content: { key: `memory-cutover-provider-${uuidv7()}`, displayName: "Memory Provider", baseUrl: "https://provider.invalid", credentialRef: secret.credentialRef, enabled: true, retentionPolicy: "UNKNOWN", trainingPolicy: "UNKNOWN", zdrSupported: false, zdrRequired: false }, actor: owner, now: BASE_TIME + 2 });
  const models = new SQLiteAIModelConfigRepository(database);
  const modelId = uuidv7();
  const adapter = new CompactionAdapter();
  models.create({ id: modelId, content: { key: `memory-cutover-model-${uuidv7()}`, displayName: "Memory Compaction", providerConfigId: providerId, providerModelId: "fixture-memory-model", capability: "GENERATION", adapterKey: adapter.adapterKey, enabled: true, contextWindowTokens: 20_000, maxOutputTokens: 2_000, embeddingDimensions: null, supportsStreaming: true, supportsReasoning: false, supportsStructuredOutput: true }, actor: owner, now: BASE_TIME + 3 });
  const budgetPolicyId = uuidv7();
  new SQLiteAIBudgetPolicyRepository(database).create({ id: budgetPolicyId, content: { key: `memory-cutover-budget-${uuidv7()}`, displayName: "Memory Budget", currency: "USD", costCenter: "STUDENT_GENERATION", hardCapNano: 1_000_000_000, enabled: true }, actor: owner, now: BASE_TIME + 4 });
  const rateLimitPolicyId = uuidv7();
  new SQLiteAIRateLimitPolicyRepository(database).create({ id: rateLimitPolicyId, content: { key: `memory-cutover-rate-${uuidv7()}`, displayName: "Memory Rate", windowMs: 60_000, maxRequests: 100, maxConcurrentRequests: 100, enabled: true }, actor: owner, now: BASE_TIME + 5 });
  const rateCards = new SQLiteAIRateCardRepository(database);
  rateCards.create({ id: uuidv7(), content: { key: `memory-cutover-card-${uuidv7()}`, displayName: "Memory Card", modelConfigId: modelId, modelConfigRevision: 1, currency: "USD", billingUsageNormalizerKey: "memory.cutover", effectiveFrom: 0, effectiveTo: null, enabled: true, priceLines: [{ component: "STANDARD_INPUT", unit: "PER_MILLION_TOKENS", amountNano: 1_000_000 }, { component: "OUTPUT", unit: "PER_MILLION_TOKENS", amountNano: 2_000_000 }, { component: "REQUEST", unit: "PER_REQUEST", amountNano: 100 }], timeBands: [] }, actor: owner, now: BASE_TIME + 6 });
  const instructions = new SQLiteAIInstructionPolicyRepository(database);
  instructions.create({ id: uuidv7(), content: { key: `memory-cutover-global-${uuidv7()}`, scope: "GLOBAL", subjectKey: null, displayName: "Global", instructions: "Global", enabled: true }, actor: owner, now: BASE_TIME + 7 });
  const context = new SQLiteAIContextPolicyRepository(database);
  context.create({ id: uuidv7(), content: { key: `memory-cutover-context-${uuidv7()}`, displayName: "Context", softInputBudgetTokens: 100, hardInputBudgetTokens: 200, outputReserveTokens: 20, policyBudgetTokens: 100, summaryBudgetTokens: 50, recentTurnsBudgetTokens: 100, memoryBudgetTokens: 20, evidenceBudgetTokens: 20, maxRecentTurns: 3, enabled: true }, actor: owner, now: BASE_TIME + 8 });
  const memoryPolicyId = uuidv7();
  const changes = createChangeManagementService(database);
  publishChange(changes, owner, { resourceType: "ai.memory-policy", resourceId: memoryPolicyId, expectedRevision: 0, operation: "CREATE", desired: { key: `memory-cutover-policy-${uuidv7()}`, subjectKey: "biology", displayName: "Legacy Subject Policy", enabled: true, candidateReviewRequired: true, retentionDays: 365, maxSelectedMemories: 10 } });
  const configs = new SQLiteAIMemoryExecutionConfigRepository(database);
  const executionConfigId = uuidv7();
  const configContent: AIMemoryExecutionConfigContent = { key: `memory-cutover-config-${uuidv7()}`, subjectKey: "biology", displayName: "Legacy Execution Config", enabled: true, generationModelConfigId: modelId, generationModelConfigRevision: 1, generationProviderConfigId: providerId, generationProviderConfigRevision: 1, budgetPolicyId, budgetPolicyRevision: 1, rateLimitPolicyId, rateLimitPolicyRevision: 1, timeoutMs: 5_000, extractionMaxOutputTokens: 100, compactionMaxOutputTokens: 100, maxExtractionCandidates: 5, autoApprovalMinConfidenceUnits: 800_000, compactionTriggerMessageCount: 8, compactionRetainRecentMessageCount: 4 };
  publishChange(changes, owner, { resourceType: AI_MEMORY_EXECUTION_CONFIG_RESOURCE_TYPE, resourceId: executionConfigId, expectedRevision: 0, operation: "CREATE", desired: configContent });
  const conversations = new AIConversationService(database, { clock: () => BASE_TIME + 100 });
  const memoryService = new AIMemoryService(database, { conversations: undefined, clock: () => BASE_TIME + 100 });
  const accounting = new SQLiteAIAccountingRepository(database);
  const accountingService = new AICostAccountingService({ rateCardResolver: new AIRateCardResolver(rateCards, new SQLiteAIRateCardModelRevisionRepository(database)), billingNormalizers: new AIBillingUsageNormalizerRegistry([{ key: "memory.cutover", normalize: (usage) => ({ standardInputTokens: usage.inputTokens, cacheHitInputTokens: usage.cacheHitInputTokens, cacheMissInputTokens: usage.cacheMissInputTokens, outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens, requestUnits: 1 }) }]), costCalculator: new AICostCalculator(), accounting });
  const admission = new AIBudgetAdmissionService(database, { clock: () => BASE_TIME + 100 });
  const gateway = new AIProviderGateway({ providerConfigs: providers, modelConfigs: models, secrets, adapters: new ProviderAdapterRegistry([adapter]) }, { clock: () => BASE_TIME + 100 });
  const executions = new SQLiteAIMemoryExecutionRepository(database);
  const conversationRepository = new SQLiteAIConversationRepository(database);
  const executionService = createAIMemoryExecutionService({ database, executions, configs, conversations: conversationRepository, memories: memoryService, memoryPolicies: undefined, summaries: new SQLiteAIConversationSummaryRepository(database), gateway, accounting: accountingService, admission, costEstimator: new AIBoundedMemoryGenerationCostEstimator(new AIRateCardResolver(rateCards, new SQLiteAIRateCardModelRevisionRepository(database)), providers, new AICostCalculator()), clock: () => BASE_TIME + 100 });
  const handlers = new AIJobHandlerRegistry();
  for (const handler of createAIMemoryExecutionJobHandlers(executionService)) handlers.register(handler);
  const jobs = new AIJobQueueService(database, handlers);
  const routers = new AIOutboxRouterRegistry();
  for (const router of createAIMemoryExecutionOutboxRouters()) routers.register(router);
  const outbox = new AIOutboxService(database, routers, { jobQueue: jobs, clock: () => BASE_TIME + 100 });
  const orchestrator = createAIMemoryOrchestrator({ database, outbox, executions, configs, conversations: conversationRepository, clock: () => BASE_TIME + 100 });
  const worker = new AIWorker({ jobs, handlers, outbox, terminalReconciler: executionService, workerId: `memory-cutover-worker-${uuidv7()}`, clock: () => BASE_TIME + 100 });
  void memoryPolicyId;
  void executionConfigId;
  return { database, root, owner, conversations, configs, executions, orchestrator, worker, adapter, close() { database.close(); try { rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }); } catch { /* Windows may retain a WAL handle briefly. */ } } };
}

function publishChange(changes: ReturnType<typeof createChangeManagementService>, owner: AdminActor, item: { resourceType: string; resourceId: string; expectedRevision: number; operation: "CREATE" | "UPDATE"; desired: unknown }): void {
  let change = changes.createChangeSet({ title: "Memory cutover fixture", initialItem: item }, owner);
  change = changes.submit(change.changeSet.id, change.changeSet.revision, owner);
  change = changes.approve(change.changeSet.id, change.changeSet.revision, owner);
  changes.publish(change.changeSet.id, change.changeSet.revision, owner);
}

function completeTurn(fixture: Fixture, conversationId?: string) {
  const conversation = conversationId ? fixture.conversations.getConversation(PRINCIPAL, conversationId) : fixture.conversations.createConversation(PRINCIPAL, "biology");
  const turn = fixture.conversations.beginTurn(PRINCIPAL, { conversationId: conversation.id, idempotencyKey: `memory-cutover-turn-${uuidv7()}`, userContent: "Show me a worked example." });
  fixture.conversations.startResponse(PRINCIPAL, turn.response.id);
  fixture.conversations.appendResponseChunk(PRINCIPAL, turn.response.id, 0, "Here is a safe answer.");
  fixture.conversations.completeResponse(PRINCIPAL, turn.response.id, "STOP");
  return { conversation, response: turn.response };
}

test("M10A2 cutover never schedules a new legacy Extraction execution", async () => {
  const fixture = await createFixture();
  try {
    const turn = completeTurn(fixture);
    const scheduled = fixture.orchestrator.scheduleForCompletedResponse(PRINCIPAL, turn.response.id);
    assert.equal(scheduled.extractionExecutionId, null);
    assert.equal(scheduled.extractionOutboxId, null);
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_memory_executions where execution_kind='EXTRACTION'").get() as { count: number }).count, 0);
    assert.equal(fixture.adapter.calls, 0);
  } finally { fixture.close(); }
});

test("M10A2 preserves Conversation Compaction as a separate bounded path", async () => {
  const fixture = await createFixture();
  try {
    let last = completeTurn(fixture);
    completeTurn(fixture, last.conversation.id);
    completeTurn(fixture, last.conversation.id);
    last = completeTurn(fixture, last.conversation.id);
    const scheduled = fixture.orchestrator.scheduleForCompletedResponse(PRINCIPAL, last.response.id);
    assert.equal(scheduled.extractionExecutionId, null);
    assert.ok(scheduled.compactionExecutionId);
    await fixture.worker.runOnce(BASE_TIME + 100);
    const execution = fixture.executions.getById(scheduled.compactionExecutionId!)!;
    assert.equal(execution.status, "COMPLETED");
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_conversation_summary_revisions where conversation_id=? and status='ACTIVE'").get(last.conversation.id) as { count: number }).count, 1);
    assert.equal(fixture.adapter.calls, 1);
  } finally { fixture.close(); }
});

test("M10A2 keeps legacy M10B execution rows readable without re-enabling Extraction scheduling", async () => {
  const fixture = await createFixture();
  try {
    assert.ok(fixture.configs.getById(fixture.configs.getBySubjectKey("biology")!.id));
    assert.ok(fixture.executions.listPendingTerminal(10));
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_memory_execution_config_revisions").get() as { count: number }).count, 1);
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_memory_executions").get() as { count: number }).count, 0);
  } finally { fixture.close(); }
});
