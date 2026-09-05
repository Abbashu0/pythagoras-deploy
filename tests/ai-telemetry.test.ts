import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";

import { AIConversationService, type AIStudentPrincipal } from "../src/server/ai/conversations";
import {
  AIDeidentifiedAnalyticsReadService,
  AITelemetryError,
  AIIntelligenceTelemetryService,
} from "../src/server/ai/telemetry";
import { createCanonicalContentRepository } from "../src/server/canonical-content/service";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const BASE_TIME = 1_930_000_000_000;
const PRINCIPAL_A: AIStudentPrincipal = { principalRef: "telemetry-student-a", status: "ACTIVE" };
const PRINCIPAL_B: AIStudentPrincipal = { principalRef: "telemetry-student-b", status: "ACTIVE" };
const QUERY_MARKER = "TOP_SECRET_TELEMETRY_QUERY_11";
const ANSWER_MARKER = "PRIVATE_TELEMETRY_ANSWER_11";

interface Fixture {
  database: ContentDatabase;
  root: string;
  conversations: AIConversationService;
  telemetry: AIIntelligenceTelemetryService;
  analytics: AIDeidentifiedAnalyticsReadService;
  close(): void;
}

function createFixture(): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-telemetry-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  createCanonicalContentRepository(database).bootstrap();
  const conversations = new AIConversationService(database, { clock: () => BASE_TIME + 1 });
  const telemetry = new AIIntelligenceTelemetryService(database, { clock: () => BASE_TIME + 1 });
  return { database, root, conversations, telemetry, analytics: new AIDeidentifiedAnalyticsReadService(database), close() { database.close(); try { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch {} } };
}

function completeTurn(fixture: Fixture, principal: AIStudentPrincipal, content: string) {
  const conversation = fixture.conversations.createConversation(principal, "biology");
  const turn = fixture.conversations.beginTurn(principal, { conversationId: conversation.id, idempotencyKey: `telemetry-turn-${uuidv7()}`, userContent: content });
  fixture.conversations.startResponse(principal, turn.response.id);
  fixture.conversations.appendResponseChunk(principal, turn.response.id, 0, ANSWER_MARKER);
  const completed = fixture.conversations.completeResponse(principal, turn.response.id, "STOP");
  return { conversation, response: completed.response };
}

test("M11 telemetry correlates Tutor outcomes without copying private text", () => {
  const fixture = createFixture();
  try {
    const turnA = completeTurn(fixture, PRINCIPAL_A, QUERY_MARKER);
    const started = fixture.telemetry.recordTutorStarted({ principalRef: PRINCIPAL_A.principalRef, responseId: turnA.response.id, occurredAt: BASE_TIME + 10 });
    assert.ok(started);
    assert.equal(fixture.telemetry.recordTutorStarted({ principalRef: PRINCIPAL_A.principalRef, responseId: turnA.response.id, occurredAt: BASE_TIME + 11 })?.id, started.id);
    const outcome = fixture.telemetry.recordTutorOutcome({ principalRef: PRINCIPAL_A.principalRef, responseId: turnA.response.id, status: "COMPLETED", startedAt: BASE_TIME + 10, occurredAt: BASE_TIME + 25 });
    assert.ok(outcome);
    const eventTypes = (fixture.database.client.prepare("select event_type from ai_telemetry_events where response_id=?").all(turnA.response.id) as Array<{ event_type: string }>).map((row) => row.event_type).sort();
    assert.deepEqual(eventTypes, ["GROUNDING_VALIDATION_PASSED", "TUTOR_REQUEST_COMPLETED", "TUTOR_REQUEST_STARTED"]);
    const telemetryRows = JSON.stringify(fixture.database.client.prepare("select * from ai_telemetry_events").all());
    assert.equal(telemetryRows.includes(QUERY_MARKER), false);
    assert.equal(telemetryRows.includes(ANSWER_MARKER), false);
    assert.throws(() => fixture.database.client.prepare("update ai_telemetry_events set event_type='TUTOR_REQUEST_FAILED' where id=?").run(started.id), /append-only|immutable/i);
    assert.throws(() => fixture.database.client.prepare("delete from ai_telemetry_events where id=?").run(started.id), /purge|controlled|append-only/i);
    assert.throws(() => fixture.database.client.prepare("insert into ai_telemetry_events (id,dedupe_key,event_type,event_version,privacy_class,occurred_at,utc_day,utc_week,utc_month) values (?,?,?,?,?,?,?,?,?)").run(uuidv7(), `bad-${uuidv7()}`, "UNKNOWN_EVENT", 1, "DEIDENTIFIED_METADATA", BASE_TIME, "2031-02-01", "2031-W05", "2031-02"), /event|type|constraint/i);
  } finally { fixture.close(); }
});

test("M11 Feedback is completed-Response-bound, idempotent, and privacy-safe", () => {
  const fixture = createFixture();
  try {
    const turnA = completeTurn(fixture, PRINCIPAL_A, QUERY_MARKER);
    const feedbackInput = { dedupeKey: `feedback-${uuidv7()}`, principalRef: PRINCIPAL_A.principalRef, responseId: turnA.response.id, feedbackType: "POSITIVE" as const, reasonCode: "HELPFUL" as const, occurredAt: BASE_TIME + 30 };
    const first = fixture.telemetry.recordFeedback(feedbackInput);
    const replay = fixture.telemetry.recordFeedback(feedbackInput);
    assert.equal(replay.id, first.id);
    assert.equal(Number((fixture.database.client.prepare("select count(*) as count from ai_feedback_events where response_id=?").get(turnA.response.id) as { count: number }).count), 1);
    assert.equal(Number((fixture.database.client.prepare("select count(*) as count from ai_telemetry_events where event_type='FEEDBACK_POSITIVE'").get() as { count: number }).count), 1);
    assert.throws(() => fixture.telemetry.recordFeedback({ ...feedbackInput, dedupeKey: `wrong-owner-${uuidv7()}`, principalRef: PRINCIPAL_B.principalRef }), (error) => error instanceof AITelemetryError && error.code === "AI_TELEMETRY_FEEDBACK_INVALID");
    assert.throws(() => fixture.database.client.prepare("update ai_feedback_events set feedback_type='NEGATIVE' where id=?").run(first.id), /append-only|immutable/i);
    assert.throws(() => fixture.database.client.prepare("delete from ai_feedback_events where id=?").run(first.id), /purge|controlled|append-only/i);
  } finally { fixture.close(); }
});

test("M11 de-identified analytics exposes bounded aggregates, UTC buckets, and purge isolation", () => {
  const fixture = createFixture();
  try {
    const turnA = completeTurn(fixture, PRINCIPAL_A, QUERY_MARKER);
    const turnB = completeTurn(fixture, PRINCIPAL_B, "other principal query");
    fixture.telemetry.recordTutorStarted({ principalRef: PRINCIPAL_A.principalRef, responseId: turnA.response.id, occurredAt: BASE_TIME + 40 });
    fixture.telemetry.recordTutorOutcome({ principalRef: PRINCIPAL_A.principalRef, responseId: turnA.response.id, status: "COMPLETED", startedAt: BASE_TIME + 40, occurredAt: BASE_TIME + 50 });
    fixture.telemetry.recordTutorStarted({ principalRef: PRINCIPAL_B.principalRef, responseId: turnB.response.id, occurredAt: BASE_TIME + 60 });
    fixture.telemetry.recordTutorOutcome({ principalRef: PRINCIPAL_B.principalRef, responseId: turnB.response.id, status: "FAILED", startedAt: BASE_TIME + 60, occurredAt: BASE_TIME + 70, failureCode: "PROVIDER_ERROR" });
    fixture.telemetry.recordEvent({ dedupeKey: `eval-null-${uuidv7()}`, eventType: "TUTOR_REQUEST_STARTED", principalRef: null, subjectKey: "biology", occurredAt: BASE_TIME + 80 });
    fixture.telemetry.recordFeedback({ dedupeKey: `positive-a-${uuidv7()}`, principalRef: PRINCIPAL_A.principalRef, responseId: turnA.response.id, feedbackType: "POSITIVE", reasonCode: "HELPFUL", occurredAt: BASE_TIME + 81 });
    fixture.telemetry.recordFeedback({ dedupeKey: `negative-b-${uuidv7()}`, principalRef: PRINCIPAL_B.principalRef, responseId: turnB.response.id, feedbackType: "NEGATIVE", reasonCode: "INCORRECT", occurredAt: BASE_TIME + 82 });
    const overview = fixture.analytics.overview({ from: BASE_TIME, to: BASE_TIME + 100 });
    assert.deepEqual(overview.tutorRequests, { started: 2, completed: 1, failed: 1, successRateUnits: 500_000 });
    assert.deepEqual(overview.activeUsers, { dau: 2, wau: 2, mau: 2, requestsPerActiveUser: 1 });
    assert.deepEqual(overview.feedback, { positive: 1, negative: 1, reports: 0 });
    assert.deepEqual(fixture.analytics.timeSeries({ from: BASE_TIME, to: BASE_TIME + 100 }), [{ bucket: "2031-02-27", tutorStarted: 2, tutorCompleted: 1, tutorFailed: 1, retrievalInsufficient: 0, groundingFailed: 0, memoryApplied: 0, compactionCompleted: 0, positiveFeedback: 1, negativeFeedback: 1, reports: 0 }]);
    assert.equal(fixture.analytics.subjectBreakdown({ from: BASE_TIME, to: BASE_TIME + 100 })[0]?.dimension, "biology");
    assert.deepEqual(fixture.analytics.failureBreakdown({ from: BASE_TIME, to: BASE_TIME + 100 }), [{ failureCode: "PROVIDER_ERROR", count: 1 }]);
    const aId = (fixture.database.client.prepare("select id from ai_analytics_principals where principal_ref=?").get(PRINCIPAL_A.principalRef) as { id: string }).id;
    const bId = (fixture.database.client.prepare("select id from ai_analytics_principals where principal_ref=?").get(PRINCIPAL_B.principalRef) as { id: string }).id;
    assert.ok(aId);
    assert.ok(bId);
    assert.equal(fixture.telemetry.purgePrincipal(PRINCIPAL_A), 5);
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_telemetry_events where analytics_principal_id=?").get(aId) as { count: number }).count, 0);
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_feedback_events where analytics_principal_id=?").get(aId) as { count: number }).count, 0);
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_analytics_principals where id=?").get(aId) as { count: number }).count, 0);
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_analytics_principals where id=?").get(bId) as { count: number }).count, 1);
    assert.equal(fixture.analytics.overview({ from: BASE_TIME, to: BASE_TIME + 100 }).tutorRequests.started, 1);
  } finally { fixture.close(); }
});

test("M11 migration upgrades a populated 0044 database without losing existing M10/M4 data", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-telemetry-upgrade-"));
  const oldMigrations = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-telemetry-migrations-"));
  let oldDatabase: ContentDatabase | null = null;
  let upgraded: ContentDatabase | null = null;
  try {
    mkdirSync(path.join(oldMigrations, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(path.join(migrationsDirectory, "meta", "_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }> };
    const entries = journal.entries.slice(0, 45);
    for (const entry of entries) {
      copyFileSync(path.join(migrationsDirectory, `${entry.tag}.sql`), path.join(oldMigrations, `${entry.tag}.sql`));
      const snapshot = `${entry.idx.toString().padStart(4, "0")}_snapshot.json`;
      if (existsSync(path.join(migrationsDirectory, "meta", snapshot))) copyFileSync(path.join(migrationsDirectory, "meta", snapshot), path.join(oldMigrations, "meta", snapshot));
    }
    writeFileSync(path.join(oldMigrations, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
    oldDatabase = openContentDatabase({ dataDirectory: root, migrationsDirectory: oldMigrations });
    assert.equal((oldDatabase.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count, 45);
    createCanonicalContentRepository(oldDatabase).bootstrap();
    const conversation = new AIConversationService(oldDatabase, { clock: () => BASE_TIME + 1 }).createConversation(PRINCIPAL_A, "biology");
    oldDatabase.close();
    oldDatabase = null;
    upgraded = openContentDatabase({ dataDirectory: root, migrationsDirectory });
    assert.equal((upgraded.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count, 46);
    assert.ok(upgraded.client.prepare("select id from ai_conversations where id=?").get(conversation.id));
    for (const trigger of ["ai_telemetry_events_no_update", "ai_feedback_events_owner_valid", "ai_analytics_principals_lifecycle_valid"]) assert.ok(upgraded.client.prepare("select name from sqlite_master where type='trigger' and name=?").get(trigger));
  } finally {
    oldDatabase?.close();
    upgraded?.close();
    try { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch {}
    try { rmSync(oldMigrations, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch {}
  }
});
