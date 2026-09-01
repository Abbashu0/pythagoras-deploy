import { and, asc, eq, gt, lte } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import type { ContentDatabase } from "../../content/database";
import { aiRateLimitEvents, type AIRateLimitEventRow } from "../../content/schema";
import type { AIRateLimitEvent, AIRateLimitEventOutcome } from "./contracts";
import { AIAdmissionError } from "../admission/errors";

export class SQLiteAIRateLimitRuntimeRepository {
  constructor(private readonly database: ContentDatabase) {}

  getEventByIdempotency(principalRef: string, idempotencyKey: string): AIRateLimitEvent | null {
    const row = this.database.db.select().from(aiRateLimitEvents).where(and(
      eq(aiRateLimitEvents.principalRef, principalRef),
      eq(aiRateLimitEvents.idempotencyKey, idempotencyKey),
    )).get();
    return row ? eventFromRow(row) : null;
  }

  listActiveEvents(input: {
    principalRef: string;
    rateLimitPolicyId: string;
    rateLimitPolicyRevision: number;
    now: number;
    windowMs: number;
  }): AIRateLimitEvent[] {
    const lowerBoundary = input.now - input.windowMs;
    return this.database.db.select().from(aiRateLimitEvents).where(and(
      eq(aiRateLimitEvents.principalRef, input.principalRef),
      eq(aiRateLimitEvents.rateLimitPolicyId, input.rateLimitPolicyId),
      gt(aiRateLimitEvents.occurredAt, lowerBoundary),
      lte(aiRateLimitEvents.occurredAt, input.now),
    )).orderBy(asc(aiRateLimitEvents.occurredAt), asc(aiRateLimitEvents.id)).all().map(eventFromRow);
  }

  createEvent(input: {
    id?: string;
    principalRef: string;
    rateLimitPolicyId: string;
    rateLimitPolicyRevision: number;
    idempotencyKey: string;
    requestFingerprint: string;
    operationId: string;
    reservationId: string | null;
    outcome: AIRateLimitEventOutcome;
    occurredAt: number;
  }): AIRateLimitEvent {
    try {
      const row = this.database.db.insert(aiRateLimitEvents).values({ id: input.id ?? uuidv7(), ...input }).returning().get();
      return eventFromRow(row);
    } catch (error) {
      throw new AIAdmissionError("AI_ADMISSION_INVALID", "The admission rate-limit event could not be recorded.", {}, error);
    }
  }
}

function eventFromRow(row: AIRateLimitEventRow): AIRateLimitEvent {
  return {
    id: row.id,
    principalRef: row.principalRef,
    rateLimitPolicyId: row.rateLimitPolicyId,
    rateLimitPolicyRevision: row.rateLimitPolicyRevision,
    idempotencyKey: row.idempotencyKey,
    requestFingerprint: row.requestFingerprint,
    operationId: row.operationId,
    reservationId: row.reservationId,
    outcome: row.outcome,
    occurredAt: row.occurredAt,
  };
}
