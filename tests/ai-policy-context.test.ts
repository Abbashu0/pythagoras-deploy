import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../src/server/admin-auth";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import {
  AIContextService,
  ContextBudgetManager,
  type AIContextTokenEstimator,
} from "../src/server/ai/context";
import {
  AIPolicyError,
  AI_CONTEXT_POLICY_RESOURCE_TYPE,
  AI_INSTRUCTION_POLICY_RESOURCE_TYPE,
  SQLiteAIContextPolicyRepository,
  SQLiteAIInstructionPolicyRepository,
  type AIContextPolicyContent,
  type AIInstructionPolicyContent,
} from "../src/server/ai/policy";
import { AIConversationService, type AIStudentPrincipal } from "../src/server/ai/conversations";
import { AIConversationSummaryService } from "../src/server/ai/memory";
import { createChangeManagementService } from "../src/server/change-management";
import { SQLiteCanonicalContentRepository } from "../src/server/canonical-content";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";
import { compileInstructionAuthoring } from "../src/server/ai/policy/instruction-compiler";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
test("Historical Owner ChangeSets also preserve structured instruction snapshots and execution text", () => {
  const fixture = createFixture();
  try {
    const compiled = compileInstructionAuthoring([{ id: uuidv7(), title: "هوية", body: "<rules>تعليمات عربية</rules>", description: "Admin metadata only", enabled: true }]);
    const published = publishInstruction(fixture, instructionContent(compiled));
    assert.deepEqual(fixture.instructions.getCurrentRevision(published.id)?.authoring, compiled.authoring);
    assert.equal(fixture.instructions.getCurrentRevision(published.id)?.instructions, compiled.instructions);
  } finally { fixture.close(); }
});
const BASE_TIME = 1_901_300_000_000;
const PRINCIPAL: AIStudentPrincipal = { principalRef: "student-policy-context", status: "ACTIVE" };

interface Fixture {
  root: string;
  database: ContentDatabase;
  owner: AdminActor;
  admin: AdminActor;
  conversations: AIConversationService;
  context: AIContextService;
  instructions: SQLiteAIInstructionPolicyRepository;
  contexts: SQLiteAIContextPolicyRepository;
  changes: ReturnType<typeof createChangeManagementService>;
  close(): void;
}

function createFixture(): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-policy-context-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  new SQLiteCanonicalContentRepository(database, () => BASE_TIME).bootstrap();
  const identities = new SQLiteAdminIdentityRepository(database);
  const ownerUser = identities.createInitialOwner({ id: uuidv7(), email: `owner-${uuidv7()}@policy-context.test`, displayName: "Policy Context Owner", passwordHash: "fixture-only", createdAt: BASE_TIME });
  const adminUser = identities.createAdmin({ id: uuidv7(), email: `admin-${uuidv7()}@policy-context.test`, displayName: "Policy Context Admin", passwordHash: "fixture-only", createdAt: BASE_TIME + 1 });
  let now = BASE_TIME + 100;
  const conversations = new AIConversationService(database, { clock: () => now++ });
  return {
    root,
    database,
    owner: { actorUserId: ownerUser.id, actorRole: "OWNER" },
    admin: { actorUserId: adminUser.id, actorRole: "ADMIN" },
    conversations,
    context: new AIContextService(database, { clock: () => now++ }),
    instructions: new SQLiteAIInstructionPolicyRepository(database),
    contexts: new SQLiteAIContextPolicyRepository(database),
    changes: createChangeManagementService(database),
    close() {
      database.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
    },
  };
}

function instructionContent(overrides: Partial<AIInstructionPolicyContent> = {}): AIInstructionPolicyContent {
  return {
    key: "global-tutor-policy",
    scope: "GLOBAL",
    subjectKey: null,
    displayName: "Synthetic Global Policy",
    instructions: "Global rules are mandatory.",
    enabled: true,
    ...overrides,
  };
}

function contextContent(overrides: Partial<AIContextPolicyContent> = {}): AIContextPolicyContent {
  return {
    key: "default-context-policy",
    displayName: "Synthetic Context Policy",
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

function expectCode(fn: () => unknown, code: string): Error {
  let captured: unknown;
  try {
    fn();
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof Error);
  assert.equal((captured as Error & { code?: string }).code, code);
  return captured;
}

function publishInstruction(fixture: Fixture, content: AIInstructionPolicyContent): { id: string; revision: number } {
  const id = uuidv7();
  let change = fixture.changes.createChangeSet({
    title: `Create ${content.displayName}`,
    initialItem: { resourceType: AI_INSTRUCTION_POLICY_RESOURCE_TYPE, resourceId: id, expectedRevision: 0, operation: "CREATE", desired: content },
  }, fixture.owner);
  change = fixture.changes.submit(change.changeSet.id, change.changeSet.revision, fixture.owner);
  change = fixture.changes.approve(change.changeSet.id, change.changeSet.revision, fixture.owner);
  const published = fixture.changes.publish(change.changeSet.id, change.changeSet.revision, fixture.owner);
  return { id, revision: published.changeSet.items[0]!.currentResourceRevision };
}

function publishContext(fixture: Fixture, content: AIContextPolicyContent): { id: string; revision: number } {
  const id = uuidv7();
  let change = fixture.changes.createChangeSet({
    title: `Create ${content.displayName}`,
    initialItem: { resourceType: AI_CONTEXT_POLICY_RESOURCE_TYPE, resourceId: id, expectedRevision: 0, operation: "CREATE", desired: content },
  }, fixture.owner);
  change = fixture.changes.submit(change.changeSet.id, change.changeSet.revision, fixture.owner);
  change = fixture.changes.approve(change.changeSet.id, change.changeSet.revision, fixture.owner);
  const published = fixture.changes.publish(change.changeSet.id, change.changeSet.revision, fixture.owner);
  return { id, revision: published.changeSet.items[0]!.currentResourceRevision };
}

function updateInstruction(fixture: Fixture, id: string, content: AIInstructionPolicyContent): number {
  const current = fixture.instructions.getById(id)!;
  let change = fixture.changes.createChangeSet({
    title: `Update ${content.displayName}`,
    initialItem: { resourceType: AI_INSTRUCTION_POLICY_RESOURCE_TYPE, resourceId: id, expectedRevision: current.currentRevision, desired: content },
  }, fixture.admin);
  change = fixture.changes.submit(change.changeSet.id, change.changeSet.revision, fixture.admin);
  change = fixture.changes.approve(change.changeSet.id, change.changeSet.revision, fixture.owner);
  const published = fixture.changes.publish(change.changeSet.id, change.changeSet.revision, fixture.owner);
  return published.changeSet.items[0]!.currentResourceRevision;
}

function updateContext(fixture: Fixture, id: string, content: AIContextPolicyContent): number {
  const current = fixture.contexts.getById(id)!;
  let change = fixture.changes.createChangeSet({
    title: `Update ${content.displayName}`,
    initialItem: { resourceType: AI_CONTEXT_POLICY_RESOURCE_TYPE, resourceId: id, expectedRevision: current.currentRevision, desired: content },
  }, fixture.admin);
  change = fixture.changes.submit(change.changeSet.id, change.changeSet.revision, fixture.admin);
  change = fixture.changes.approve(change.changeSet.id, change.changeSet.revision, fixture.owner);
  const published = fixture.changes.publish(change.changeSet.id, change.changeSet.revision, fixture.owner);
  return published.changeSet.items[0]!.currentResourceRevision;
}

function beginTurn(fixture: Fixture, subjectKey = "biology", userContent = "سؤال") {
  const conversation = fixture.conversations.createConversation(PRINCIPAL, subjectKey);
  return { conversation, turn: fixture.conversations.beginTurn(PRINCIPAL, { conversationId: conversation.id, idempotencyKey: `turn-${uuidv7()}`, userContent }) };
}

function completeTurn(fixture: Fixture, conversationId: string, userContent: string, answer: string) {
  const turn = fixture.conversations.beginTurn(PRINCIPAL, { conversationId, idempotencyKey: `completed-${uuidv7()}`, userContent });
  fixture.conversations.startResponse(PRINCIPAL, turn.response.id);
  fixture.conversations.appendResponseChunk(PRINCIPAL, turn.response.id, 0, answer);
  fixture.conversations.completeResponse(PRINCIPAL, turn.response.id, "STOP");
  return turn;
}

function estimator(mode: "unit" | "bytes" = "unit"): AIContextTokenEstimator {
  return {
    estimatorKey: `test.${mode}`,
    estimate(text: string) {
      return mode === "unit" ? (text.trim() ? 1 : 0) : Buffer.byteLength(text, "utf8");
    },
  };
}

function setupPolicies(fixture: Fixture, contextOverrides: Partial<AIContextPolicyContent> = {}) {
  const global = publishInstruction(fixture, instructionContent());
  const subject = publishInstruction(fixture, instructionContent({ key: "biology-tutor-policy", scope: "SUBJECT", subjectKey: "biology", displayName: "Synthetic Biology Policy", instructions: "Biology explanations are supplemental." }));
  const context = publishContext(fixture, contextContent(contextOverrides));
  return { global, subject, context };
}

test("Instruction Policies are governed, revisioned, and approval does not mutate canonical state", () => {
  const fixture = createFixture();
  try {
    assert.deepEqual(fixture.instructions.list(), []);
    const created = publishInstruction(fixture, instructionContent());
    const first = fixture.instructions.getById(created.id)!;
    assert.equal(first.currentRevision, 1);
    assert.equal(first.instructions, "Global rules are mandatory.");

    const desired = instructionContent({ instructions: "Global rules remain mandatory and grounded." });
    const current = fixture.instructions.getById(created.id)!;
    let change = fixture.changes.createChangeSet({ title: "Update global policy", initialItem: { resourceType: AI_INSTRUCTION_POLICY_RESOURCE_TYPE, resourceId: created.id, expectedRevision: current.currentRevision, desired } }, fixture.admin);
    change = fixture.changes.submit(change.changeSet.id, change.changeSet.revision, fixture.admin);
    assert.throws(() => fixture.changes.approve(change.changeSet.id, change.changeSet.revision, fixture.admin), /OWNER|authorized/i);
    change = fixture.changes.approve(change.changeSet.id, change.changeSet.revision, fixture.owner);
    assert.equal(fixture.instructions.getById(created.id)!.currentRevision, 1, "approval mutated canonical policy");
    assert.throws(() => fixture.changes.publish(change.changeSet.id, change.changeSet.revision, fixture.admin), /OWNER|authorized/i);
    fixture.changes.publish(change.changeSet.id, change.changeSet.revision, fixture.owner);
    assert.equal(fixture.instructions.getById(created.id)!.currentRevision, 2);
    assert.equal(fixture.instructions.getRevision(created.id, 1)!.instructions, "Global rules are mandatory.");
    assert.equal(fixture.instructions.getRevision(created.id, 2)!.instructions, desired.instructions);
    assert.throws(() => fixture.database.client.prepare("update ai_instruction_policies set key = ? where id = ?").run("changed-global", created.id), /immutable/i);
    assert.equal(fixture.instructions.getById(created.id)!.key, "global-tutor-policy");
  } finally {
    fixture.close();
  }
});

test("Subject Policies are canonical per subject, subject-validated, and cannot be duplicated or retargeted", () => {
  const fixture = createFixture();
  try {
    const biology = publishInstruction(fixture, instructionContent({ key: "biology-tutor-policy", scope: "SUBJECT", subjectKey: "biology", displayName: "Biology Policy", instructions: "Use biological terminology." }));
    const duplicate = uuidv7();
    assert.throws(() => fixture.changes.createChangeSet({ title: "Duplicate Biology policy", initialItem: { resourceType: AI_INSTRUCTION_POLICY_RESOURCE_TYPE, resourceId: duplicate, expectedRevision: 0, operation: "CREATE", desired: instructionContent({ key: "biology-tutor-policy-2", scope: "SUBJECT", subjectKey: "biology", displayName: "Duplicate Biology", instructions: "Duplicate." }) } }, fixture.admin), /scope|subject|policy/i);
    assert.throws(() => fixture.changes.createChangeSet({ title: "Unknown subject policy", initialItem: { resourceType: AI_INSTRUCTION_POLICY_RESOURCE_TYPE, resourceId: uuidv7(), expectedRevision: 0, operation: "CREATE", desired: instructionContent({ key: "unknown-subject-policy", scope: "SUBJECT", subjectKey: "unknown-subject", displayName: "Unknown", instructions: "Invalid." }) } }, fixture.admin), /subject|canonical|Material/i);
    assert.throws(() => fixture.database.client.prepare("update ai_instruction_policies set scope = 'GLOBAL', subject_key = null where id = ?").run(biology.id), /immutable/i);
    assert.equal(fixture.instructions.getById(biology.id)!.subjectKey, "biology");
  } finally {
    fixture.close();
  }
});

test("Context Policies validate safe token budgets and publish immutable revisions", () => {
  const fixture = createFixture();
  try {
    assert.throws(() => publishContext(fixture, contextContent({ softInputBudgetTokens: 101, hardInputBudgetTokens: 100 })), /budget|invalid/i);
    assert.throws(() => publishContext(fixture, contextContent({ outputReserveTokens: 0 })), /reserve|invalid/i);
    const created = publishContext(fixture, contextContent());
    assert.equal(fixture.contexts.getById(created.id)!.currentRevision, 1);
    const revision = updateContext(fixture, created.id, contextContent({ displayName: "Synthetic Context Policy v2", recentTurnsBudgetTokens: 80 }));
    assert.equal(revision, 2);
    assert.equal(fixture.contexts.getRevision(created.id, 1)!.recentTurnsBudgetTokens, 60);
    assert.equal(fixture.contexts.getRevision(created.id, 2)!.recentTurnsBudgetTokens, 80);
    assert.throws(() => fixture.database.client.prepare("update ai_context_policies set key = ? where id = ?").run("changed-context", created.id), /immutable/i);
  } finally {
    fixture.close();
  }
});

test("Context requires enabled Global and Subject Policies and preserves explicit precedence layers", () => {
  const fixture = createFixture();
  try {
    const pending = beginTurn(fixture);
    const context = publishContext(fixture, contextContent());
    assert.throws(() => fixture.context.build(PRINCIPAL, { responseId: pending.turn.response.id, contextPolicyId: context.id, estimator: estimator() }), /Global|published/i);
    const global = publishInstruction(fixture, instructionContent());
    assert.throws(() => fixture.context.build(PRINCIPAL, { responseId: pending.turn.response.id, contextPolicyId: context.id, estimator: estimator() }), /Subject|published/i);
    const subject = publishInstruction(fixture, instructionContent({ key: "biology-tutor-policy", scope: "SUBJECT", subjectKey: "biology", displayName: "Biology Policy", instructions: "Subject guidance is supplemental." }));
    const built = fixture.context.build(PRINCIPAL, { responseId: pending.turn.response.id, contextPolicyId: context.id, estimator: estimator() });
    assert.equal(built.plan.instructionLayers[0]!.authority, "GLOBAL");
    assert.equal(built.plan.instructionLayers[0]!.policyId, global.id);
    assert.equal(built.plan.instructionLayers[1]!.authority, "SUBJECT");
    assert.equal(built.plan.instructionLayers[1]!.policyId, subject.id);
    assert.equal(built.plan.precedenceEnvelope.includes("must never override"), true);
    assert.deepEqual(built.plan.decisions.slice(0, 3).map((decision) => decision.kind), ["PRECEDENCE_ENVELOPE", "GLOBAL_POLICY", "SUBJECT_POLICY"]);
    updateInstruction(fixture, global.id, instructionContent({ enabled: false, instructions: "Disabled global revision." }));
    expectCode(() => fixture.context.build(PRINCIPAL, { responseId: pending.turn.response.id, contextPolicyId: context.id, estimator: estimator() }), "AI_POLICY_DISABLED");
  } finally {
    fixture.close();
  }
});

test("ContextBudgetManager fails closed for policy and hard limits without truncating mandatory text", () => {
  const fixture = createFixture();
  try {
    const policies = setupPolicies(fixture);
    const pending = beginTurn(fixture);
    const global = fixture.instructions.getCurrentRevision(policies.global.id)!;
    const subject = fixture.instructions.getCurrentRevision(policies.subject.id)!;
    const contextPolicy = fixture.contexts.getCurrentRevision(policies.context.id)!;
    const hardEstimator = estimator("unit");
    const manager = new ContextBudgetManager();
    const hardLimitPolicy = { ...contextPolicy, softInputBudgetTokens: 3, hardInputBudgetTokens: 3, policyBudgetTokens: 3, recentTurnsBudgetTokens: 0, summaryBudgetTokens: 0, memoryBudgetTokens: 0, evidenceBudgetTokens: 0 };
    expectCode(() => manager.build({ conversationId: pending.conversation.id, subjectKey: "biology", globalPolicy: global, subjectPolicy: subject, contextPolicy: hardLimitPolicy, currentMessage: pending.turn.userMessage, previousMessages: [], estimator: hardEstimator }), "AI_CONTEXT_HARD_LIMIT_EXCEEDED");
    const policyBudgetPolicy = { ...contextPolicy, softInputBudgetTokens: 100, hardInputBudgetTokens: 100, policyBudgetTokens: 3, recentTurnsBudgetTokens: 0, summaryBudgetTokens: 0, memoryBudgetTokens: 0, evidenceBudgetTokens: 0 };
    const twoTokenEstimator: AIContextTokenEstimator = { estimatorKey: "test.two", estimate: (text) => text.trim() ? 2 : 0 };
    expectCode(() => manager.build({ conversationId: pending.conversation.id, subjectKey: "biology", globalPolicy: global, subjectPolicy: subject, contextPolicy: policyBudgetPolicy, currentMessage: pending.turn.userMessage, previousMessages: [], estimator: twoTokenEstimator }), "AI_CONTEXT_POLICY_BUDGET_EXCEEDED");
    expectCode(() => manager.build({ conversationId: pending.conversation.id, subjectKey: "biology", globalPolicy: global, subjectPolicy: subject, contextPolicy, currentMessage: pending.turn.userMessage, previousMessages: [], estimator: { estimatorKey: "test.invalid", estimate: () => Number.NaN } }), "AI_CONTEXT_ESTIMATOR_INVALID");
  } finally {
    fixture.close();
  }
});

test("Recent history is selected in newest complete turn units with a bounded query and restored chronological order", () => {
  const fixture = createFixture();
  try {
    const policies = setupPolicies(fixture, { softInputBudgetTokens: 10, hardInputBudgetTokens: 20, policyBudgetTokens: 10, summaryBudgetTokens: 0, recentTurnsBudgetTokens: 6, memoryBudgetTokens: 0, evidenceBudgetTokens: 0, maxRecentTurns: 3 });
    const conversation = fixture.conversations.createConversation(PRINCIPAL, "biology");
    for (let index = 1; index <= 4; index += 1) completeTurn(fixture, conversation.id, `previous-${index}`, `answer-${index}`);
    const current = fixture.conversations.beginTurn(PRINCIPAL, { conversationId: conversation.id, idempotencyKey: "current-history", userContent: "current" });
    const built = fixture.context.build(PRINCIPAL, { responseId: current.response.id, contextPolicyId: policies.context.id, estimator: estimator() });
    assert.deepEqual(built.plan.recentMessages.map((message) => message.content), ["previous-2", "answer-2", "previous-3", "answer-3", "previous-4", "answer-4"]);
    assert.equal(built.plan.recentMessages.some((message) => message.id === current.userMessage.id), false);
    assert.equal(built.plan.recentMessages.length, 6);
    assert.equal(built.plan.budget.totalInputTokens <= built.plan.budget.softInputBudgetTokens, true);
  } finally {
    fixture.close();
  }
});

test("Optional summaries are validated, included whole when they fit, and omitted whole when they do not", () => {
  const fixture = createFixture();
  try {
    const policies = setupPolicies(fixture, { softInputBudgetTokens: 10, hardInputBudgetTokens: 20, policyBudgetTokens: 10, summaryBudgetTokens: 2, recentTurnsBudgetTokens: 2, memoryBudgetTokens: 0, evidenceBudgetTokens: 0, maxRecentTurns: 1 });
    const conversation = fixture.conversations.createConversation(PRINCIPAL, "biology");
    const first = completeTurn(fixture, conversation.id, "old-user", "old-answer");
    const current = fixture.conversations.beginTurn(PRINCIPAL, { conversationId: conversation.id, idempotencyKey: "summary-current", userContent: "current" });
    const summaryRecord = new AIConversationSummaryService(fixture.database, { clock: () => BASE_TIME + 200 }).createRevision(PRINCIPAL, { conversationId: conversation.id, subjectKey: "biology", summaryText: "summary", coversThroughOrdinal: 2, now: BASE_TIME + 200 });
    const summary = { summaryId: summaryRecord.id, revision: summaryRecord.revision, conversationId: conversation.id, subjectKey: "biology", coversThroughOrdinal: 2, text: summaryRecord.summaryText! };
    const built = fixture.context.build(PRINCIPAL, { responseId: current.response.id, contextPolicyId: policies.context.id, estimator: estimator() });
    assert.equal(built.plan.summary?.summaryId, summaryRecord.id);
    assert.equal(built.plan.recentMessages.some((message) => message.ordinal <= first.userMessage.ordinal + 1), false);
    assert.equal(built.plan.decisions.find((decision) => decision.kind === "CONVERSATION_SUMMARY")?.decision, "INCLUDED");

    const global = fixture.instructions.getCurrentRevision(policies.global.id)!;
    const subject = fixture.instructions.getCurrentRevision(policies.subject.id)!;
    const contextPolicy = fixture.contexts.getCurrentRevision(policies.context.id)!;
    const tooLargeEstimator: AIContextTokenEstimator = { estimatorKey: "test.summary-large", estimate: (text) => text === "too large for the summary budget" ? 3 : (text.trim() ? 1 : 0) };
    const omitted = new ContextBudgetManager().build({ conversationId: conversation.id, subjectKey: "biology", globalPolicy: global, subjectPolicy: subject, contextPolicy, currentMessage: current.userMessage, previousMessages: fixture.conversations.listMessages(PRINCIPAL, conversation.id).filter((message) => message.ordinal > summary.coversThroughOrdinal && message.ordinal < current.userMessage.ordinal), estimator: tooLargeEstimator, summary: { ...summary, summaryId: "summary-2", text: "too large for the summary budget" } });
    assert.equal(omitted.summary, undefined);
    assert.equal(omitted.decisions.find((decision) => decision.kind === "CONVERSATION_SUMMARY")?.decision, "OMITTED");
    assert.equal(omitted.decisions.find((decision) => decision.kind === "CONVERSATION_SUMMARY")?.decisionReason, "SUMMARY_BUDGET_EXCEEDED");
  } finally {
    fixture.close();
  }
});

test("Subject policy selection is structurally isolated from another subject", () => {
  const fixture = createFixture();
  try {
    const policies = setupPolicies(fixture);
    const physics = publishInstruction(fixture, instructionContent({ key: "physics-tutor-policy", scope: "SUBJECT", subjectKey: "physics", displayName: "Physics Policy", instructions: "Physics guidance." }));
    const pending = beginTurn(fixture);
    const global = fixture.instructions.getCurrentRevision(policies.global.id)!;
    const physicsRevision = fixture.instructions.getCurrentRevision(physics.id)!;
    const contextPolicy = fixture.contexts.getCurrentRevision(policies.context.id)!;
    expectCode(() => new ContextBudgetManager().build({ conversationId: pending.conversation.id, subjectKey: "biology", globalPolicy: global, subjectPolicy: physicsRevision, contextPolicy, currentMessage: pending.turn.userMessage, previousMessages: [], estimator: estimator() }), "AI_POLICY_SUBJECT_MISMATCH");
    const built = fixture.context.build(PRINCIPAL, { responseId: pending.turn.response.id, contextPolicyId: policies.context.id, estimator: estimator() });
    assert.equal(built.plan.snapshot.subjectPolicyId, policies.subject.id);
  } finally {
    fixture.close();
  }
});

test("Context Snapshot is metadata-only, idempotent per Response, immutable, and safe across two SQLite connections", () => {
  const fixture = createFixture();
  let secondDatabase: ContentDatabase | null = null;
  try {
    const policies = setupPolicies(fixture);
    const pending = beginTurn(fixture, "biology", "snapshot-current");
    const first = fixture.context.build(PRINCIPAL, { responseId: pending.turn.response.id, contextPolicyId: policies.context.id, estimator: estimator() });
    const replay = fixture.context.build(PRINCIPAL, { responseId: pending.turn.response.id, contextPolicyId: policies.context.id, estimator: estimator() });
    assert.equal(replay.replayed, true);
    assert.equal(replay.plan.snapshot.id, first.plan.snapshot.id);
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_context_snapshots").get() as { count: number }).count, 1);
    assert.throws(() => fixture.database.client.prepare("update ai_context_snapshots set total_input_tokens = total_input_tokens + 1 where id = ?").run(first.plan.snapshot.id), /immutable/i);
    const item = fixture.context.listSnapshotItems(PRINCIPAL, pending.turn.response.id)[0]!;
    assert.throws(() => fixture.database.client.prepare("update ai_context_snapshot_items set decision = 'OMITTED' where snapshot_id = ? and ordinal = ?").run(item.snapshotId, item.ordinal), /immutable/i);
    const itemCount = (fixture.database.client.prepare("select count(*) as count from ai_context_snapshot_items where snapshot_id = ?").get(first.plan.snapshot.id) as { count: number }).count;
    assert.throws(() => fixture.database.client.prepare("delete from ai_context_snapshots where id = ?").run(first.plan.snapshot.id), /immutable/i);
    assert.throws(() => fixture.database.client.prepare("delete from ai_context_snapshot_items where snapshot_id = ? and ordinal = ?").run(item.snapshotId, item.ordinal), /immutable/i);
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_context_snapshots where id = ?").get(first.plan.snapshot.id) as { count: number }).count, 1);
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_context_snapshot_items where snapshot_id = ?").get(first.plan.snapshot.id) as { count: number }).count, itemCount);
    assert.equal(fixture.context.getSnapshot(PRINCIPAL, pending.turn.response.id).fingerprint, first.plan.snapshot.fingerprint);

    secondDatabase = openContentDatabase({ dataDirectory: fixture.root, migrationsDirectory });
    const secondContext = new AIContextService(secondDatabase);
    const second = secondContext.build(PRINCIPAL, { responseId: pending.turn.response.id, contextPolicyId: policies.context.id, estimator: estimator() });
    assert.equal(second.replayed, true);
    assert.equal(second.plan.snapshot.id, first.plan.snapshot.id);
    expectCode(() => fixture.context.build(PRINCIPAL, { responseId: pending.turn.response.id, contextPolicyId: policies.context.id, estimator: { ...estimator(), estimatorKey: "test.other" } }), "AI_CONTEXT_SNAPSHOT_CONFLICT");
  } finally {
    secondDatabase?.close();
    fixture.close();
  }
});

test("Policy revisions are pinned to the Response Snapshot and later revisions affect only new Responses", () => {
  const fixture = createFixture();
  try {
    const policies = setupPolicies(fixture);
    const first = beginTurn(fixture);
    const snapshotOne = fixture.context.build(PRINCIPAL, { responseId: first.turn.response.id, contextPolicyId: policies.context.id, estimator: estimator() }).plan.snapshot;
    updateInstruction(fixture, policies.global.id, instructionContent({ instructions: "Global revision two." }));
    updateInstruction(fixture, policies.subject.id, instructionContent({ key: "biology-tutor-policy", scope: "SUBJECT", subjectKey: "biology", displayName: "Synthetic Biology Policy v2", instructions: "Biology revision two." }));
    expectCode(() => fixture.context.build(PRINCIPAL, { responseId: first.turn.response.id, contextPolicyId: policies.context.id, estimator: estimator() }), "AI_CONTEXT_SNAPSHOT_CONFLICT");
    fixture.conversations.startResponse(PRINCIPAL, first.turn.response.id);
    fixture.conversations.appendResponseChunk(PRINCIPAL, first.turn.response.id, 0, "answer");
    fixture.conversations.completeResponse(PRINCIPAL, first.turn.response.id, "STOP");
    const second = fixture.conversations.beginTurn(PRINCIPAL, { conversationId: first.conversation.id, idempotencyKey: "revision-two-response", userContent: "new request" });
    const snapshotTwo = fixture.context.build(PRINCIPAL, { responseId: second.response.id, contextPolicyId: policies.context.id, estimator: estimator() }).plan.snapshot;
    assert.equal(snapshotOne.globalPolicyRevision, 1);
    assert.equal(snapshotOne.subjectPolicyRevision, 1);
    assert.equal(snapshotTwo.globalPolicyRevision, 2);
    assert.equal(snapshotTwo.subjectPolicyRevision, 2);
    assert.equal(fixture.context.getSnapshot(PRINCIPAL, first.turn.response.id).globalPolicyRevision, 1);
  } finally {
    fixture.close();
  }
});

test("Context deletion interaction purges raw C4 while retaining only metadata and minimized references", () => {
  const fixture = createFixture();
  try {
    const policies = setupPolicies(fixture);
    const marker = "TOP_SECRET_STUDENT_MESSAGE_42";
    const pending = beginTurn(fixture, "biology", marker);
    const built = fixture.context.build(PRINCIPAL, { responseId: pending.turn.response.id, contextPolicyId: policies.context.id, estimator: estimator() });
    const snapshotItemCount = (fixture.database.client.prepare("select count(*) as count from ai_context_snapshot_items where snapshot_id = ?").get(built.plan.snapshot.id) as { count: number }).count;
    assert.equal(built.plan.currentMessage.content, marker);
    const metadataBeforeDelete = JSON.stringify({ snapshot: built.plan.snapshot, items: fixture.context.listSnapshotItems(PRINCIPAL, pending.turn.response.id) });
    assert.equal(metadataBeforeDelete.includes(marker), false);
    assert.equal(JSON.stringify(fixture.database.client.prepare("select * from ai_context_snapshots").all()).includes(marker), false);
    assert.equal(JSON.stringify(fixture.database.client.prepare("select * from ai_context_snapshot_items").all()).includes(marker), false);
    assert.equal(JSON.stringify(fixture.database.client.prepare("select instructions from ai_instruction_policy_revisions").all()).includes(marker), false);
    assert.equal(JSON.stringify(fixture.database.client.prepare("select * from change_set_items").all()).includes(marker), false);
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_conversation_messages where content = ?").get(marker) as { count: number }).count, 1);
    fixture.conversations.deleteConversation(PRINCIPAL, pending.conversation.id);
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_conversation_messages where content = ?").get(marker) as { count: number }).count, 0);
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_context_snapshots where id = ?").get(built.plan.snapshot.id) as { count: number }).count, 1);
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_context_snapshot_items where snapshot_id = ?").get(built.plan.snapshot.id) as { count: number }).count, snapshotItemCount);
    assert.equal(JSON.stringify(fixture.database.client.prepare("select * from ai_context_snapshots").all()).includes(marker), false);
    expectCode(() => fixture.context.getSnapshot(PRINCIPAL, pending.turn.response.id), "AI_CONTEXT_RESPONSE_INVALID");
  } finally {
    fixture.close();
  }
});
