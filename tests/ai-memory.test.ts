import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../src/server/admin-auth";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import { AIContextService, ContextBudgetManager, type AIContextTokenEstimator } from "../src/server/ai/context";
import { AIConversationService, SQLiteAIConversationRepository, type AIStudentPrincipal } from "../src/server/ai/conversations";
import {
  AI_MEMORY_POLICY_RESOURCE_TYPE,
  AIMemoryError,
  AIMemoryService,
  AIConversationSummaryService,
  SQLiteAIMemoryPolicyRepository,
  SQLiteAIMemoryRepository,
  SQLiteAIConversationSummaryRepository,
  type AIMemoryPolicyContent,
} from "../src/server/ai/memory";
import { SQLiteAIContextPolicyRepository, SQLiteAIInstructionPolicyRepository, type AIContextPolicyContent } from "../src/server/ai/policy";
import { createChangeManagementService } from "../src/server/change-management";
import { SQLiteCanonicalContentRepository } from "../src/server/canonical-content";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const BASE_TIME = 1_906_000_000_000;
const PRINCIPAL_A: AIStudentPrincipal = { principalRef: "memory-principal-a", status: "ACTIVE" };
const PRINCIPAL_B: AIStudentPrincipal = { principalRef: "memory-principal-b", status: "ACTIVE" };

interface Fixture {
  root: string;
  database: ContentDatabase;
  owner: AdminActor;
  admin: AdminActor;
  conversations: AIConversationService;
  conversationRepository: SQLiteAIConversationRepository;
  context: AIContextService;
  contextPolicies: SQLiteAIContextPolicyRepository;
  instructions: SQLiteAIInstructionPolicyRepository;
  memoryPolicies: SQLiteAIMemoryPolicyRepository;
  memories: SQLiteAIMemoryRepository;
  memory: AIMemoryService;
  summaries: SQLiteAIConversationSummaryRepository;
  summary: AIConversationSummaryService;
  changes: ReturnType<typeof createChangeManagementService>;
  contextPolicyId: string;
  close(): void;
}

function createFixture(): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-memory-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  new SQLiteCanonicalContentRepository(database, () => BASE_TIME).bootstrap();
  const identities = new SQLiteAdminIdentityRepository(database);
  const ownerUser = identities.createInitialOwner({ id: uuidv7(), email: `owner-${uuidv7()}@memory.test`, displayName: "Memory Owner", passwordHash: "fixture-only", createdAt: BASE_TIME });
  const adminUser = identities.createAdmin({ id: uuidv7(), email: `admin-${uuidv7()}@memory.test`, displayName: "Memory Admin", passwordHash: "fixture-only", createdAt: BASE_TIME + 1 });
  let now = BASE_TIME + 100;
  const conversationRepository = new SQLiteAIConversationRepository(database);
  const conversations = new AIConversationService(database, { repository: conversationRepository, clock: () => now++ });
  const instructions = new SQLiteAIInstructionPolicyRepository(database);
  instructions.create({ id: uuidv7(), content: { key: `memory-global-${uuidv7()}`, scope: "GLOBAL", subjectKey: null, displayName: "Memory Global", instructions: "Global rules are mandatory.", enabled: true }, actor: { actorUserId: ownerUser.id, actorRole: "OWNER" }, now: BASE_TIME + 2 });
  instructions.create({ id: uuidv7(), content: { key: `memory-biology-${uuidv7()}`, scope: "SUBJECT", subjectKey: "biology", displayName: "Memory Biology", instructions: "Biology guidance is supplemental.", enabled: true }, actor: { actorUserId: ownerUser.id, actorRole: "OWNER" }, now: BASE_TIME + 3 });
  const contextPolicies = new SQLiteAIContextPolicyRepository(database);
  const contextPolicyId = uuidv7();
  contextPolicies.create({ id: contextPolicyId, content: contextPolicyContent(), actor: { actorUserId: ownerUser.id, actorRole: "OWNER" }, now: BASE_TIME + 4 });
  const memoryPolicies = new SQLiteAIMemoryPolicyRepository(database);
  const memories = new SQLiteAIMemoryRepository(database);
  const summaries = new SQLiteAIConversationSummaryRepository(database);
  return {
    root,
    database,
    owner: { actorUserId: ownerUser.id, actorRole: "OWNER" },
    admin: { actorUserId: adminUser.id, actorRole: "ADMIN" },
    conversations,
    context: new AIContextService(database, { clock: () => now++ }),
    contextPolicies,
    instructions,
    memoryPolicies,
    memories,
    conversationRepository,
    memory: new AIMemoryService(database, { memories, policies: memoryPolicies, conversations: conversationRepository, clock: () => now++, idFactory: uuidv7 }),
    summaries,
    summary: new AIConversationSummaryService(database, { summaries, conversations: conversationRepository, clock: () => now++, idFactory: uuidv7 }),
    changes: createChangeManagementService(database),
    contextPolicyId,
    close() {
      database.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
    },
  };
}

function contextPolicyContent(overrides: Partial<AIContextPolicyContent> = {}): AIContextPolicyContent {
  return {
    key: `memory-context-${uuidv7()}`,
    displayName: "Memory Context",
    softInputBudgetTokens: 100,
    hardInputBudgetTokens: 200,
    outputReserveTokens: 20,
    policyBudgetTokens: 100,
    summaryBudgetTokens: 30,
    recentTurnsBudgetTokens: 60,
    memoryBudgetTokens: 10,
    evidenceBudgetTokens: 10,
    maxRecentTurns: 3,
    enabled: true,
    ...overrides,
  };
}

function memoryPolicyContent(overrides: Partial<AIMemoryPolicyContent> = {}): AIMemoryPolicyContent {
  return {
    key: `memory-policy-${uuidv7()}`,
    subjectKey: "biology",
    displayName: "Biology Memory Policy",
    enabled: true,
    candidateReviewRequired: true,
    retentionDays: 1,
    maxSelectedMemories: 3,
    ...overrides,
  };
}

function publishMemoryPolicy(fixture: Fixture, content: AIMemoryPolicyContent): { id: string; revision: number } {
  const id = uuidv7();
  let change = fixture.changes.createChangeSet({ title: "Create Memory Policy", initialItem: { resourceType: AI_MEMORY_POLICY_RESOURCE_TYPE, resourceId: id, expectedRevision: 0, operation: "CREATE", desired: content } }, fixture.admin);
  change = fixture.changes.submit(change.changeSet.id, change.changeSet.revision, fixture.admin);
  change = fixture.changes.approve(change.changeSet.id, change.changeSet.revision, fixture.owner);
  const published = fixture.changes.publish(change.changeSet.id, change.changeSet.revision, fixture.owner);
  return { id, revision: published.changeSet.items[0]!.currentResourceRevision };
}

function completeTurn(fixture: Fixture, principal: AIStudentPrincipal, conversationId: string, userContent: string, answer: string) {
  const turn = fixture.conversations.beginTurn(principal, { conversationId, idempotencyKey: `turn-${uuidv7()}`, userContent });
  fixture.conversations.startResponse(principal, turn.response.id);
  fixture.conversations.appendResponseChunk(principal, turn.response.id, 0, answer);
  fixture.conversations.completeResponse(principal, turn.response.id, "STOP");
  return turn;
}

function beginCurrent(fixture: Fixture, principal: AIStudentPrincipal, conversationId: string, userContent = "current") {
  return fixture.conversations.beginTurn(principal, { conversationId, idempotencyKey: `current-${uuidv7()}`, userContent });
}

function unitEstimator(): AIContextTokenEstimator {
  return { estimatorKey: "memory.unit", estimate: (text) => text.trim() ? 1 : 0 };
}

function expectMemoryCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error) => error instanceof AIMemoryError && error.code === code);
}

function createApprovedMemory(fixture: Fixture, principal: AIStudentPrincipal, conversationId: string, text: string, confidenceUnits: number, now: number) {
  const candidate = fixture.memory.createCandidate(principal, {
    conversationId,
    subjectKey: "biology",
    text,
    confidenceUnits,
    sourceStartOrdinal: 1,
    sourceEndOrdinal: 2,
    now,
  });
  return fixture.memory.approve(principal, { memoryId: candidate.id, subjectKey: "biology", now: now + 1 });
}

test("M10A Memory Policy is governed, subject-bound, revisioned, and append-only", () => {
  const fixture = createFixture();
  try {
    const content = memoryPolicyContent();
    const published = publishMemoryPolicy(fixture, content);
    assert.equal(fixture.memoryPolicies.getById(published.id)?.subjectKey, "biology");
    assert.equal(fixture.memoryPolicies.getRevision(published.id, 1)?.retentionDays, 1);
    const updated = { ...content, retentionDays: 2, displayName: "Biology Memory Policy v2" };
    let change = fixture.changes.createChangeSet({ title: "Update Memory Policy", initialItem: { resourceType: AI_MEMORY_POLICY_RESOURCE_TYPE, resourceId: published.id, expectedRevision: 1, desired: updated } }, fixture.admin);
    change = fixture.changes.submit(change.changeSet.id, change.changeSet.revision, fixture.admin);
    change = fixture.changes.approve(change.changeSet.id, change.changeSet.revision, fixture.owner);
    fixture.changes.publish(change.changeSet.id, change.changeSet.revision, fixture.owner);
    assert.equal(fixture.memoryPolicies.getById(published.id)?.currentRevision, 2);
    assert.equal(fixture.memoryPolicies.getRevision(published.id, 1)?.displayName, content.displayName);
    assert.equal(fixture.memoryPolicies.getRevision(published.id, 2)?.retentionDays, 2);
    assert.throws(() => fixture.database.client.prepare("update ai_memory_policy_revisions set display_name='mutated' where memory_policy_id=?").run(published.id), /immutable/i);
    assert.throws(() => fixture.database.client.prepare("delete from ai_memory_policy_revisions where memory_policy_id=?").run(published.id), /immutable/i);
    assert.throws(() => fixture.database.client.prepare("update ai_memory_policies set subject_key='arabic' where id=?").run(published.id), /lifecycle|immutable/i);
    assert.throws(() => fixture.database.client.prepare("update ai_memory_policies set current_revision=4 where id=?").run(published.id), /lifecycle|revision/i);
  } finally {
    fixture.close();
  }
});

test("M10A Memory is private, reviewed explicitly, deterministic, expiring, and deletion-aware", () => {
  const fixture = createFixture();
  try {
    publishMemoryPolicy(fixture, memoryPolicyContent());
    const conversation = fixture.conversations.createConversation(PRINCIPAL_A, "biology");
    completeTurn(fixture, PRINCIPAL_A, conversation.id, "first", "answer");
    const candidate = fixture.memory.createCandidate(PRINCIPAL_A, { conversationId: conversation.id, subjectKey: "biology", text: "PRIVATE_MEMORY_CANDIDATE", confidenceUnits: 700_000, sourceStartOrdinal: 1, sourceEndOrdinal: 2, now: BASE_TIME + 20 });
    assert.equal(candidate.status, "CANDIDATE");
    assert.equal(fixture.memory.listEligible(PRINCIPAL_A, "biology", { at: BASE_TIME + 20 }).length, 0);
    assert.equal(fixture.memory.get(PRINCIPAL_B, candidate.id, "biology"), null);
    assert.equal(fixture.memory.get(PRINCIPAL_A, candidate.id, "arabic"), null);
    const approved = fixture.memory.approve(PRINCIPAL_A, { memoryId: candidate.id, subjectKey: "biology", now: BASE_TIME + 21 });
    assert.equal(approved.status, "APPROVED");
    assert.deepEqual(fixture.memory.listEligible(PRINCIPAL_A, "biology", { at: BASE_TIME + 22 }).map((memory) => memory.memoryId), [candidate.id]);

    const rejectedTurn = completeTurn(fixture, PRINCIPAL_A, conversation.id, "second", "answer-2");
    const rejected = fixture.memory.createCandidate(PRINCIPAL_A, { conversationId: conversation.id, subjectKey: "biology", text: "PRIVATE_MEMORY_REJECTED", confidenceUnits: 900_000, sourceStartOrdinal: rejectedTurn.userMessage.ordinal, sourceEndOrdinal: rejectedTurn.userMessage.ordinal + 1, now: BASE_TIME + 23 });
    assert.equal(fixture.memory.reject(PRINCIPAL_A, { memoryId: rejected.id, subjectKey: "biology", now: BASE_TIME + 24 }).status, "REJECTED");
    assert.equal(fixture.memory.listEligible(PRINCIPAL_A, "biology", { at: BASE_TIME + 25 }).some((memory) => memory.memoryId === rejected.id), false);

    completeTurn(fixture, PRINCIPAL_A, conversation.id, "third", "answer-3");
    const expiring = createApprovedMemory(fixture, PRINCIPAL_A, conversation.id, "PRIVATE_MEMORY_EXPIRES", 800_000, BASE_TIME + 26);
    assert.equal(fixture.memory.listEligible(PRINCIPAL_A, "biology", { at: expiring.expiresAt }).some((memory) => memory.memoryId === expiring.id), false);

    const deletedConversation = fixture.conversations.createConversation(PRINCIPAL_A, "biology");
    completeTurn(fixture, PRINCIPAL_A, deletedConversation.id, "delete-source", "delete-answer");
    const deletedMemory = createApprovedMemory(fixture, PRINCIPAL_A, deletedConversation.id, "PRIVATE_MEMORY_DELETED", 950_000, BASE_TIME + 27);
    fixture.conversations.deleteConversation(PRINCIPAL_A, deletedConversation.id);
    const deleted = fixture.memory.get(PRINCIPAL_A, deletedMemory.id, "biology")!;
    assert.equal(deleted.status, "DELETED");
    assert.equal(deleted.memoryText, null);
    assert.equal(fixture.memory.listEligible(PRINCIPAL_A, "biology", { at: BASE_TIME + 28 }).some((memory) => memory.memoryId === deletedMemory.id), false);
  } finally {
    fixture.close();
  }
});

test("M10A approved Memory selection is owner/subject scoped, bounded by memoryBudgetTokens, and recorded as metadata", () => {
  const fixture = createFixture();
  try {
    publishMemoryPolicy(fixture, memoryPolicyContent({ maxSelectedMemories: 3 }));
    const conversation = fixture.conversations.createConversation(PRINCIPAL_A, "biology");
    completeTurn(fixture, PRINCIPAL_A, conversation.id, "one", "answer-one");
    const first = createApprovedMemory(fixture, PRINCIPAL_A, conversation.id, "PRIVATE_MEMORY_LOW", 500_000, BASE_TIME + 30);
    completeTurn(fixture, PRINCIPAL_A, conversation.id, "two", "answer-two");
    const second = createApprovedMemory(fixture, PRINCIPAL_A, conversation.id, "PRIVATE_MEMORY_HIGH_OLD", 900_000, BASE_TIME + 31);
    completeTurn(fixture, PRINCIPAL_A, conversation.id, "three", "answer-three");
    const third = createApprovedMemory(fixture, PRINCIPAL_A, conversation.id, "PRIVATE_MEMORY_HIGH_NEW", 900_000, BASE_TIME + 32);
    const eligible = fixture.memory.listEligible(PRINCIPAL_A, "biology", { at: BASE_TIME + 33 });
    assert.deepEqual(eligible.map((memory) => memory.memoryId), [third.id, second.id, first.id]);

    const global = fixture.instructions.getCurrentRevision(fixture.instructions.getByScope("GLOBAL", null)!.id)!;
    const subject = fixture.instructions.getCurrentRevision(fixture.instructions.getByScope("SUBJECT", "biology")!.id)!;
    const current = beginCurrent(fixture, PRINCIPAL_A, conversation.id, "memory context query");
    const bounded = new ContextBudgetManager().build({
      conversationId: conversation.id,
      subjectKey: "biology",
      globalPolicy: global,
      subjectPolicy: subject,
      contextPolicy: { ...fixture.contextPolicies.getCurrentRevision(fixture.contextPolicyId)!, memoryBudgetTokens: 2 },
      currentMessage: current.userMessage,
      previousMessages: [],
      estimator: unitEstimator(),
      memories: eligible,
    });
    assert.equal(bounded.memories.length, 2);
    assert.equal(bounded.budget.memoryTokens, 2);
    assert.equal(bounded.decisions.filter((decision) => decision.kind === "MEMORY" && decision.decision === "OMITTED").length, 1);
    assert.equal(bounded.decisions.find((decision) => decision.sourceId === first.id)?.decisionReason, "MEMORY_BUDGET_EXCEEDED");

    const built = fixture.context.build(PRINCIPAL_A, { responseId: current.response.id, contextPolicyId: fixture.contextPolicyId, estimator: unitEstimator() });
    assert.deepEqual(built.plan.memories.map((memory) => memory.memoryId), [third.id, second.id, first.id]);
    const items = fixture.context.listSnapshotItems(PRINCIPAL_A, current.response.id).filter((item) => item.kind === "MEMORY");
    assert.equal(items.length, 3);
    assert.equal(JSON.stringify(built.plan.snapshot).includes("PRIVATE_MEMORY"), false);
    assert.equal(JSON.stringify(items).includes("PRIVATE_MEMORY"), false);
  } finally {
    fixture.close();
  }
});

test("M10A Memory rejects cross-principal, cross-subject, and partial Assistant provenance", () => {
  const fixture = createFixture();
  try {
    publishMemoryPolicy(fixture, memoryPolicyContent());
    const conversation = fixture.conversations.createConversation(PRINCIPAL_A, "biology");
    completeTurn(fixture, PRINCIPAL_A, conversation.id, "complete", "answer");
    expectMemoryCode(() => fixture.memory.createCandidate(PRINCIPAL_B, { conversationId: conversation.id, subjectKey: "biology", text: "PRIVATE_CROSS_OWNER", confidenceUnits: 500_000, sourceStartOrdinal: 1, sourceEndOrdinal: 2 }), "AI_MEMORY_SOURCE_INVALID");
    expectMemoryCode(() => fixture.memory.createCandidate(PRINCIPAL_A, { conversationId: conversation.id, subjectKey: "arabic", text: "PRIVATE_CROSS_SUBJECT", confidenceUnits: 500_000, sourceStartOrdinal: 1, sourceEndOrdinal: 2 }), "AI_MEMORY_SCOPE_MISMATCH");

    const partialConversation = fixture.conversations.createConversation(PRINCIPAL_A, "biology");
    const partialTurn = fixture.conversations.beginTurn(PRINCIPAL_A, { conversationId: partialConversation.id, idempotencyKey: `partial-${uuidv7()}`, userContent: "partial" });
    fixture.conversations.startResponse(PRINCIPAL_A, partialTurn.response.id);
    fixture.conversations.appendResponseChunk(PRINCIPAL_A, partialTurn.response.id, 0, "PRIVATE_PARTIAL_ASSISTANT");
    fixture.conversations.failResponse(PRINCIPAL_A, partialTurn.response.id);
    expectMemoryCode(() => fixture.memory.createCandidate(PRINCIPAL_A, { conversationId: partialConversation.id, subjectKey: "biology", text: "PRIVATE_FROM_PARTIAL", confidenceUnits: 500_000, sourceStartOrdinal: 1, sourceEndOrdinal: 2 }), "AI_MEMORY_SOURCE_INVALID");
  } finally {
    fixture.close();
  }
});

test("M10A Summary revisions are append-only, monotonic, canonical, and cut old history out of Context", () => {
  const fixture = createFixture();
  try {
    const conversation = fixture.conversations.createConversation(PRINCIPAL_A, "biology");
    completeTurn(fixture, PRINCIPAL_A, conversation.id, "old-1", "answer-1");
    completeTurn(fixture, PRINCIPAL_A, conversation.id, "old-2", "answer-2");
    const firstCurrent = beginCurrent(fixture, PRINCIPAL_A, conversation.id, "current-before-summary");
    const summary1 = fixture.summary.createRevision(PRINCIPAL_A, { conversationId: conversation.id, subjectKey: "biology", summaryText: "PRIVATE_SUMMARY_REVISION_1", coversThroughOrdinal: 4, now: BASE_TIME + 50 });
    assert.equal(summary1.revision, 1);
    const firstPlan = fixture.context.build(PRINCIPAL_A, { responseId: firstCurrent.response.id, contextPolicyId: fixture.contextPolicyId, estimator: unitEstimator() }).plan;
    assert.equal(firstPlan.summary?.summaryId, summary1.id);
    assert.equal(firstPlan.summary?.revision, 1);
    assert.equal(firstPlan.recentMessages.length, 0);
    assert.equal(fixture.conversations.listMessages(PRINCIPAL_A, conversation.id).length, 5);

    fixture.conversations.startResponse(PRINCIPAL_A, firstCurrent.response.id);
    fixture.conversations.appendResponseChunk(PRINCIPAL_A, firstCurrent.response.id, 0, "answer-current");
    fixture.conversations.completeResponse(PRINCIPAL_A, firstCurrent.response.id, "STOP");
    completeTurn(fixture, PRINCIPAL_A, conversation.id, "new-after-summary", "answer-new");
    const secondCurrent = beginCurrent(fixture, PRINCIPAL_A, conversation.id, "current-after-summary");
    const summary2 = fixture.summary.createRevision(PRINCIPAL_A, { conversationId: conversation.id, subjectKey: "biology", summaryText: "PRIVATE_SUMMARY_REVISION_2", coversThroughOrdinal: 8, expectedRevision: 1, now: BASE_TIME + 51 });
    assert.equal(summary2.revision, 2);
    const secondPlan = fixture.context.build(PRINCIPAL_A, { responseId: secondCurrent.response.id, contextPolicyId: fixture.contextPolicyId, estimator: unitEstimator() }).plan;
    assert.equal(secondPlan.summary?.revision, 2);
    assert.equal(secondPlan.recentMessages.every((message) => message.ordinal > 8), true);
    assert.equal(fixture.conversations.listMessages(PRINCIPAL_A, conversation.id).some((message) => message.ordinal <= 8), true);
    expectMemoryCode(() => fixture.summary.createRevision(PRINCIPAL_A, { conversationId: conversation.id, subjectKey: "biology", summaryText: "backward", coversThroughOrdinal: 6, expectedRevision: 2 }), "AI_MEMORY_SUMMARY_CONFLICT");
    expectMemoryCode(() => fixture.summary.createRevision(PRINCIPAL_A, { conversationId: conversation.id, subjectKey: "arabic", summaryText: "wrong-subject", coversThroughOrdinal: 8 }), "AI_MEMORY_SCOPE_MISMATCH");
    expectMemoryCode(() => fixture.summary.createRevision(PRINCIPAL_B, { conversationId: conversation.id, subjectKey: "biology", summaryText: "wrong-owner", coversThroughOrdinal: 8 }), "AI_MEMORY_SOURCE_INVALID");

    const partialConversation = fixture.conversations.createConversation(PRINCIPAL_A, "biology");
    const partial = fixture.conversations.beginTurn(PRINCIPAL_A, { conversationId: partialConversation.id, idempotencyKey: `summary-partial-${uuidv7()}`, userContent: "partial" });
    fixture.conversations.startResponse(PRINCIPAL_A, partial.response.id);
    fixture.conversations.appendResponseChunk(PRINCIPAL_A, partial.response.id, 0, "PRIVATE_PARTIAL_SUMMARY_SOURCE");
    fixture.conversations.failResponse(PRINCIPAL_A, partial.response.id);
    expectMemoryCode(() => fixture.summary.createRevision(PRINCIPAL_A, { conversationId: partialConversation.id, subjectKey: "biology", summaryText: "must-not-summarize-partial", coversThroughOrdinal: 2 }), "AI_MEMORY_SUMMARY_INVALID");
  } finally {
    fixture.close();
  }
});

test("M10A Conversation deletion atomically scrubs Summary and Memory text while preserving another principal", () => {
  const fixture = createFixture();
  try {
    publishMemoryPolicy(fixture, memoryPolicyContent());
    const conversationA = fixture.conversations.createConversation(PRINCIPAL_A, "biology");
    completeTurn(fixture, PRINCIPAL_A, conversationA.id, "private-a", "answer-a");
    const memoryA = createApprovedMemory(fixture, PRINCIPAL_A, conversationA.id, "PRIVATE_MEMORY_DELETE_MARKER", 900_000, BASE_TIME + 60);
    const currentA = beginCurrent(fixture, PRINCIPAL_A, conversationA.id, "PRIVATE_QUERY_DELETE_MARKER");
    const summaryA = fixture.summary.createRevision(PRINCIPAL_A, { conversationId: conversationA.id, subjectKey: "biology", summaryText: "PRIVATE_SUMMARY_DELETE_MARKER", coversThroughOrdinal: 2, now: BASE_TIME + 61 });
    const built = fixture.context.build(PRINCIPAL_A, { responseId: currentA.response.id, contextPolicyId: fixture.contextPolicyId, estimator: unitEstimator() });
    assert.equal(built.plan.memories.some((memory) => memory.memoryId === memoryA.id), true);
    assert.equal(built.plan.summary?.summaryId, summaryA.id);
    for (const table of [
      "ai_context_snapshots",
      "ai_context_snapshot_items",
      "ai_cost_operations",
      "ai_usage_cost_records",
      "ai_budget_reservations",
      "ai_jobs",
      "ai_outbox_events",
      "ai_memory_policies",
      "ai_memory_policy_revisions",
      "ai_knowledge_sources",
      "ai_knowledge_source_revisions",
      "ai_knowledge_packages",
      "ai_knowledge_package_revisions",
      "ai_retrieval_chunks",
      "ai_retrieval_projection_revisions",
      "ai_embedding_vectors",
    ]) {
      assert.equal(JSON.stringify(fixture.database.client.prepare(`select * from ${table}`).all()).includes("PRIVATE_MEMORY_DELETE_MARKER"), false, table);
      assert.equal(JSON.stringify(fixture.database.client.prepare(`select * from ${table}`).all()).includes("PRIVATE_SUMMARY_DELETE_MARKER"), false, table);
    }
    for (const table of ["ai_context_snapshots", "ai_context_snapshot_items", "ai_cost_operations", "ai_usage_cost_records", "ai_budget_reservations", "ai_jobs", "ai_memory_policy_revisions"]) {
      assert.equal(JSON.stringify(fixture.database.client.prepare(`select * from ${table}`).all()).includes("PRIVATE_"), false, table);
    }
    assert.equal(JSON.stringify(fixture.database.client.prepare("select * from ai_memories").all()).includes("PRIVATE_MEMORY_DELETE_MARKER"), true);
    assert.equal(JSON.stringify(fixture.database.client.prepare("select * from ai_conversation_summary_revisions").all()).includes("PRIVATE_SUMMARY_DELETE_MARKER"), true);

    const conversationB = fixture.conversations.createConversation(PRINCIPAL_B, "biology");
    completeTurn(fixture, PRINCIPAL_B, conversationB.id, "private-b", "answer-b");
    const memoryB = createApprovedMemory(fixture, PRINCIPAL_B, conversationB.id, "PRIVATE_MEMORY_OTHER_PRINCIPAL", 800_000, BASE_TIME + 62);
    fixture.conversations.deleteConversation(PRINCIPAL_A, conversationA.id);
    const scrubbedMemory = fixture.memory.get(PRINCIPAL_A, memoryA.id, "biology")!;
    const scrubbedSummary = fixture.summaries.getRevision({ principalRef: PRINCIPAL_A.principalRef, conversationId: conversationA.id, revision: 1 })!;
    assert.equal(scrubbedMemory.status, "DELETED");
    assert.equal(scrubbedMemory.memoryText, null);
    assert.equal(scrubbedSummary.status, "DELETED");
    assert.equal(scrubbedSummary.summaryText, null);
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_conversation_messages where conversation_id=?").get(conversationA.id) as { count: number }).count, 0);
    assert.equal(fixture.memory.listEligible(PRINCIPAL_A, "biology", { at: BASE_TIME + 63 }).some((memory) => memory.memoryId === memoryA.id), false);
    assert.equal(fixture.memory.listEligible(PRINCIPAL_B, "biology", { at: BASE_TIME + 63 }).some((memory) => memory.memoryId === memoryB.id), true);
    const newConversationA = fixture.conversations.createConversation(PRINCIPAL_A, "biology");
    const newCurrentA = beginCurrent(fixture, PRINCIPAL_A, newConversationA.id, "new");
    const newPlanA = fixture.context.build(PRINCIPAL_A, { responseId: newCurrentA.response.id, contextPolicyId: fixture.contextPolicyId, estimator: unitEstimator() }).plan;
    assert.equal(newPlanA.memories.length, 0);
    assert.equal(newPlanA.summary, undefined);
    assert.equal(fixture.memory.purgePrincipalInTransaction(PRINCIPAL_A.principalRef, BASE_TIME + 64), 0);
    assert.equal(fixture.summary.purgePrincipalInTransaction(PRINCIPAL_A.principalRef, BASE_TIME + 64), 0);
    assert.equal(JSON.stringify(fixture.database.client.prepare("select * from ai_memories where principal_ref=?").all(PRINCIPAL_A.principalRef)).includes("PRIVATE_MEMORY_DELETE_MARKER"), false);
  } finally {
    fixture.close();
  }
});

test("M10A SQLite boundary rejects cross-owner/subject writes and illegal Memory/Summary lifecycle mutations", () => {
  const fixture = createFixture();
  try {
    const policy = publishMemoryPolicy(fixture, memoryPolicyContent());
    const conversation = fixture.conversations.createConversation(PRINCIPAL_A, "biology");
    completeTurn(fixture, PRINCIPAL_A, conversation.id, "source", "answer");
    const approved = createApprovedMemory(fixture, PRINCIPAL_A, conversation.id, "PRIVATE_DB_MEMORY", 700_000, BASE_TIME + 70);
    const expiresAt = approved.expiresAt;
    const rawMemoryValues = (principalRef: string, subjectKey: string, status = "CANDIDATE", memoryText: string | null = "raw") => [uuidv7(), principalRef, subjectKey, policy.id, 1, 1, status, "PRINCIPAL_SUBJECT", "CONVERSATION", conversation.id, 1, 2, memoryText, 500_000, BASE_TIME + 71, status === "CANDIDATE" ? null : BASE_TIME + 72, null, expiresAt, status === "CANDIDATE" ? null : "STUDENT_APPROVED"];
    const insertMemory = fixture.database.client.prepare("insert into ai_memories (id,principal_ref,subject_key,memory_policy_id,memory_policy_revision,revision,status,visibility_scope,creation_origin,source_conversation_id,source_start_ordinal,source_end_ordinal,memory_text,confidence_units,created_at,reviewed_at,deleted_at,expires_at,safe_review_code) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    assert.throws(() => insertMemory.run(...rawMemoryValues(PRINCIPAL_B.principalRef, "biology")), /ownership|coverage|invalid|constraint/i);
    assert.throws(() => insertMemory.run(...rawMemoryValues(PRINCIPAL_A.principalRef, "arabic")), /ownership|coverage|invalid|constraint/i);
    assert.throws(() => insertMemory.run(...rawMemoryValues(PRINCIPAL_A.principalRef, "biology", "APPROVED")), /candidate|ownership|invalid|constraint/i);
    assert.throws(() => fixture.database.client.prepare("update ai_memories set memory_text='mutated' where id=?").run(approved.id), /immutable|mutation|lifecycle/i);
    assert.throws(() => fixture.database.client.prepare("delete from ai_memories where id=?").run(approved.id), /append-only|immutable/i);

    const current = fixture.summary.createRevision(PRINCIPAL_A, { conversationId: conversation.id, subjectKey: "biology", summaryText: "PRIVATE_DB_SUMMARY", coversThroughOrdinal: 2, now: BASE_TIME + 73 });
    const insertSummary = fixture.database.client.prepare("insert into ai_conversation_summary_revisions (id,conversation_id,principal_ref,subject_key,revision,status,summary_text,covers_through_ordinal,source_start_ordinal,source_end_ordinal,source_message_count,created_at,deleted_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?)");
    assert.throws(() => insertSummary.run(uuidv7(), conversation.id, PRINCIPAL_B.principalRef, "biology", 2, "ACTIVE", "bad", 2, 1, 2, 2, BASE_TIME + 74, null), /ownership|coverage|invalid|constraint/i);
    assert.throws(() => fixture.database.client.prepare("delete from ai_conversation_summary_revisions where id=?").run(current.id), /append-only|immutable/i);
    assert.throws(() => fixture.database.client.prepare("update ai_conversation_summary_revisions set summary_text='mutated' where id=?").run(current.id), /immutable|scrubbing|constraint/i);
    completeTurn(fixture, PRINCIPAL_A, conversation.id, "source-2", "answer-2");
    fixture.summary.createRevision(PRINCIPAL_A, { conversationId: conversation.id, subjectKey: "biology", summaryText: "advanced", coversThroughOrdinal: 4, expectedRevision: 1, now: BASE_TIME + 75 });
    expectMemoryCode(() => fixture.summary.createRevision(PRINCIPAL_A, { conversationId: conversation.id, subjectKey: "biology", summaryText: "backward", coversThroughOrdinal: 2, expectedRevision: 2 }), "AI_MEMORY_SUMMARY_CONFLICT");
    fixture.conversations.deleteConversation(PRINCIPAL_A, conversation.id);
    assert.throws(() => fixture.database.client.prepare("update ai_memories set status='APPROVED', memory_text='unsealed', reviewed_at=?, safe_review_code='STUDENT_APPROVED', deleted_at=null where id=?").run(BASE_TIME + 80, approved.id), /immutable|lifecycle|constraint/i);
  } finally {
    fixture.close();
  }
});

test("M10A migration 0039 is fresh and preserves a populated 0038 database", () => {
  const freshRoot = mkdtempSync(path.join(os.tmpdir(), "pythagoras-memory-fresh-"));
  const oldRoot = mkdtempSync(path.join(os.tmpdir(), "pythagoras-memory-old-"));
  const oldMigrations = mkdtempSync(path.join(os.tmpdir(), "pythagoras-memory-migrations-"));
  let oldDatabase: ContentDatabase | null = null;
  let upgraded: ContentDatabase | null = null;
  try {
    const fresh = openContentDatabase({ dataDirectory: freshRoot, migrationsDirectory });
    assert.equal((fresh.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count, 40);
    fresh.close();

    mkdirSync(path.join(oldMigrations, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(path.join(migrationsDirectory, "meta", "_journal.json"), "utf8"));
    const entries0038 = journal.entries.slice(0, 39);
    for (const entry of entries0038) {
      copyFileSync(path.join(migrationsDirectory, `${entry.tag}.sql`), path.join(oldMigrations, `${entry.tag}.sql`));
      const snapshotName = `${entry.idx.toString().padStart(4, "0")}_snapshot.json`;
      if (existsSync(path.join(migrationsDirectory, "meta", snapshotName))) copyFileSync(path.join(migrationsDirectory, "meta", snapshotName), path.join(oldMigrations, "meta", snapshotName));
    }
    writeFileSync(path.join(oldMigrations, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: entries0038 }));
    oldDatabase = openContentDatabase({ dataDirectory: oldRoot, migrationsDirectory: oldMigrations });
    assert.equal((oldDatabase.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count, 39);
    new SQLiteCanonicalContentRepository(oldDatabase, () => BASE_TIME).bootstrap();
    const owner = new SQLiteAdminIdentityRepository(oldDatabase).createInitialOwner({ id: uuidv7(), email: `old-${uuidv7()}@memory.test`, displayName: "Old Owner", passwordHash: "fixture", createdAt: BASE_TIME });
    const conversation = new AIConversationService(oldDatabase, { clock: () => BASE_TIME + 1 }).createConversation({ principalRef: "old-memory-owner", status: "ACTIVE" }, "biology");
    oldDatabase.close();
    oldDatabase = null;

    upgraded = openContentDatabase({ dataDirectory: oldRoot, migrationsDirectory });
    assert.equal((upgraded.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count, 40);
    assert.ok(upgraded.client.prepare("select id from ai_conversations where id=?").get(conversation.id));
    for (const trigger of ["ai_memories_insert_valid", "ai_memories_lifecycle_valid", "ai_conversation_summary_revisions_insert_valid", "ai_memory_policy_revisions_no_update"]) assert.ok(upgraded.client.prepare("select name from sqlite_master where type='trigger' and name=?").get(trigger));
    assert.ok(owner.id);
  } finally {
    oldDatabase?.close();
    upgraded?.close();
    rmSync(freshRoot, { recursive: true, force: true });
    rmSync(oldRoot, { recursive: true, force: true });
    rmSync(oldMigrations, { recursive: true, force: true });
  }
});
