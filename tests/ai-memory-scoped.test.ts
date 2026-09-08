import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../src/server/admin-auth";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import { AIConversationService, type AIStudentPrincipal } from "../src/server/ai/conversations";
import {
  AI_MEMORY_POLICY_RESOURCE_TYPE,
  AIMemoryService,
  SQLiteAIMemoryPolicyRepository,
  SQLiteAIMemoryRepository,
  type AIMemoryPolicyContent,
  type AIMemorySourceEvidenceInput,
} from "../src/server/ai/memory";
import { createChangeManagementService } from "../src/server/change-management";
import { SQLiteCanonicalContentRepository } from "../src/server/canonical-content";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const BASE_TIME = 1_907_000_000_000;
const PRINCIPAL_A: AIStudentPrincipal = { principalRef: "scoped-memory-a", status: "ACTIVE" };
const PRINCIPAL_B: AIStudentPrincipal = { principalRef: "scoped-memory-b", status: "ACTIVE" };

interface Fixture {
  root: string;
  database: ContentDatabase;
  owner: AdminActor;
  admin: AdminActor;
  conversations: AIConversationService;
  policies: SQLiteAIMemoryPolicyRepository;
  memories: SQLiteAIMemoryRepository;
  memory: AIMemoryService;
  changes: ReturnType<typeof createChangeManagementService>;
  close(): void;
}

function createFixture(): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-memory-scoped-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  new SQLiteCanonicalContentRepository(database, () => BASE_TIME).bootstrap();
  const identities = new SQLiteAdminIdentityRepository(database);
  const ownerUser = identities.createInitialOwner({ id: uuidv7(), email: `${uuidv7()}@scoped-memory.test`, displayName: "Scoped Owner", passwordHash: "fixture", createdAt: BASE_TIME });
  const adminUser = identities.createAdmin({ id: uuidv7(), email: `${uuidv7()}@scoped-memory.test`, displayName: "Scoped Admin", passwordHash: "fixture", createdAt: BASE_TIME + 1 });
  const conversations = new AIConversationService(database, { clock: () => BASE_TIME + 100 });
  const policies = new SQLiteAIMemoryPolicyRepository(database);
  const memories = new SQLiteAIMemoryRepository(database);
  return {
    root,
    database,
    owner: { actorUserId: ownerUser.id, actorRole: "OWNER" },
    admin: { actorUserId: adminUser.id, actorRole: "ADMIN" },
    conversations,
    policies,
    memories,
    memory: new AIMemoryService(database, { policies, memories, conversations: undefined, clock: () => BASE_TIME + 100 }),
    changes: createChangeManagementService(database),
    close() { database.close(); try { rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }); } catch { /* Windows may retain a WAL handle briefly. */ } },
  };
}

function policyContent(scope: "GLOBAL" | "SUBJECT", subjectKey: string | null): AIMemoryPolicyContent {
  return {
    key: `scoped-memory-${scope.toLowerCase()}-${uuidv7()}`,
    scope,
    subjectKey,
    displayName: `${scope} Memory Policy`,
    enabled: true,
    allowedKinds: ["LEARNING_PREFERENCE", "EXPLANATION_PREFERENCE", "RESPONSE_DEPTH_PREFERENCE", "FORM_OF_ADDRESS", "PREFERRED_NAME", "LEARNING_DIFFICULTY", "STUDY_GOAL", "STUDY_PROGRESS", "LEARNING_STRATEGY_PREFERENCE"],
    targetActiveCount: 2,
    hardActiveMaximum: 5,
    maxSelectedPerRequest: 2,
    proposedHardMaximum: 5,
    perMemoryMaxBytes: 4096,
    retentionDays: 30,
    mutationEnabled: true,
    explicitMinConfidenceUnits: 0,
    inferredMinConfidenceUnits: 900_000,
    inferredMinDistinctEvidenceTurns: 2,
    candidateReviewRequired: false,
    maxSelectedMemories: 2,
  };
}

function publishPolicy(fixture: Fixture, content: AIMemoryPolicyContent): { id: string; revision: number } {
  const id = uuidv7();
  let change = fixture.changes.createChangeSet({ title: "Scoped Memory Policy", initialItem: { resourceType: AI_MEMORY_POLICY_RESOURCE_TYPE, resourceId: id, expectedRevision: 0, operation: "CREATE", desired: content } }, fixture.admin);
  change = fixture.changes.submit(change.changeSet.id, change.changeSet.revision, fixture.admin);
  change = fixture.changes.approve(change.changeSet.id, change.changeSet.revision, fixture.owner);
  const published = fixture.changes.publish(change.changeSet.id, change.changeSet.revision, fixture.owner);
  return { id, revision: published.changeSet.items[0]!.currentResourceRevision };
}

function completeTurn(fixture: Fixture, principal: AIStudentPrincipal, subjectKey: string, text: string, answer: string, at: number) {
  const conversation = fixture.conversations.createConversation(principal, subjectKey);
  const turn = fixture.conversations.beginTurn(principal, { conversationId: conversation.id, idempotencyKey: `scoped-turn-${uuidv7()}`, userContent: text });
  fixture.conversations.startResponse(principal, turn.response.id);
  fixture.conversations.appendResponseChunk(principal, turn.response.id, 0, answer);
  const completed = fixture.conversations.completeResponse(principal, turn.response.id, "STOP");
  return {
    conversation,
    source: {
      conversationId: conversation.id,
      responseId: turn.response.id,
      requestMessageId: turn.userMessage.id,
      assistantMessageId: completed.assistantMessage!.id,
      sourceStartOrdinal: turn.userMessage.ordinal,
      sourceEndOrdinal: completed.assistantMessage!.ordinal,
    } satisfies AIMemorySourceEvidenceInput,
  };
}

test("M10A2 stores Global and Subject Memory with strict principal/scope isolation", () => {
  const fixture = createFixture();
  try {
    const globalPolicy = publishPolicy(fixture, policyContent("GLOBAL", null));
    const biologyPolicy = publishPolicy(fixture, policyContent("SUBJECT", "biology"));
    const biologyTurn = completeTurn(fixture, PRINCIPAL_A, "biology", "Remember that I prefer examples.", "Understood.", BASE_TIME + 10);
    const global = fixture.memory.createExplicitActive(PRINCIPAL_A, { scope: "GLOBAL", subjectKey: null, kind: "EXPLANATION_PREFERENCE", text: "Prefers examples before rules.", confidenceUnits: 1_000_000, source: biologyTurn.source, memoryPolicyId: globalPolicy.id, memoryPolicyRevision: globalPolicy.revision, now: BASE_TIME + 20 });
    const subjectTurn = completeTurn(fixture, PRINCIPAL_A, "biology", "I confuse the two stages.", "Let us compare them.", BASE_TIME + 30);
    const subject = fixture.memory.createExplicitActive(PRINCIPAL_A, { scope: "SUBJECT", subjectKey: "biology", kind: "LEARNING_DIFFICULTY", text: "Often confuses the two stages.", confidenceUnits: 900_000, source: subjectTurn.source, memoryPolicyId: biologyPolicy.id, memoryPolicyRevision: biologyPolicy.revision, now: BASE_TIME + 40 });
    assert.equal(global.scope, "GLOBAL");
    assert.equal(global.subjectKey, null);
    assert.equal(subject.scope, "SUBJECT");
    assert.equal(subject.subjectKey, "biology");
    assert.equal(fixture.memory.listEligibleByScope(PRINCIPAL_A, "GLOBAL", null, { at: BASE_TIME + 50 }).length, 1);
    assert.equal(fixture.memory.listEligibleByScope(PRINCIPAL_A, "SUBJECT", "biology", { at: BASE_TIME + 50 }).length, 1);
    fixture.database.client.prepare("update ai_memories set status='DELETED', memory_text=null, deleted_at=?, updated_at=?, revision=revision+1, safe_review_code='PRINCIPAL_PURGED' where id=?").run(BASE_TIME + 51, BASE_TIME + 51, global.id);
    const directId = uuidv7();
    fixture.database.client.prepare("insert into ai_memories (id,principal_ref,scope,subject_key,memory_policy_id,memory_policy_revision,revision,status,visibility_scope,creation_origin,kind,source_conversation_id,source_start_ordinal,source_end_ordinal,memory_text,confidence_units,created_at,updated_at,reviewed_at,resolved_at,deleted_at,expires_at,safe_review_code,content_sha256) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(directId, PRINCIPAL_A.principalRef, "GLOBAL", null, globalPolicy.id, 1, 1, "ACTIVE", "PRINCIPAL_GLOBAL", "EXPLICIT", "EXPLANATION_PREFERENCE", biologyTurn.conversation.id, 1, 2, "direct-no-provenance", 900_000, BASE_TIME + 52, BASE_TIME + 52, BASE_TIME + 52, null, null, BASE_TIME + 52 + 30 * 86_400_000, "EXPLICIT_CREATED", null);
    assert.equal(fixture.memory.listEligibleByScope(PRINCIPAL_A, "GLOBAL", null, { at: BASE_TIME + 53 }).some((memory) => memory.memoryId === directId), false);
    assert.equal(fixture.memory.get(PRINCIPAL_B, global.id), null);
    assert.throws(() => fixture.memory.updateExplicitActive(PRINCIPAL_B, { memoryId: global.id, scope: "GLOBAL", subjectKey: null, expectedRevision: 1, kind: "EXPLANATION_PREFERENCE", text: "wrong owner", confidenceUnits: 1_000_000, source: biologyTurn.source }), /scope|owned|Memory/i);
    assert.throws(() => fixture.memory.updateExplicitActive(PRINCIPAL_A, { memoryId: subject.id, scope: "SUBJECT", subjectKey: "physics", expectedRevision: 1, kind: "LEARNING_DIFFICULTY", text: "wrong subject", confidenceUnits: 1_000_000, source: subjectTurn.source }), /scope|subject|owned/i);
    assert.throws(() => fixture.database.client.prepare("insert into ai_memories (id,principal_ref,scope,subject_key,memory_policy_id,memory_policy_revision,revision,status,visibility_scope,creation_origin,kind,source_conversation_id,source_start_ordinal,source_end_ordinal,memory_text,confidence_units,created_at,updated_at,reviewed_at,resolved_at,deleted_at,expires_at,safe_review_code,content_sha256) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(uuidv7(), PRINCIPAL_A.principalRef, "GLOBAL", "biology", globalPolicy.id, 1, 1, "ACTIVE", "PRINCIPAL_GLOBAL", "EXPLICIT", "EXPLANATION_PREFERENCE", biologyTurn.conversation.id, 1, 2, "invalid", 900_000, BASE_TIME + 60, BASE_TIME + 60, BASE_TIME + 60, null, null, BASE_TIME + 86_400_000, "EXPLICIT_CREATED", null), /scope|retention|constraint|invalid/i);
    assert.throws(() => fixture.database.client.prepare("insert into ai_memories (id,principal_ref,scope,subject_key,memory_policy_id,memory_policy_revision,revision,status,visibility_scope,creation_origin,kind,source_conversation_id,source_start_ordinal,source_end_ordinal,memory_text,confidence_units,created_at,updated_at,reviewed_at,resolved_at,deleted_at,expires_at,safe_review_code,content_sha256) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(uuidv7(), PRINCIPAL_A.principalRef, "SUBJECT", null, biologyPolicy.id, 1, 1, "PROPOSED", "PRINCIPAL_SUBJECT", "INFERRED", "LEARNING_DIFFICULTY", biologyTurn.conversation.id, 1, 2, "invalid", 900_000, BASE_TIME + 60, BASE_TIME + 60, null, null, null, BASE_TIME + 30 * 86_400_000, "INFERRED_PROPOSED", null), /scope|retention|constraint|invalid/i);
    assert.throws(() => fixture.memory.proposeInferred(PRINCIPAL_A, { scope: "GLOBAL", subjectKey: null, kind: "PREFERRED_NAME", text: "Abbas", confidenceUnits: 1_000_000, source: biologyTurn.source, memoryPolicyId: globalPolicy.id, memoryPolicyRevision: globalPolicy.revision, now: BASE_TIME + 61 }), /explicit|Global|kind/i);
    const preferred = fixture.memory.createExplicitActive(PRINCIPAL_A, { scope: "GLOBAL", subjectKey: null, kind: "PREFERRED_NAME", text: "Abbas", confidenceUnits: 1_000_000, source: biologyTurn.source, memoryPolicyId: globalPolicy.id, memoryPolicyRevision: 1, now: BASE_TIME + 70 });
    assert.throws(() => fixture.memory.createExplicitActive(PRINCIPAL_A, { scope: "GLOBAL", subjectKey: null, kind: "PREFERRED_NAME", text: "A different name", confidenceUnits: 1_000_000, source: biologyTurn.source, memoryPolicyId: globalPolicy.id, memoryPolicyRevision: 1, now: BASE_TIME + 71 }), /quota|constraint|Memory/i);
    assert.equal(preferred.status, "ACTIVE");
  } finally { fixture.close(); }
});

test("M10A2 policies support Global/Subject identities, bounded fields, and append-only revisions", () => {
  const fixture = createFixture();
  try {
    const global = publishPolicy(fixture, policyContent("GLOBAL", null));
    const subject = publishPolicy(fixture, policyContent("SUBJECT", "biology"));
    assert.equal(fixture.policies.getByScope("GLOBAL", null)?.scope, "GLOBAL");
    assert.equal(fixture.policies.getByScope("GLOBAL", null)?.subjectKey, null);
    assert.equal(fixture.policies.getByScope("SUBJECT", "biology")?.subjectKey, "biology");
    assert.equal(fixture.policies.getById(global.id)?.currentRevision, 1);
    assert.equal(fixture.policies.getById(subject.id)?.currentRevision, 1);
    assert.throws(() => publishPolicy(fixture, policyContent("GLOBAL", "biology")), /subject|scope|invalid/i);
    const updated = { ...policyContent("GLOBAL", null), key: fixture.policies.getById(global.id)!.key, scope: "GLOBAL" as const, subjectKey: null, targetActiveCount: 1, hardActiveMaximum: 3 };
    fixture.policies.appendRevision({ id: global.id, expectedRevision: 1, content: updated, actor: fixture.owner, now: BASE_TIME + 100 });
    assert.equal(fixture.policies.getCurrentRevision(global.id)?.revision, 2);
    assert.equal(fixture.policies.getRevision(global.id, 1)?.hardActiveMaximum, 5);
    assert.throws(() => fixture.database.client.prepare("update ai_memory_policy_revisions set hard_active_maximum=1 where memory_policy_id=? and revision=2").run(global.id), /immutable/i);
    const revision = fixture.policies.getCurrentRevision(global.id)!;
    assert.throws(() => fixture.database.client.prepare("insert into ai_memory_policy_revisions (id,memory_policy_id,revision,display_name,enabled,candidate_review_required,allowed_kinds,target_active_count,hard_active_maximum,max_selected_per_request,proposed_hard_maximum,per_memory_max_bytes,retention_days,max_selected_memories,mutation_enabled,explicit_min_confidence_units,inferred_min_confidence_units,inferred_min_distinct_evidence_turns,created_at,created_by) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(uuidv7(), global.id, revision.revision + 1, "invalid", 1, 0, JSON.stringify(revision.allowedKinds), 4, 3, 2, 2, 4096, 30, 2, 1, 0, 900_000, 2, BASE_TIME + 101, fixture.owner.actorUserId), /quota|constraint|invalid/i);
    assert.throws(() => fixture.database.client.prepare("update ai_memory_policies set scope='SUBJECT', subject_key='physics' where id=?").run(global.id), /immutable|lifecycle|scope/i);
  } finally { fixture.close(); }
});

test("M10A2 updates one logical Memory, rejects stale revisions, and controls lifecycle", () => {
  const fixture = createFixture();
  try {
    const policy = publishPolicy(fixture, policyContent("GLOBAL", null));
    const first = completeTurn(fixture, PRINCIPAL_A, "biology", "Remember detailed explanations.", "Okay.", BASE_TIME + 10);
    const memory = fixture.memory.createExplicitActive(PRINCIPAL_A, { scope: "GLOBAL", subjectKey: null, kind: "RESPONSE_DEPTH_PREFERENCE", text: "Prefers detailed explanations.", confidenceUnits: 950_000, source: first.source, memoryPolicyId: policy.id, memoryPolicyRevision: 1, now: BASE_TIME + 20 });
    const second = completeTurn(fixture, PRINCIPAL_A, "math", "Change that: prefer concise explanations.", "Understood.", BASE_TIME + 30);
    const updated = fixture.memory.updateExplicitActive(PRINCIPAL_A, { memoryId: memory.id, scope: "GLOBAL", subjectKey: null, expectedRevision: 1, kind: "RESPONSE_DEPTH_PREFERENCE", text: "Prefers concise explanations.", confidenceUnits: 950_000, source: second.source, now: BASE_TIME + 40 });
    assert.equal(updated.id, memory.id);
    assert.equal(updated.revision, 2);
    assert.equal(fixture.memory.listEligibleByScope(PRINCIPAL_A, "GLOBAL", null, { at: BASE_TIME + 50 })[0]!.text, "Prefers concise explanations.");
    assert.throws(() => fixture.memory.updateExplicitActive(PRINCIPAL_A, { memoryId: memory.id, scope: "GLOBAL", subjectKey: null, expectedRevision: 1, kind: "RESPONSE_DEPTH_PREFERENCE", text: "stale", confidenceUnits: 950_000, source: first.source }), /lifecycle|revision|changed|scope/i);
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_memories where principal_ref=?").get(PRINCIPAL_A.principalRef) as { count: number }).count, 1);
    const resolved = fixture.memory.resolve(PRINCIPAL_A, { memoryId: memory.id, scope: "GLOBAL", subjectKey: null, expectedRevision: 2, now: BASE_TIME + 60 });
    assert.equal(resolved.status, "RESOLVED");
    assert.equal(resolved.memoryText, null);
    assert.equal(fixture.memory.listEligibleByScope(PRINCIPAL_A, "GLOBAL", null, { at: BASE_TIME + 70 }).length, 0);
    assert.throws(() => fixture.memory.updateExplicitActive(PRINCIPAL_A, { memoryId: memory.id, scope: "GLOBAL", subjectKey: null, expectedRevision: 3, kind: "RESPONSE_DEPTH_PREFERENCE", text: "resurrect", confidenceUnits: 950_000, source: second.source }), /lifecycle|revision|scope/i);
    const expiring = fixture.memory.createExplicitActive(PRINCIPAL_A, { scope: "GLOBAL", subjectKey: null, kind: "STUDY_GOAL", text: "Review cells.", confidenceUnits: 700_000, source: second.source, memoryPolicyId: policy.id, memoryPolicyRevision: 1, now: BASE_TIME + 80 });
    const expired = fixture.memory.expire(PRINCIPAL_A, { memoryId: expiring.id, scope: "GLOBAL", subjectKey: null, expectedRevision: 1, now: BASE_TIME + 90 });
    assert.equal(expired.status, "EXPIRED");
    assert.equal(expired.memoryText, null);
  } finally { fixture.close(); }
});

test("M10A2 SQLite and service mutation boundaries require the current Policy thresholds", () => {
  const fixture = createFixture();
  try {
    const policy = publishPolicy(fixture, policyContent("SUBJECT", "biology"));
    const first = completeTurn(fixture, PRINCIPAL_A, "biology", "I confuse stages.", "Let us compare them.", BASE_TIME + 10);
    const second = completeTurn(fixture, PRINCIPAL_A, "biology", "I still confuse them.", "Here is another distinction.", BASE_TIME + 20);
    const inferred = fixture.memory.proposeInferred(PRINCIPAL_A, { scope: "SUBJECT", subjectKey: "biology", kind: "LEARNING_DIFFICULTY", text: "low-confidence inferred memory", confidenceUnits: 800_000, source: first.source, memoryPolicyId: policy.id, memoryPolicyRevision: policy.revision, now: BASE_TIME + 30 });
    fixture.memory.addProposedEvidence(PRINCIPAL_A, { memoryId: inferred.id, scope: "SUBJECT", subjectKey: "biology", expectedRevision: inferred.revision, source: second.source, now: BASE_TIME + 31 });
    assert.throws(() => fixture.database.client.prepare("update ai_memories set status='ACTIVE', reviewed_at=?, safe_review_code='INFERRED_ACTIVATED' where id=?").run(BASE_TIME + 32, inferred.id), /current|policy|mutation|confidence|constraint/i);

    const current = fixture.policies.getCurrentRevision(policy.id)!;
    const stricter = policyContent("SUBJECT", "biology");
    stricter.key = current.key;
    stricter.inferredMinConfidenceUnits = 950_000;
    let change = fixture.changes.createChangeSet({ title: "Stricter Memory Policy", initialItem: { resourceType: AI_MEMORY_POLICY_RESOURCE_TYPE, resourceId: policy.id, expectedRevision: current.revision, operation: "UPDATE", desired: stricter } }, fixture.admin);
    change = fixture.changes.submit(change.changeSet.id, change.changeSet.revision, fixture.admin);
    change = fixture.changes.approve(change.changeSet.id, change.changeSet.revision, fixture.owner);
    fixture.changes.publish(change.changeSet.id, change.changeSet.revision, fixture.owner);
    assert.throws(() => fixture.memory.createExplicitActive(PRINCIPAL_A, { scope: "SUBJECT", subjectKey: "biology", kind: "LEARNING_PREFERENCE", text: "historical bypass", confidenceUnits: 900_000, source: first.source, memoryPolicyId: policy.id, memoryPolicyRevision: 1, now: BASE_TIME + 40 }), /historical|revision|current|confidence/i);

    const globalPolicy = publishPolicy(fixture, policyContent("GLOBAL", null));
    const globalInsert = fixture.database.client.prepare("insert into ai_memories (id,principal_ref,scope,subject_key,memory_policy_id,memory_policy_revision,revision,status,visibility_scope,creation_origin,kind,source_conversation_id,source_start_ordinal,source_end_ordinal,memory_text,confidence_units,created_at,updated_at,reviewed_at,resolved_at,deleted_at,expires_at,safe_review_code,content_sha256) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    assert.throws(() => globalInsert.run(uuidv7(), PRINCIPAL_A.principalRef, "GLOBAL", null, globalPolicy.id, 1, 1, "PROPOSED", "PRINCIPAL_GLOBAL", "INFERRED", "PREFERRED_NAME", first.conversation.id, 1, 2, "inferred global name", 950_000, BASE_TIME + 41, BASE_TIME + 41, null, null, null, BASE_TIME + 41 + 30 * 86_400_000, "INFERRED_PROPOSED", null), /global|policy|mutation|invalid|constraint/i);
  } finally { fixture.close(); }
});

test("M10A2 inferred proposals accumulate distinct evidence and activate only through the internal gate", () => {
  const fixture = createFixture();
  try {
    const policy = publishPolicy(fixture, policyContent("SUBJECT", "biology"));
    const first = completeTurn(fixture, PRINCIPAL_A, "biology", "I confuse metaphase and anaphase.", "Let us compare them.", BASE_TIME + 10);
    const proposal = fixture.memory.proposeInferred(PRINCIPAL_A, { scope: "SUBJECT", subjectKey: "biology", kind: "LEARNING_DIFFICULTY", text: "Repeatedly confuses metaphase and anaphase.", confidenceUnits: 950_000, source: first.source, memoryPolicyId: policy.id, memoryPolicyRevision: 1, now: BASE_TIME + 20 });
    assert.equal(proposal.status, "PROPOSED");
    assert.equal(fixture.memory.listEligible(PRINCIPAL_A, "biology", { at: BASE_TIME + 21 }).length, 0);
    assert.throws(() => fixture.memory.activateInferred(PRINCIPAL_A, { memoryId: proposal.id, scope: "SUBJECT", subjectKey: "biology", expectedRevision: 1, now: BASE_TIME + 22 }), /evidence|enough|provenance/i);
    const second = completeTurn(fixture, PRINCIPAL_A, "biology", "I still mix those stages.", "Here is a distinction.", BASE_TIME + 30);
    const evidence = fixture.memory.addProposedEvidence(PRINCIPAL_A, { memoryId: proposal.id, scope: "SUBJECT", subjectKey: "biology", expectedRevision: 1, source: second.source, now: BASE_TIME + 40 });
    assert.equal(evidence.sourceState, "ACTIVE");
    assert.throws(() => fixture.memory.addProposedEvidence(PRINCIPAL_A, { memoryId: proposal.id, scope: "SUBJECT", subjectKey: "biology", expectedRevision: 1, source: second.source, now: BASE_TIME + 41 }), /provenance|already|duplicate|constraint/i);
    const active = fixture.memory.activateInferred(PRINCIPAL_A, { memoryId: proposal.id, scope: "SUBJECT", subjectKey: "biology", expectedRevision: 1, now: BASE_TIME + 50 });
    assert.equal(active.status, "ACTIVE");
    assert.equal(active.revision, 2);
    assert.equal(fixture.memory.listEligible(PRINCIPAL_A, "biology", { at: BASE_TIME + 51 }).length, 1);
  } finally { fixture.close(); }
});

test("M10B2 keeps an inferred Agent command as PROPOSED when Student review is required", () => {
  const fixture = createFixture();
  try {
    const policy = publishPolicy(fixture, { ...policyContent("SUBJECT", "biology"), candidateReviewRequired: true, inferredMinDistinctEvidenceTurns: 1 });
    const turn = completeTurn(fixture, PRINCIPAL_A, "biology", "I mix two stages.", "Let us compare them.", BASE_TIME + 10);
    const intent = fixture.memory.createMutationIntent({ commandId: `agent-command-${uuidv7()}`, principal: PRINCIPAL_A, responseId: turn.source.responseId, conversationId: turn.source.conversationId, scope: "SUBJECT", subjectKey: "biology", action: "CREATE", kind: "LEARNING_DIFFICULTY", origin: "INFERRED", confidenceUnits: 950_000, memoryText: "The Student mixes two stages.", createdAt: BASE_TIME + 20 });
    const record = fixture.memory.applyMutationIntent(intent.commandId, BASE_TIME + 21);
    assert.equal(record.status, "APPLIED");
    const memory = fixture.memory.get(PRINCIPAL_A, record.memoryId!, "biology")!;
    assert.equal(memory.status, "PROPOSED");
    assert.equal(fixture.memory.listEligible(PRINCIPAL_A, "biology", { at: BASE_TIME + 22 }).length, 0);
  } finally { fixture.close(); }
});

test("M10A2 rejects partial, cross-subject, cross-principal, and Eval synthetic provenance", () => {
  const fixture = createFixture();
  try {
    const global = publishPolicy(fixture, policyContent("GLOBAL", null));
    const biology = completeTurn(fixture, PRINCIPAL_A, "biology", "Remember examples.", "Okay.", BASE_TIME + 10);
    const physics = completeTurn(fixture, PRINCIPAL_A, "physics", "Remember physics detail.", "Okay.", BASE_TIME + 20);
    assert.throws(() => fixture.memory.createExplicitActive(PRINCIPAL_A, { scope: "SUBJECT", subjectKey: "biology", kind: "LEARNING_PREFERENCE", text: "wrong source", confidenceUnits: 900_000, source: physics.source }), /scope|subject/i);
    assert.throws(() => fixture.memory.createExplicitActive(PRINCIPAL_B, { scope: "GLOBAL", subjectKey: null, kind: "LEARNING_PREFERENCE", text: "wrong owner", confidenceUnits: 900_000, source: biology.source, memoryPolicyId: global.id, memoryPolicyRevision: 1 }), /provenance|Student|turn/i);
    const partialConversation = fixture.conversations.createConversation(PRINCIPAL_A, "biology");
    const partial = fixture.conversations.beginTurn(PRINCIPAL_A, { conversationId: partialConversation.id, idempotencyKey: `partial-${uuidv7()}`, userContent: "partial" });
    fixture.conversations.startResponse(PRINCIPAL_A, partial.response.id);
    fixture.conversations.appendResponseChunk(PRINCIPAL_A, partial.response.id, 0, "partial answer");
    fixture.conversations.failResponse(PRINCIPAL_A, partial.response.id);
    const partialSource: AIMemorySourceEvidenceInput = { conversationId: partialConversation.id, responseId: partial.response.id, requestMessageId: partial.userMessage.id, assistantMessageId: partial.response.assistantMessageId!, sourceStartOrdinal: 1, sourceEndOrdinal: 2 };
    assert.throws(() => fixture.memory.createExplicitActive(PRINCIPAL_A, { scope: "GLOBAL", subjectKey: null, kind: "LEARNING_PREFERENCE", text: "partial", confidenceUnits: 900_000, source: partialSource, memoryPolicyId: global.id, memoryPolicyRevision: 1 }), /provenance|completed|Student/i);
    const synthetic = fixture.database.client.transaction(() => fixture.conversations.createConversationInTransaction({ principalRef: "eval-synthetic", status: "ACTIVE" }, { conversationId: uuidv7(), subjectKey: "biology", createdAt: BASE_TIME + 60, origin: "EVAL_SYNTHETIC" }))();
    const syntheticTurn = fixture.conversations.beginTurn({ principalRef: "eval-synthetic", status: "ACTIVE" }, { conversationId: synthetic.id, idempotencyKey: `synthetic-${uuidv7()}`, userContent: "synthetic" });
    fixture.conversations.startResponse({ principalRef: "eval-synthetic", status: "ACTIVE" }, syntheticTurn.response.id);
    fixture.conversations.appendResponseChunk({ principalRef: "eval-synthetic", status: "ACTIVE" }, syntheticTurn.response.id, 0, "synthetic answer");
    const syntheticDone = fixture.conversations.completeResponse({ principalRef: "eval-synthetic", status: "ACTIVE" }, syntheticTurn.response.id, "STOP");
    assert.throws(() => fixture.memory.createExplicitActive(PRINCIPAL_A, { scope: "GLOBAL", subjectKey: null, kind: "LEARNING_PREFERENCE", text: "synthetic", confidenceUnits: 900_000, source: { conversationId: synthetic.id, responseId: syntheticTurn.response.id, requestMessageId: syntheticTurn.userMessage.id, assistantMessageId: syntheticDone.assistantMessage!.id, sourceStartOrdinal: 1, sourceEndOrdinal: 2 }, memoryPolicyId: global.id, memoryPolicyRevision: 1 }), /provenance|Student|source/i);
  } finally { fixture.close(); }
});

test("M10A2 deletion preserves explicit Memory, reconciles inferred evidence, and purges principals", () => {
  const fixture = createFixture();
  try {
    const global = publishPolicy(fixture, policyContent("GLOBAL", null));
    const subject = publishPolicy(fixture, policyContent("SUBJECT", "biology"));
    const explicitTurn = completeTurn(fixture, PRINCIPAL_A, "biology", "Remember examples.", "Okay.", BASE_TIME + 10);
    const explicit = fixture.memory.createExplicitActive(PRINCIPAL_A, { scope: "GLOBAL", subjectKey: null, kind: "EXPLANATION_PREFERENCE", text: "Prefers examples.", confidenceUnits: 1_000_000, source: explicitTurn.source, memoryPolicyId: global.id, memoryPolicyRevision: 1, now: BASE_TIME + 20 });
    const evidenceTurns = [
      completeTurn(fixture, PRINCIPAL_A, "biology", "I confuse A and B.", "Compare them.", BASE_TIME + 30),
      completeTurn(fixture, PRINCIPAL_A, "biology", "I still confuse A and B.", "Use this distinction.", BASE_TIME + 40),
      completeTurn(fixture, PRINCIPAL_A, "biology", "Again A and B are confusing.", "Let us practice.", BASE_TIME + 50),
    ];
    const inferred = fixture.memory.proposeInferred(PRINCIPAL_A, { scope: "SUBJECT", subjectKey: "biology", kind: "LEARNING_DIFFICULTY", text: "Repeatedly confuses A and B.", confidenceUnits: 950_000, source: evidenceTurns[0]!.source, evidence: [evidenceTurns[1]!.source, evidenceTurns[2]!.source], memoryPolicyId: subject.id, memoryPolicyRevision: 1, now: BASE_TIME + 60 });
    const active = fixture.memory.activateInferred(PRINCIPAL_A, { memoryId: inferred.id, scope: "SUBJECT", subjectKey: "biology", expectedRevision: 1, now: BASE_TIME + 61 });
    fixture.conversations.deleteConversation(PRINCIPAL_A, explicitTurn.conversation.id);
    fixture.conversations.deleteConversation(PRINCIPAL_A, evidenceTurns[0]!.conversation.id);
    assert.equal(fixture.memory.get(PRINCIPAL_A, explicit.id)!.status, "ACTIVE");
    assert.equal(fixture.memory.get(PRINCIPAL_A, explicit.id)!.memoryText, "Prefers examples.");
    assert.equal(fixture.memory.listProvenance(explicit.id)[0]!.sourceState, "DELETED");
    assert.equal(fixture.memory.listEligibleByScope(PRINCIPAL_A, "GLOBAL", null, { at: BASE_TIME + 70 }).some((memory) => memory.memoryId === explicit.id), true);
    assert.equal(fixture.memory.get(PRINCIPAL_A, active.id)!.status, "ACTIVE");
    fixture.conversations.deleteConversation(PRINCIPAL_A, evidenceTurns[1]!.conversation.id);
    assert.equal(fixture.memory.get(PRINCIPAL_A, active.id)!.status, "RESOLVED");
    assert.equal(fixture.memory.get(PRINCIPAL_A, active.id)!.memoryText, null);
    const subjectTurn = completeTurn(fixture, PRINCIPAL_A, "biology", "Keep progress.", "Okay.", BASE_TIME + 80);
    const purgeMemory = fixture.memory.createExplicitActive(PRINCIPAL_A, { scope: "SUBJECT", subjectKey: "biology", kind: "STUDY_PROGRESS", text: "Working through the chapter.", confidenceUnits: 700_000, source: subjectTurn.source, memoryPolicyId: subject.id, memoryPolicyRevision: 1, now: BASE_TIME + 90 });
    fixture.memory.purgePrincipalInTransaction(PRINCIPAL_A.principalRef, BASE_TIME + 100);
    assert.equal(fixture.memory.get(PRINCIPAL_A, explicit.id)!.status, "DELETED");
    assert.equal(fixture.memory.get(PRINCIPAL_A, purgeMemory.id)!.status, "DELETED");
    assert.equal(fixture.memory.get(PRINCIPAL_B, purgeMemory.id), null);
  } finally { fixture.close(); }
});

test("M10A2 mutation intents are bounded C4, idempotent, and scrub raw text after apply", () => {
  const fixture = createFixture();
  try {
    const global = publishPolicy(fixture, policyContent("GLOBAL", null));
    const turn = completeTurn(fixture, PRINCIPAL_A, "biology", "Remember my example preference.", "Okay.", BASE_TIME + 10);
    const marker = "PRIVATE_PENDING_MEMORY_INTENT_M10A2";
    const intent = fixture.memory.createMutationIntent({ commandId: `command-${uuidv7()}`, principal: PRINCIPAL_A, responseId: turn.source.responseId, conversationId: turn.source.conversationId, scope: "GLOBAL", subjectKey: null, action: "CREATE", kind: "EXPLANATION_PREFERENCE", origin: "EXPLICIT", confidenceUnits: 1_000_000, memoryText: marker, createdAt: BASE_TIME + 20 });
    assert.equal(intent.status, "PENDING");
    assert.equal(intent.memoryText, marker);
    const record = fixture.memory.applyMutationIntent(intent.commandId, BASE_TIME + 30);
    assert.equal(record.status, "APPLIED");
    assert.equal(fixture.memory.applyMutationIntent(intent.commandId, BASE_TIME + 31).id, record.id);
    const applied = fixture.memory.getMutationIntent(intent.commandId)!;
    assert.equal(applied.memoryText, null);
    assert.equal(applied.status, "APPLIED");
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_memories where memory_text=?").get(marker) as { count: number }).count, 1);
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_memory_mutation_records where command_id=?").get(intent.commandId) as { count: number }).count, 1);
    assert.equal(JSON.stringify(fixture.database.client.prepare("select * from ai_memory_mutation_records where command_id=?").get(intent.commandId)).includes(marker), false);
    assert.equal(fixture.memory.listEligibleByScope(PRINCIPAL_A, "GLOBAL", null, { at: BASE_TIME + 40 }).length, 1);
    const mutationRow = fixture.database.client.prepare("select memory_id from ai_memory_mutation_records where command_id=?").get(intent.commandId) as { memory_id: string };
    assert.equal(fixture.memory.get(PRINCIPAL_A, mutationRow.memory_id)!.memoryPolicyId, global.id);
    const pending = fixture.memory.createMutationIntent({ commandId: `pending-${uuidv7()}`, principal: PRINCIPAL_A, responseId: turn.source.responseId, conversationId: turn.source.conversationId, scope: "GLOBAL", subjectKey: null, action: "CREATE", kind: "STUDY_GOAL", origin: "EXPLICIT", confidenceUnits: 800_000, memoryText: "PRIVATE_PENDING_PURGE", createdAt: BASE_TIME + 41 });
    fixture.memory.purgePrincipalInTransaction(PRINCIPAL_A.principalRef, BASE_TIME + 200);
    assert.equal(fixture.memory.getMutationIntent(pending.commandId)!.status, "CANCELLED");
    assert.equal(fixture.memory.getMutationIntent(pending.commandId)!.memoryText, null);
    for (let index = 0; index < 101; index += 1) {
      fixture.memory.createMutationIntent({ commandId: `purge-pending-${uuidv7()}`, principal: PRINCIPAL_A, responseId: turn.source.responseId, conversationId: turn.source.conversationId, scope: "GLOBAL", subjectKey: null, action: "CREATE", kind: "STUDY_GOAL", origin: "EXPLICIT", confidenceUnits: 800_000, memoryText: `PRIVATE_PENDING_PURGE_${index}`, createdAt: BASE_TIME + 300 + index });
    }
    const firstBatch = fixture.memory.purgePrincipalBatch(PRINCIPAL_A.principalRef, BASE_TIME + 500);
    assert.equal(firstBatch.remainingWork, true);
    assert.equal(firstBatch.remainingIntents, 1);
    const secondBatch = fixture.memory.purgePrincipalBatch(PRINCIPAL_A.principalRef, BASE_TIME + 501);
    assert.equal(secondBatch.remainingWork, false);
    assert.equal(secondBatch.remainingIntents, 0);
  } finally { fixture.close(); }
});

test("M10A2 migrates a populated 0042 database to scoped legacy Subject Memory without inventing Global rows", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-memory-0042-upgrade-"));
  const oldMigrations = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-memory-0042-migrations-"));
  let oldDatabase: ContentDatabase | null = null;
  let upgraded: ContentDatabase | null = null;
  try {
    mkdirSync(path.join(oldMigrations, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(path.join(migrationsDirectory, "meta", "_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }> };
    const entries = journal.entries.slice(0, 43);
    for (const entry of entries) {
      copyFileSync(path.join(migrationsDirectory, `${entry.tag}.sql`), path.join(oldMigrations, `${entry.tag}.sql`));
      const snapshot = `${entry.idx.toString().padStart(4, "0")}_snapshot.json`;
      if (existsSync(path.join(migrationsDirectory, "meta", snapshot))) copyFileSync(path.join(migrationsDirectory, "meta", snapshot), path.join(oldMigrations, "meta", snapshot));
    }
    writeFileSync(path.join(oldMigrations, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
    oldDatabase = openContentDatabase({ dataDirectory: root, migrationsDirectory: oldMigrations });
    assert.equal((oldDatabase.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count, 43);
    new SQLiteCanonicalContentRepository(oldDatabase, () => BASE_TIME).bootstrap();
    const ownerUser = new SQLiteAdminIdentityRepository(oldDatabase).createInitialOwner({ id: uuidv7(), email: `${uuidv7()}@scoped-upgrade.test`, displayName: "Upgrade Owner", passwordHash: "fixture", createdAt: BASE_TIME });
    const policyId = uuidv7();
    oldDatabase.client.prepare("insert into ai_memory_policies (id,key,subject_key,current_revision,created_at,updated_at,created_by,updated_by) values (?,?,?,?,?,?,?,?)").run(policyId, "legacy-subject-policy", "biology", 1, BASE_TIME + 1, BASE_TIME + 1, ownerUser.id, ownerUser.id);
    oldDatabase.client.prepare("insert into ai_memory_policy_revisions (id,memory_policy_id,revision,display_name,enabled,candidate_review_required,retention_days,max_selected_memories,created_at,created_by) values (?,?,?,?,?,?,?,?,?,?)").run(uuidv7(), policyId, 1, "Legacy Subject Policy", 1, 1, 30, 3, BASE_TIME + 1, ownerUser.id);
    const conversations = new AIConversationService(oldDatabase, { clock: () => BASE_TIME + 2 });
    const conversation = conversations.createConversation(PRINCIPAL_A, "biology");
    const turn = conversations.beginTurn(PRINCIPAL_A, { conversationId: conversation.id, idempotencyKey: `legacy-${uuidv7()}`, userContent: "legacy source" });
    conversations.startResponse(PRINCIPAL_A, turn.response.id);
    conversations.appendResponseChunk(PRINCIPAL_A, turn.response.id, 0, "legacy answer");
    conversations.completeResponse(PRINCIPAL_A, turn.response.id, "STOP");
    oldDatabase.client.prepare("insert into ai_memories (id,principal_ref,subject_key,memory_policy_id,memory_policy_revision,revision,status,visibility_scope,creation_origin,kind,source_conversation_id,source_start_ordinal,source_end_ordinal,memory_text,confidence_units,created_at,reviewed_at,deleted_at,expires_at,safe_review_code) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(uuidv7(), PRINCIPAL_A.principalRef, "biology", policyId, 1, 1, "CANDIDATE", "PRINCIPAL_SUBJECT", "CONVERSATION", "LEARNING_DIFFICULTY", conversation.id, 1, 2, "LEGACY_MEMORY_TEXT", 700_000, BASE_TIME + 10, null, null, BASE_TIME + 10 + 30 * 86_400_000, null);
    oldDatabase.close();
    oldDatabase = null;
    upgraded = openContentDatabase({ dataDirectory: root, migrationsDirectory });
    assert.equal((upgraded.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count, 47);
    assert.equal((upgraded.client.prepare("select count(*) as count from ai_memories where scope='GLOBAL'").get() as { count: number }).count, 0);
    assert.deepEqual(upgraded.client.prepare("select scope,subject_key,creation_origin,status,memory_text from ai_memories").get(), { scope: "SUBJECT", subject_key: "biology", creation_origin: "LEGACY_SUBJECT", status: "PROPOSED", memory_text: "LEGACY_MEMORY_TEXT" });
    assert.deepEqual(upgraded.client.prepare("select scope,subject_key from ai_memory_policies where id=?").get(policyId), { scope: "SUBJECT", subject_key: "biology" });
    assert.equal((upgraded.client.prepare("select m10a2_mutation_authority from ai_memory_policies where id=?").get(policyId) as { m10a2_mutation_authority: number }).m10a2_mutation_authority, 0);
    assert.equal((upgraded.client.prepare("select origin from ai_conversations where id=?").get(conversation.id) as { origin: string }).origin, "STUDENT");
    for (const trigger of ["ai_memories_insert_valid", "ai_memories_lifecycle_valid", "ai_memories_no_delete", "ai_memories_current_policy_insert_valid", "ai_memories_current_policy_update_valid", "ai_memory_provenance_insert_valid", "ai_memory_mutation_intents_insert_valid", "ai_memory_executions_lifecycle_valid"]) assert.ok(upgraded.client.prepare("select name from sqlite_master where type='trigger' and name=?").get(trigger));
  } finally {
    oldDatabase?.close();
    upgraded?.close();
    try { rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }); } catch { /* Windows may retain a WAL handle briefly. */ }
    try { rmSync(oldMigrations, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }); } catch { /* Windows may retain a WAL handle briefly. */ }
  }
});

test("M10A2 migrates populated 0043 Memory rows and cuts over legacy mutation authority", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-memory-0043-upgrade-"));
  const oldMigrations = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-memory-0043-migrations-"));
  let oldDatabase: ContentDatabase | null = null;
  let upgraded: ContentDatabase | null = null;
  try {
    mkdirSync(path.join(oldMigrations, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(path.join(migrationsDirectory, "meta", "_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }> };
    const entries = journal.entries.slice(0, 44);
    for (const entry of entries) {
      copyFileSync(path.join(migrationsDirectory, `${entry.tag}.sql`), path.join(oldMigrations, `${entry.tag}.sql`));
      const snapshot = `${entry.idx.toString().padStart(4, "0")}_snapshot.json`;
      if (existsSync(path.join(migrationsDirectory, "meta", snapshot))) copyFileSync(path.join(migrationsDirectory, "meta", snapshot), path.join(oldMigrations, "meta", snapshot));
    }
    writeFileSync(path.join(oldMigrations, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
    oldDatabase = openContentDatabase({ dataDirectory: root, migrationsDirectory: oldMigrations });
    assert.equal((oldDatabase.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count, 44);
    new SQLiteCanonicalContentRepository(oldDatabase, () => BASE_TIME).bootstrap();
    const ownerUser = new SQLiteAdminIdentityRepository(oldDatabase).createInitialOwner({ id: uuidv7(), email: `${uuidv7()}@memory-0043-upgrade.test`, displayName: "Memory 0043 Owner", passwordHash: "fixture", createdAt: BASE_TIME });
    const policyId = uuidv7();
    oldDatabase.client.prepare("insert into ai_memory_policies (id,key,scope,subject_key,current_revision,created_at,updated_at,created_by,updated_by) values (?,?,?,?,?,?,?,?,?)").run(policyId, "memory-0043-policy", "SUBJECT", "biology", 1, BASE_TIME + 1, BASE_TIME + 1, ownerUser.id, ownerUser.id);
    oldDatabase.client.prepare("insert into ai_memory_policy_revisions (id,memory_policy_id,revision,display_name,enabled,candidate_review_required,allowed_kinds,target_active_count,hard_active_maximum,max_selected_per_request,proposed_hard_maximum,per_memory_max_bytes,retention_days,max_selected_memories,mutation_enabled,explicit_min_confidence_units,inferred_min_confidence_units,inferred_min_distinct_evidence_turns,created_at,created_by) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(uuidv7(), policyId, 1, "Memory 0043 Policy", 1, 1, JSON.stringify(["LEARNING_PREFERENCE"]), 3, 10, 3, 5, 4096, 30, 3, 1, 0, 900_000, 2, BASE_TIME + 1, ownerUser.id);
    const conversations = new AIConversationService(oldDatabase, { clock: () => BASE_TIME + 2 });
    const principal: AIStudentPrincipal = { principalRef: "memory-0043-student", status: "ACTIVE" };
    const conversation = conversations.createConversation(principal, "biology");
    const turn = conversations.beginTurn(principal, { conversationId: conversation.id, idempotencyKey: `memory-0043-turn-${uuidv7()}`, userContent: "I prefer worked examples." });
    conversations.startResponse(principal, turn.response.id);
    conversations.appendResponseChunk(principal, turn.response.id, 0, "Here is one.");
    conversations.completeResponse(principal, turn.response.id, "STOP");
    const memoryId = uuidv7();
    const createdAt = BASE_TIME + 10;
    oldDatabase.client.prepare("insert into ai_memories (id,principal_ref,scope,subject_key,memory_policy_id,memory_policy_revision,revision,status,visibility_scope,creation_origin,kind,source_conversation_id,source_start_ordinal,source_end_ordinal,memory_text,confidence_units,created_at,updated_at,reviewed_at,resolved_at,deleted_at,expires_at,safe_review_code,content_sha256) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(memoryId, principal.principalRef, "SUBJECT", "biology", policyId, 1, 1, "PROPOSED", "PRINCIPAL_SUBJECT", "INFERRED", "LEARNING_PREFERENCE", conversation.id, 1, 2, "UPGRADE_0043_MEMORY_TEXT", 900_000, createdAt, createdAt, null, null, null, createdAt + 30 * 86_400_000, "INFERRED_PROPOSED", null);
    oldDatabase.close();
    oldDatabase = null;

    upgraded = openContentDatabase({ dataDirectory: root, migrationsDirectory });
    assert.equal((upgraded.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count, 47);
    assert.deepEqual(upgraded.client.prepare("select key,scope,subject_key,current_revision,m10a2_mutation_authority from ai_memory_policies where id=?").get(policyId), { key: "memory-0043-policy", scope: "SUBJECT", subject_key: "biology", current_revision: 1, m10a2_mutation_authority: 0 });
    assert.deepEqual(upgraded.client.prepare("select status,creation_origin,kind,memory_text,confidence_units from ai_memories where id=?").get(memoryId), { status: "PROPOSED", creation_origin: "INFERRED", kind: "LEARNING_PREFERENCE", memory_text: "UPGRADE_0043_MEMORY_TEXT", confidence_units: 900_000 });
    for (const trigger of ["ai_memory_policies_m10a2_authority_immutable", "ai_memories_current_policy_insert_valid", "ai_memories_current_policy_update_valid", "ai_memories_current_inferred_evidence_valid"]) assert.ok(upgraded.client.prepare("select name from sqlite_master where type='trigger' and name=?").get(trigger));
    const upgradedConversations = new AIConversationService(upgraded, { clock: () => BASE_TIME + 100 });
    const newConversation = upgradedConversations.createConversation(principal, "biology");
    const newTurn = upgradedConversations.beginTurn(principal, { conversationId: newConversation.id, idempotencyKey: `memory-0043-new-${uuidv7()}`, userContent: "new mutation" });
    upgradedConversations.startResponse(principal, newTurn.response.id);
    upgradedConversations.appendResponseChunk(principal, newTurn.response.id, 0, "answer");
    upgradedConversations.completeResponse(principal, newTurn.response.id, "STOP");
    assert.throws(() => new AIMemoryService(upgraded!).createExplicitActive(principal, { scope: "SUBJECT", subjectKey: "biology", kind: "LEARNING_PREFERENCE", text: "must not mutate under legacy authority", confidenceUnits: 1_000_000, memoryPolicyId: policyId, memoryPolicyRevision: 1, source: { conversationId: newConversation.id, responseId: newTurn.response.id, requestMessageId: newTurn.userMessage.id, assistantMessageId: upgradedConversations.getResponse(principal, newTurn.response.id).assistantMessageId!, sourceStartOrdinal: 1, sourceEndOrdinal: 2 } }), /authority|policy|scope|mutation/i);
  } finally {
    oldDatabase?.close();
    upgraded?.close();
    try { rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }); } catch { /* Windows may retain a WAL handle briefly. */ }
    try { rmSync(oldMigrations, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }); } catch { /* Windows may retain a WAL handle briefly. */ }
  }
});
