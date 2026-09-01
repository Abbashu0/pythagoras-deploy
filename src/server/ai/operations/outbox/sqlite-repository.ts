import { asc, desc, and, eq, lte, or } from "drizzle-orm";

import type { ContentDatabase } from "../../../content/database";
import {
  aiOutboxEvents,
  type AIOutboxEventRow,
} from "../../../content/schema";
import type {
  AIOutboxEvent,
  AIOutboxOperationalSummary,
  AIOutboxOperationalView,
  AIOutboxRoute,
} from "./contracts";
import { AIOutboxError } from "./errors";
import type { NormalizedAIOutboxEventSpec } from "./validation";

export class SQLiteAIOutboxRepository {
  constructor(private readonly database: ContentDatabase) {}

  getById(id: string): AIOutboxEvent | null {
    const row = this.database.db.select().from(aiOutboxEvents).where(eq(aiOutboxEvents.id, id)).get();
    return row ? eventFromRow(row) : null;
  }

  findByDedupe(eventType: string, dedupeKey: string): AIOutboxEvent | null {
    const row = this.database.db.select().from(aiOutboxEvents).where(and(
      eq(aiOutboxEvents.eventType, eventType),
      eq(aiOutboxEvents.dedupeKey, dedupeKey),
    )).get();
    return row ? eventFromRow(row) : null;
  }

  insertInTransaction(input: {
    id: string;
    spec: NormalizedAIOutboxEventSpec;
    now: number;
  }): AIOutboxEvent {
    try {
      const row = this.database.db.insert(aiOutboxEvents).values({
        id: input.id,
        eventType: input.spec.eventType,
        payloadVersion: input.spec.payloadVersion,
        payloadJson: input.spec.payloadJson,
        payloadHash: input.spec.payloadHash,
        dedupeKey: input.spec.dedupeKey,
        status: "PENDING",
        scheduledAt: input.spec.scheduledAt,
        dispatchedJobId: null,
        safeErrorCode: null,
        createdAt: input.now,
        dispatchedAt: null,
      }).returning().get();
      return eventFromRow(row);
    } catch (error) {
      throw new AIOutboxError("AI_OUTBOX_INVALID", "The Outbox event could not be persisted.", error);
    }
  }

  listDispatchableInTransaction(input: {
    now: number;
    supportedRoutes: readonly AIOutboxRoute[];
  }): AIOutboxEvent[] {
    if (!input.supportedRoutes.length) return [];
    const supportedPairs = input.supportedRoutes.map((supported) => and(
      eq(aiOutboxEvents.eventType, supported.eventType),
      eq(aiOutboxEvents.payloadVersion, supported.payloadVersion),
    ));
    const exactSupport = supportedPairs.length === 1 ? supportedPairs[0] : or(...supportedPairs);
    return this.database.db.select().from(aiOutboxEvents).where(and(
      eq(aiOutboxEvents.status, "PENDING"),
      lte(aiOutboxEvents.scheduledAt, input.now),
      exactSupport,
    )).orderBy(asc(aiOutboxEvents.scheduledAt), asc(aiOutboxEvents.createdAt), asc(aiOutboxEvents.id)).limit(1).all().map(eventFromRow);
  }

  markDispatchedInTransaction(input: { id: string; jobId: string; now: number }): AIOutboxEvent {
    const row = this.database.db.update(aiOutboxEvents).set({
      status: "DISPATCHED",
      dispatchedJobId: input.jobId,
      dispatchedAt: input.now,
    }).where(and(eq(aiOutboxEvents.id, input.id), eq(aiOutboxEvents.status, "PENDING"))).returning().get();
    if (!row) throw new AIOutboxError("AI_OUTBOX_DISPATCH_FAILED", "The Outbox event changed before dispatch.");
    return eventFromRow(row);
  }

  markFailedInTransaction(input: { id: string; safeErrorCode: string }): AIOutboxEvent {
    const row = this.database.db.update(aiOutboxEvents).set({
      status: "FAILED",
      safeErrorCode: input.safeErrorCode,
    }).where(and(
      eq(aiOutboxEvents.id, input.id),
      or(eq(aiOutboxEvents.status, "PENDING"), eq(aiOutboxEvents.status, "FAILED")),
    )).returning().get();
    if (!row) throw new AIOutboxError("AI_OUTBOX_DISPATCH_FAILED", "The Outbox event changed before failure recording.");
    return eventFromRow(row);
  }

  listOperationalSummaries(): AIOutboxOperationalSummary[] {
    const rows = this.database.client.prepare("select status, count(*) as count from ai_outbox_events group by status order by status").all() as Array<{ status: AIOutboxEvent["status"]; count: number }>;
    return rows.map((row) => ({ status: row.status, count: row.count }));
  }

  countPending(): number {
    return this.database.db.select({ id: aiOutboxEvents.id }).from(aiOutboxEvents).where(eq(aiOutboxEvents.status, "PENDING")).all().length;
  }

  listFailed(limit: number): AIOutboxOperationalView[] {
    return this.database.db.select().from(aiOutboxEvents).where(eq(aiOutboxEvents.status, "FAILED"))
      .orderBy(desc(aiOutboxEvents.createdAt), desc(aiOutboxEvents.id)).limit(limit).all().map((row) => operationalViewFromEvent(eventFromRow(row)));
  }

  listRecent(limit: number): AIOutboxOperationalView[] {
    return this.database.db.select().from(aiOutboxEvents).orderBy(desc(aiOutboxEvents.createdAt), desc(aiOutboxEvents.id)).limit(limit).all().map((row) => operationalViewFromEvent(eventFromRow(row)));
  }
}

function eventFromRow(row: AIOutboxEventRow): AIOutboxEvent {
  return {
    id: row.id,
    eventType: row.eventType,
    payloadVersion: row.payloadVersion,
    payloadJson: row.payloadJson,
    payloadHash: row.payloadHash,
    dedupeKey: row.dedupeKey,
    status: row.status,
    scheduledAt: row.scheduledAt,
    dispatchedJobId: row.dispatchedJobId,
    safeErrorCode: row.safeErrorCode,
    createdAt: row.createdAt,
    dispatchedAt: row.dispatchedAt,
  };
}

function operationalViewFromEvent(event: AIOutboxEvent): AIOutboxOperationalView {
  return {
    id: event.id,
    eventType: event.eventType,
    payloadVersion: event.payloadVersion,
    payloadHash: event.payloadHash,
    dedupeKey: event.dedupeKey,
    status: event.status,
    scheduledAt: event.scheduledAt,
    dispatchedJobId: event.dispatchedJobId,
    safeErrorCode: event.safeErrorCode,
    createdAt: event.createdAt,
    dispatchedAt: event.dispatchedAt,
  };
}
