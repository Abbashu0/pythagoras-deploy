import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";

import {
  AIConversationError,
  AIConversationService,
  AI_CONVERSATION_MAX_MESSAGE_PAGE_SIZE,
  SQLiteAIConversationSubjectCatalog,
  assertActiveStudentPrincipal,
  resolveActiveStudentPrincipal,
  validateAIStudentPrincipal,
  type AIConversation,
  type AIStudentPrincipal,
  type StudentPrincipalProvider,
} from "../src/server/ai/conversations";
import { SQLiteCanonicalContentRepository } from "../src/server/canonical-content";
import { aiConversationResponses } from "../src/server/content/schema";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const BASE_TIME = 1_901_100_000_000;

interface Fixture {
  root: string;
  database: ContentDatabase;
  service: AIConversationService;
  principalA: AIStudentPrincipal;
  principalB: AIStudentPrincipal;
  setNow(value: number): void;
  close(): void;
}

function createFixture(): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-conversations-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  new SQLiteCanonicalContentRepository(database, () => BASE_TIME).bootstrap();
  let now = BASE_TIME + 100;
  const service = new AIConversationService(database, { clock: () => now });
  return {
    root,
    database,
    service,
    principalA: { principalRef: "student-a", status: "ACTIVE" },
    principalB: { principalRef: "student-b", status: "ACTIVE" },
    setNow(value: number) {
      now = value;
    },
    close() {
      database.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
    },
  };
}

function expectCode(fn: () => unknown, code: AIConversationError["code"]): AIConversationError {
  let captured: unknown;
  try {
    fn();
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof AIConversationError);
  assert.equal(captured.code, code);
  return captured;
}

async function expectAsyncCode(fn: () => Promise<unknown>, code: AIConversationError["code"]): Promise<AIConversationError> {
  let captured: unknown;
  try {
    await fn();
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof AIConversationError);
  assert.equal(captured.code, code);
  return captured;
}

function countRows(fixture: Fixture, table: string): number {
  return Number((fixture.database.client.prepare(`select count(*) as count from ${table}`).get() as { count: number }).count);
}

function createConversation(fixture: Fixture, principal = fixture.principalA, subjectKey = "arabic"): AIConversation {
  return fixture.service.createConversation(principal, subjectKey);
}

test("StudentPrincipalProvider is fail-closed, validates opaque identity, and has no production auth implementation", async () => {
  const validProvider: StudentPrincipalProvider = { resolve: async () => ({ principalRef: "student-a", status: "ACTIVE" }) };
  assert.deepEqual(await resolveActiveStudentPrincipal(validProvider, { request: "server" }), { principalRef: "student-a", status: "ACTIVE" });
  await expectAsyncCode(() => resolveActiveStudentPrincipal({ resolve: async () => null }, {}), "AI_STUDENT_PRINCIPAL_UNAVAILABLE");
  await expectAsyncCode(() => resolveActiveStudentPrincipal({ resolve: async () => ({ principalRef: "student-a", status: "SUSPENDED" }) }, {}), "AI_STUDENT_PRINCIPAL_INACTIVE");
  assert.deepEqual(validateAIStudentPrincipal({ principalRef: "student_a", status: "ACTIVE", studentId: "ignored" }), { principalRef: "student_a", status: "ACTIVE" });
  expectCode(() => validateAIStudentPrincipal({ principalRef: "student@example.com", status: "ACTIVE" }), "AI_STUDENT_PRINCIPAL_UNAVAILABLE");
  expectCode(() => assertActiveStudentPrincipal({ principalRef: "student-a", status: "DELETED" }), "AI_STUDENT_PRINCIPAL_INACTIVE");
});

test("Conversation subjects come from canonical Material identity and availability is not treated as entitlement", () => {
  const fixture = createFixture();
  try {
    const catalog = new SQLiteAIConversationSubjectCatalog(fixture.database);
    assert.equal(catalog.getSubject("arabic")?.subjectKey, "arabic");
    assert.equal(catalog.getSubject("french")?.available, false);
    assert.equal(createConversation(fixture, fixture.principalA, "french").subjectKey, "french");
    expectCode(() => createConversation(fixture, fixture.principalA, "not-a-canonical-subject"), "AI_CONVERSATION_SUBJECT_INVALID");
  } finally {
    fixture.close();
  }
});

test("Conversation owner and subject are immutable at the SQLite boundary", () => {
  const fixture = createFixture();
  try {
    const conversation = createConversation(fixture);
    assert.throws(() => fixture.database.client.prepare("update ai_conversations set subject_key = ? where id = ?").run("biology", conversation.id), /immutable/i);
    assert.throws(() => fixture.database.client.prepare("update ai_conversations set principal_ref = ? where id = ?").run("student-b", conversation.id), /immutable/i);
    const turn = fixture.service.beginTurn(fixture.principalA, { conversationId: conversation.id, idempotencyKey: "immutable-message", userContent: "رسالة ثابتة" });
    assert.throws(() => fixture.database.client.prepare("update ai_conversation_messages set content = ? where id = ?").run("تعديل", turn.userMessage.id), /immutable/i);
    assert.throws(() => fixture.database.client.prepare("update ai_conversation_responses set principal_ref = ? where id = ?").run("student-b", turn.response.id), /immutable/i);
    assert.equal(fixture.service.getConversation(fixture.principalA, conversation.id).subjectKey, "arabic");
  } finally {
    fixture.close();
  }
});

test("Conversation listing is principal-private, subject-filterable, and deterministically cursor-paginated", () => {
  const fixture = createFixture();
  try {
    fixture.setNow(BASE_TIME + 101);
    const first = createConversation(fixture, fixture.principalA, "arabic");
    fixture.setNow(BASE_TIME + 102);
    const second = createConversation(fixture, fixture.principalA, "biology");
    createConversation(fixture, fixture.principalB, "arabic");
    assert.deepEqual(fixture.service.listConversations(fixture.principalA).map((conversation) => conversation.id), [second.id, first.id]);
    assert.deepEqual(fixture.service.listConversations(fixture.principalA, { subjectKey: "biology" }).map((conversation) => conversation.id), [second.id]);
    const page = fixture.service.listConversations(fixture.principalA, { limit: 1 });
    assert.equal(page.length, 1);
    assert.deepEqual(fixture.service.listConversations(fixture.principalA, { cursor: { lastActivityAt: page[0]!.lastActivityAt, conversationId: page[0]!.id } }).map((conversation) => conversation.id), [first.id]);
    expectCode(() => fixture.service.getConversation(fixture.principalB, first.id), "AI_CONVERSATION_NOT_FOUND");
  } finally {
    fixture.close();
  }
});

test("beginTurn is idempotent, fingerprints logical input, and enforces one active response", () => {
  const fixture = createFixture();
  try {
    const conversation = createConversation(fixture);
    const first = fixture.service.beginTurn(fixture.principalA, {
      conversationId: conversation.id,
      idempotencyKey: "turn-1",
      userContent: "السؤال الأول",
    });
    assert.equal(first.replayed, false);
    const replay = fixture.service.beginTurn(fixture.principalA, {
      conversationId: conversation.id,
      idempotencyKey: "turn-1",
      userContent: "السؤال الأول",
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.userMessage.id, first.userMessage.id);
    assert.equal(replay.response.id, first.response.id);
    assert.equal(countRows(fixture, "ai_conversation_messages"), 1);
    assert.equal(countRows(fixture, "ai_conversation_responses"), 1);
    assert.throws(() => fixture.database.client.prepare(`
      insert into ai_conversation_responses
        (id, conversation_id, principal_ref, idempotency_key, request_fingerprint, request_message_id, assistant_message_id, status, next_chunk_sequence, output_bytes, finish_reason, safe_error_code, created_at, started_at, completed_at, updated_at)
      values (?, ?, ?, ?, ?, null, null, 'PENDING', 0, 0, null, null, ?, null, null, ?)
    `).run(uuidv7(), conversation.id, fixture.principalA.principalRef, "direct-db-active", "a".repeat(64), BASE_TIME + 100, BASE_TIME + 100), /UNIQUE constraint failed/i);
    expectCode(() => fixture.service.beginTurn(fixture.principalA, {
      conversationId: conversation.id,
      idempotencyKey: "turn-1",
      userContent: "سؤال مختلف",
    }), "AI_CONVERSATION_IDEMPOTENCY_CONFLICT");
    const otherConversation = createConversation(fixture);
    expectCode(() => fixture.service.beginTurn(fixture.principalA, {
      conversationId: otherConversation.id,
      idempotencyKey: "turn-1",
      userContent: "السؤال الأول",
    }), "AI_CONVERSATION_IDEMPOTENCY_CONFLICT");
    expectCode(() => fixture.service.beginTurn(fixture.principalA, {
      conversationId: conversation.id,
      idempotencyKey: "turn-2",
      userContent: "طلب ثانٍ أثناء الاستجابة",
    }), "AI_CONVERSATION_BUSY");
    assert.equal(countRows(fixture, "ai_conversation_messages"), 1);
    assert.equal(countRows(fixture, "ai_conversation_responses"), 1);
    expectCode(() => fixture.service.beginTurn(fixture.principalB, {
      conversationId: conversation.id,
      idempotencyKey: "turn-client-claim",
      userContent: "لا أملك هذا الحوار",
    } as AIBeginTurnInputWithClientClaim), "AI_CONVERSATION_NOT_FOUND");
  } finally {
    fixture.close();
  }
});

test("Streaming chunks are ordered, replayable only when identical, and completion creates one shared Assistant message", () => {
  const fixture = createFixture();
  try {
    const conversation = createConversation(fixture);
    const turn = fixture.service.beginTurn(fixture.principalA, { conversationId: conversation.id, idempotencyKey: "stream-1", userContent: "سؤال" });
    const started = fixture.service.startResponse(fixture.principalA, turn.response.id);
    assert.equal(started.status, "STREAMING");
    const first = fixture.service.appendResponseChunk(fixture.principalA, turn.response.id, 0, "أ");
    const second = fixture.service.appendResponseChunk(fixture.principalA, turn.response.id, 1, "حياء");
    assert.equal(first.chunk.sequence, 0);
    assert.equal(second.response.outputBytes, Buffer.byteLength("أحياء", "utf8"));
    assert.equal(fixture.service.appendResponseChunk(fixture.principalA, turn.response.id, 1, "حياء").replayed, true);
    expectCode(() => fixture.service.appendResponseChunk(fixture.principalA, turn.response.id, 1, "مختلف"), "AI_CONVERSATION_STREAM_CONFLICT");
    expectCode(() => fixture.service.appendResponseChunk(fixture.principalA, turn.response.id, 3, "متأخر"), "AI_CONVERSATION_STREAM_CONFLICT");
    const completed = fixture.service.completeResponse(fixture.principalA, turn.response.id, "STOP");
    assert.equal(completed.response.status, "COMPLETED");
    assert.equal(completed.assistantMessage?.content, "أحياء");
    assert.equal(completed.assistantMessage?.isPartial, false);
    assert.equal(completed.assistantMessage?.ordinal, 2);
    assert.equal(fixture.service.listResponseChunks(fixture.principalA, turn.response.id).length, 0);
    assert.equal(fixture.service.completeResponse(fixture.principalA, turn.response.id, "STOP").response.id, turn.response.id);
    expectCode(() => fixture.service.appendResponseChunk(fixture.principalA, turn.response.id, 2, "بعد النهاية"), "AI_CONVERSATION_RESPONSE_TERMINAL");
    expectCode(() => fixture.service.startResponse(fixture.principalA, turn.response.id), "AI_CONVERSATION_RESPONSE_TERMINAL");
    const next = fixture.service.beginTurn(fixture.principalA, { conversationId: conversation.id, idempotencyKey: "stream-2", userContent: "متابعة" });
    fixture.service.cancelResponse(fixture.principalA, next.response.id);
    assert.deepEqual(fixture.service.listMessages(fixture.principalA, conversation.id).map((message) => [message.ordinal, message.role, message.isPartial]), [
      [1, "USER", false],
      [2, "ASSISTANT", false],
      [3, "USER", false],
    ]);
  } finally {
    fixture.close();
  }
});

test("Failed and cancelled responses preserve exact partial output once and never fabricate empty Assistant messages", () => {
  const fixture = createFixture();
  try {
    const conversation = createConversation(fixture);
    const failedTurn = fixture.service.beginTurn(fixture.principalA, { conversationId: conversation.id, idempotencyKey: "partial-fail", userContent: "سؤال فشل" });
    fixture.service.startResponse(fixture.principalA, failedTurn.response.id);
    fixture.service.appendResponseChunk(fixture.principalA, failedTurn.response.id, 0, "جزء من الجواب");
    const failed = fixture.service.failResponse(fixture.principalA, failedTurn.response.id, "AI_CONVERSATION_INTERNAL");
    assert.equal(failed.response.status, "FAILED");
    assert.equal(failed.assistantMessage?.content, "جزء من الجواب");
    assert.equal(failed.assistantMessage?.isPartial, true);
    assert.equal(fixture.service.failResponse(fixture.principalA, failedTurn.response.id, "AI_CONVERSATION_INTERNAL").response.status, "FAILED");
    expectCode(() => fixture.service.cancelResponse(fixture.principalA, failedTurn.response.id), "AI_CONVERSATION_RESPONSE_TERMINAL");

    const cancelledTurn = fixture.service.beginTurn(fixture.principalA, { conversationId: conversation.id, idempotencyKey: "partial-cancel", userContent: "سؤال إلغاء" });
    fixture.service.startResponse(fixture.principalA, cancelledTurn.response.id);
    fixture.service.appendResponseChunk(fixture.principalA, cancelledTurn.response.id, 0, "نصف جواب");
    const cancelled = fixture.service.cancelResponse(fixture.principalA, cancelledTurn.response.id);
    assert.equal(cancelled.response.status, "CANCELLED");
    assert.equal(cancelled.assistantMessage?.isPartial, true);

    const empty = fixture.service.beginTurn(fixture.principalA, { conversationId: conversation.id, idempotencyKey: "empty-cancel", userContent: "سؤال بلا جواب" });
    const emptyCancelled = fixture.service.cancelResponse(fixture.principalA, empty.response.id);
    assert.equal(emptyCancelled.assistantMessage, null);
    assert.equal(countRows(fixture, "ai_conversation_response_chunks"), 0);
  } finally {
    fixture.close();
  }
});

test("Principal isolation applies to every Conversation/Response operation and ignores client identity claims", () => {
  const fixture = createFixture();
  try {
    const conversation = createConversation(fixture);
    const turn = fixture.service.beginTurn(fixture.principalA, { conversationId: conversation.id, idempotencyKey: "private-1", userContent: "خاص" });
    const clientClaim = { principalRef: fixture.principalA.principalRef, studentId: fixture.principalA.principalRef };
    expectCode(() => fixture.service.getConversation(fixture.principalB, conversation.id), "AI_CONVERSATION_NOT_FOUND");
    expectCode(() => fixture.service.listMessages(fixture.principalB, conversation.id, clientClaim as never), "AI_CONVERSATION_NOT_FOUND");
    expectCode(() => fixture.service.beginTurn(fixture.principalB, { conversationId: conversation.id, idempotencyKey: "private-b", userContent: "محاولة" } as AIBeginTurnInputWithClientClaim), "AI_CONVERSATION_NOT_FOUND");
    expectCode(() => fixture.service.startResponse(fixture.principalB, turn.response.id), "AI_CONVERSATION_NOT_FOUND");
    expectCode(() => fixture.service.appendResponseChunk(fixture.principalB, turn.response.id, 0, "محاولة"), "AI_CONVERSATION_NOT_FOUND");
    expectCode(() => fixture.service.completeResponse(fixture.principalB, turn.response.id, "STOP"), "AI_CONVERSATION_NOT_FOUND");
    expectCode(() => fixture.service.deleteConversation(fixture.principalB, conversation.id), "AI_CONVERSATION_NOT_FOUND");
    assert.equal(fixture.service.getConversation(fixture.principalA, conversation.id).status, "ACTIVE");
  } finally {
    fixture.close();
  }
});

test("Conversation deletion atomically cancels active response, purges all C4 messages/chunks, and leaves only a tombstone", () => {
  const fixture = createFixture();
  try {
    const conversation = createConversation(fixture);
    const completedTurn = fixture.service.beginTurn(fixture.principalA, { conversationId: conversation.id, idempotencyKey: "delete-completed", userContent: "TOP_SECRET_STUDENT_MESSAGE_42" });
    fixture.service.startResponse(fixture.principalA, completedTurn.response.id);
    fixture.service.appendResponseChunk(fixture.principalA, completedTurn.response.id, 0, "TOP_SECRET_STUDENT_MESSAGE_42");
    fixture.service.completeResponse(fixture.principalA, completedTurn.response.id, "STOP");

    const activeTurn = fixture.service.beginTurn(fixture.principalA, { conversationId: conversation.id, idempotencyKey: "delete-active", userContent: "طلب نشط" });
    fixture.service.startResponse(fixture.principalA, activeTurn.response.id);
    fixture.service.appendResponseChunk(fixture.principalA, activeTurn.response.id, 0, "TOP_SECRET_STUDENT_MESSAGE_42");
    assert.equal(JSON.stringify(fixture.database.db.select().from(aiConversationResponses).all()).includes("TOP_SECRET_STUDENT_MESSAGE_42"), false);
    const deleted = fixture.service.deleteConversation(fixture.principalA, conversation.id);
    assert.equal(deleted.status, "DELETED");
    assert.equal(countRows(fixture, "ai_conversation_messages"), 0);
    assert.equal(countRows(fixture, "ai_conversation_response_chunks"), 0);
    const persistedResponse = fixture.database.db.select().from(aiConversationResponses).all();
    assert.equal(persistedResponse.length, 2);
    assert.equal(persistedResponse.every((response) => response.requestFingerprint === null && response.idempotencyKey === null && response.requestMessageId === null && response.assistantMessageId === null), true);
    assert.equal(persistedResponse.find((response) => response.id === activeTurn.response.id)?.status, "CANCELLED");
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_conversations where status = 'DELETED' and deleted_at is not null").get() as { count: number }).count, 1);
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_conversation_messages where content like '%TOP_SECRET_STUDENT_MESSAGE_42%'").get() as { count: number }).count, 0);
    expectCode(() => fixture.service.getConversation(fixture.principalA, conversation.id), "AI_CONVERSATION_NOT_FOUND");
    expectCode(() => fixture.service.listMessages(fixture.principalA, conversation.id), "AI_CONVERSATION_NOT_FOUND");
    expectCode(() => fixture.service.appendResponseChunk(fixture.principalA, activeTurn.response.id, 1, "بعد الحذف"), "AI_CONVERSATION_NOT_FOUND");
    expectCode(() => fixture.service.completeResponse(fixture.principalA, activeTurn.response.id, "STOP"), "AI_CONVERSATION_NOT_FOUND");
    assert.equal(fixture.service.deleteConversation(fixture.principalA, conversation.id).status, "DELETED");
  } finally {
    fixture.close();
  }
});

test("A deletion committed through one SQLite connection prevents later writes through another", () => {
  const fixture = createFixture();
  let secondDatabase: ContentDatabase | null = null;
  try {
    const conversation = createConversation(fixture);
    const turn = fixture.service.beginTurn(fixture.principalA, { conversationId: conversation.id, idempotencyKey: "connection-delete", userContent: "خاص" });
    fixture.service.startResponse(fixture.principalA, turn.response.id);
    secondDatabase = openContentDatabase({ dataDirectory: fixture.root, migrationsDirectory });
    const secondService = new AIConversationService(secondDatabase, { clock: () => BASE_TIME + 100 });
    secondService.deleteConversation(fixture.principalA, conversation.id);
    expectCode(() => fixture.service.appendResponseChunk(fixture.principalA, turn.response.id, 0, "متأخر"), "AI_CONVERSATION_NOT_FOUND");
  } finally {
    secondDatabase?.close();
    fixture.close();
  }
});

test("Message pagination is bounded and rejects unbounded page sizes", () => {
  const fixture = createFixture();
  try {
    const conversation = createConversation(fixture);
    const turn = fixture.service.beginTurn(fixture.principalA, { conversationId: conversation.id, idempotencyKey: "page-1", userContent: "سؤال" });
    assert.equal(fixture.service.listMessages(fixture.principalA, conversation.id, { limit: AI_CONVERSATION_MAX_MESSAGE_PAGE_SIZE }).length, 1);
    expectCode(() => fixture.service.listMessages(fixture.principalA, conversation.id, { limit: AI_CONVERSATION_MAX_MESSAGE_PAGE_SIZE + 1 }), "AI_CONVERSATION_INVALID");
    expectCode(() => fixture.service.listResponseChunks(fixture.principalB, turn.response.id), "AI_CONVERSATION_NOT_FOUND");
  } finally {
    fixture.close();
  }
});

type AIBeginTurnInputWithClientClaim = {
  conversationId: string;
  idempotencyKey: string;
  userContent: string;
  principalRef?: string;
  studentId?: string;
};
