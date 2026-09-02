import { and, asc, desc, eq, gt, inArray, lt, max, or, sql } from "drizzle-orm";

import type { ContentDatabase } from "../../content/database";
import {
  aiConversationMessages,
  aiConversationResponseChunks,
  aiConversationResponses,
  aiConversations,
  type AIConversationMessageRow,
  type AIConversationResponseChunkRow,
  type AIConversationResponseRow,
  type AIConversationRow,
} from "../../content/schema";
import type {
  AIConversation,
  AIConversationFinishReason,
  AIConversationListCursor,
  AIConversationMessage,
  AIConversationMessageRole,
  AIConversationResponse,
  AIConversationResponseChunk,
  AIConversationResponseStatus,
  AIConversationSafeErrorCode,
  AIConversationStatus,
} from "./contracts";
import { AIConversationError } from "./errors";

export class SQLiteAIConversationRepository {
  constructor(private readonly database: ContentDatabase) {}

  getConversation(principalRef: string, conversationId: string, includeDeleted = false): AIConversation | null {
    const row = this.database.db.select().from(aiConversations).where(and(
      eq(aiConversations.id, conversationId),
      eq(aiConversations.principalRef, principalRef),
      includeDeleted ? undefined : eq(aiConversations.status, "ACTIVE"),
    )).get();
    return row ? conversationFromRow(row) : null;
  }

  listActiveConversations(input: {
    principalRef: string;
    subjectKey?: string;
    cursor?: AIConversationListCursor;
    limit: number;
  }): AIConversation[] {
    const cursor = input.cursor;
    const rows = this.database.db.select().from(aiConversations).where(and(
      eq(aiConversations.principalRef, input.principalRef),
      eq(aiConversations.status, "ACTIVE"),
      input.subjectKey ? eq(aiConversations.subjectKey, input.subjectKey) : undefined,
      cursor ? or(
        lt(aiConversations.lastActivityAt, cursor.lastActivityAt),
        and(eq(aiConversations.lastActivityAt, cursor.lastActivityAt), lt(aiConversations.id, cursor.conversationId)),
      ) : undefined,
    )).orderBy(desc(aiConversations.lastActivityAt), desc(aiConversations.id)).limit(input.limit).all();
    return rows.map(conversationFromRow);
  }

  listMessages(input: {
    principalRef: string;
    conversationId: string;
    afterOrdinal: number;
    limit: number;
  }): AIConversationMessage[] {
    const rows = this.database.db.select({ message: aiConversationMessages }).from(aiConversationMessages)
      .innerJoin(aiConversations, eq(aiConversationMessages.conversationId, aiConversations.id))
      .where(and(
        eq(aiConversationMessages.conversationId, input.conversationId),
        eq(aiConversations.principalRef, input.principalRef),
        eq(aiConversations.status, "ACTIVE"),
        gt(aiConversationMessages.ordinal, input.afterOrdinal),
      )).orderBy(asc(aiConversationMessages.ordinal)).limit(input.limit).all();
    return rows.map((row) => messageFromRow(row.message));
  }

  getMessage(id: string): AIConversationMessage | null {
    const row = this.database.db.select().from(aiConversationMessages).where(eq(aiConversationMessages.id, id)).get();
    return row ? messageFromRow(row) : null;
  }

  getResponse(principalRef: string, responseId: string, includeDeleted = false): AIConversationResponse | null {
    const row = this.database.db.select({ response: aiConversationResponses }).from(aiConversationResponses)
      .innerJoin(aiConversations, eq(aiConversationResponses.conversationId, aiConversations.id))
      .where(and(
        eq(aiConversationResponses.id, responseId),
        eq(aiConversationResponses.principalRef, principalRef),
        includeDeleted ? undefined : eq(aiConversations.status, "ACTIVE"),
      )).get();
    return row ? responseFromRow(row.response) : null;
  }

  getResponseByIdempotency(principalRef: string, idempotencyKey: string): AIConversationResponse | null {
    return this.findResponseByIdempotency(principalRef, idempotencyKey, false);
  }

  getResponseByIdempotencyIncludingDeleted(principalRef: string, idempotencyKey: string): AIConversationResponse | null {
    return this.findResponseByIdempotency(principalRef, idempotencyKey, true);
  }

  private findResponseByIdempotency(principalRef: string, idempotencyKey: string, includeDeleted: boolean): AIConversationResponse | null {
    const row = this.database.db.select({ response: aiConversationResponses }).from(aiConversationResponses)
      .innerJoin(aiConversations, eq(aiConversationResponses.conversationId, aiConversations.id))
      .where(and(
        eq(aiConversationResponses.principalRef, principalRef),
        eq(aiConversationResponses.idempotencyKey, idempotencyKey),
        includeDeleted ? undefined : eq(aiConversations.status, "ACTIVE"),
      )).get();
    return row ? responseFromRow(row.response) : null;
  }

  listResponsesForConversation(conversationId: string, principalRef: string): AIConversationResponse[] {
    return this.database.db.select({ response: aiConversationResponses }).from(aiConversationResponses)
      .innerJoin(aiConversations, eq(aiConversationResponses.conversationId, aiConversations.id))
      .where(and(
        eq(aiConversationResponses.conversationId, conversationId),
        eq(aiConversationResponses.principalRef, principalRef),
      )).orderBy(asc(aiConversationResponses.createdAt), asc(aiConversationResponses.id)).all()
      .map((row) => responseFromRow(row.response));
  }

  getChunk(responseId: string, sequence: number): AIConversationResponseChunk | null {
    const row = this.database.db.select().from(aiConversationResponseChunks).where(and(
      eq(aiConversationResponseChunks.responseId, responseId),
      eq(aiConversationResponseChunks.sequence, sequence),
    )).get();
    return row ? chunkFromRow(row) : null;
  }

  listChunks(responseId: string): AIConversationResponseChunk[] {
    return this.database.db.select().from(aiConversationResponseChunks)
      .where(eq(aiConversationResponseChunks.responseId, responseId))
      .orderBy(asc(aiConversationResponseChunks.sequence)).all().map(chunkFromRow);
  }

  nextMessageOrdinal(conversationId: string): number {
    const row = this.database.db.select({ value: max(aiConversationMessages.ordinal) })
      .from(aiConversationMessages).where(eq(aiConversationMessages.conversationId, conversationId)).get();
    const current = row?.value === null || row?.value === undefined ? 0 : Number(row.value);
    if (!Number.isSafeInteger(current) || current < 0 || current >= 100_000_000) throw new AIConversationError("AI_CONVERSATION_INVALID", "Conversation message order is invalid.");
    return current + 1;
  }

  insertConversation(input: {
    id: string;
    principalRef: string;
    subjectKey: string;
    createdAt: number;
  }): AIConversation {
    try {
      const row = this.database.db.insert(aiConversations).values({
        id: input.id,
        principalRef: input.principalRef,
        subjectKey: input.subjectKey,
        status: "ACTIVE",
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        lastActivityAt: input.createdAt,
        deletedAt: null,
        revision: 1,
      }).returning().get();
      return conversationFromRow(row);
    } catch (error) {
      throw new AIConversationError("AI_CONVERSATION_INVALID", "The Conversation could not be created.", {}, error);
    }
  }

  insertMessage(input: {
    id: string;
    conversationId: string;
    ordinal: number;
    role: AIConversationMessageRole;
    content: string;
    isPartial: boolean;
    createdAt: number;
  }): AIConversationMessage {
    try {
      const row = this.database.db.insert(aiConversationMessages).values(input).returning().get();
      return messageFromRow(row);
    } catch (error) {
      throw new AIConversationError("AI_CONVERSATION_STREAM_CONFLICT", "The Conversation message order is already in use.", {}, error);
    }
  }

  insertResponse(input: {
    id: string;
    conversationId: string;
    principalRef: string;
    idempotencyKey: string;
    requestFingerprint: string;
    requestMessageId: string;
    createdAt: number;
  }): AIConversationResponse {
    try {
      const row = this.database.db.insert(aiConversationResponses).values({
        id: input.id,
        conversationId: input.conversationId,
        principalRef: input.principalRef,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: input.requestFingerprint,
        requestMessageId: input.requestMessageId,
        assistantMessageId: null,
        status: "PENDING",
        nextChunkSequence: 0,
        outputBytes: 0,
        finishReason: null,
        safeErrorCode: null,
        createdAt: input.createdAt,
        startedAt: null,
        completedAt: null,
        updatedAt: input.createdAt,
      }).returning().get();
      return responseFromRow(row);
    } catch (error) {
      throw new AIConversationError("AI_CONVERSATION_BUSY", "The Conversation already has an active response.", {}, error);
    }
  }

  insertChunk(input: {
    responseId: string;
    sequence: number;
    text: string;
    textHash: string;
    byteLength: number;
    createdAt: number;
  }): AIConversationResponseChunk {
    try {
      const row = this.database.db.insert(aiConversationResponseChunks).values(input).returning().get();
      return chunkFromRow(row);
    } catch (error) {
      throw new AIConversationError("AI_CONVERSATION_STREAM_CONFLICT", "The response chunk sequence is already in use.", {}, error);
    }
  }

  updateConversationActivity(conversationId: string, principalRef: string, at: number, status: AIConversationStatus = "ACTIVE"): AIConversation {
    const row = this.database.db.update(aiConversations).set({
      updatedAt: at,
      lastActivityAt: at,
      revision: sql`${aiConversations.revision} + 1`,
    }).where(and(
      eq(aiConversations.id, conversationId),
      eq(aiConversations.principalRef, principalRef),
      eq(aiConversations.status, status),
    )).returning().get();
    if (!row) throw new AIConversationError("AI_CONVERSATION_NOT_FOUND", "The Conversation was not found.");
    return conversationFromRow(row);
  }

  touchConversation(conversationId: string, principalRef: string, at: number): AIConversation {
    const row = this.database.db.update(aiConversations).set({
      updatedAt: at,
      lastActivityAt: at,
      revision: sql`${aiConversations.revision} + 1`,
    }).where(and(
      eq(aiConversations.id, conversationId),
      eq(aiConversations.principalRef, principalRef),
      eq(aiConversations.status, "ACTIVE"),
    )).returning().get();
    if (!row) throw new AIConversationError("AI_CONVERSATION_NOT_FOUND", "The Conversation was not found.");
    return conversationFromRow(row);
  }

  updateResponse(input: {
    responseId: string;
    conversationId: string;
    principalRef: string;
    expectedStatuses: readonly AIConversationResponseStatus[];
    expectedNextChunkSequence?: number;
    patch: Partial<{
      status: AIConversationResponseStatus;
      nextChunkSequence: number;
      outputBytes: number;
      finishReason: AIConversationFinishReason | null;
      safeErrorCode: AIConversationSafeErrorCode | null;
      requestFingerprint: string | null;
      idempotencyKey: string | null;
      requestMessageId: string | null;
      assistantMessageId: string | null;
      startedAt: number | null;
      completedAt: number | null;
      updatedAt: number;
    }>;
  }): AIConversationResponse | null {
    const row = this.database.db.update(aiConversationResponses).set(input.patch).where(and(
      eq(aiConversationResponses.id, input.responseId),
      eq(aiConversationResponses.conversationId, input.conversationId),
      eq(aiConversationResponses.principalRef, input.principalRef),
      inArray(aiConversationResponses.status, [...input.expectedStatuses]),
      input.expectedNextChunkSequence === undefined ? undefined : eq(aiConversationResponses.nextChunkSequence, input.expectedNextChunkSequence),
    )).returning().get();
    return row ? responseFromRow(row) : null;
  }

  deleteChunks(responseId: string): void {
    this.database.db.delete(aiConversationResponseChunks).where(eq(aiConversationResponseChunks.responseId, responseId)).run();
  }

  deleteMessages(conversationId: string): void {
    this.database.db.delete(aiConversationMessages).where(eq(aiConversationMessages.conversationId, conversationId)).run();
  }

  deleteConversationTombstone(input: {
    conversationId: string;
    principalRef: string;
    at: number;
  }): AIConversation | null {
    const row = this.database.db.update(aiConversations).set({
      status: "DELETED",
      deletedAt: input.at,
      updatedAt: input.at,
      lastActivityAt: input.at,
      revision: sql`${aiConversations.revision} + 1`,
    }).where(and(
      eq(aiConversations.id, input.conversationId),
      eq(aiConversations.principalRef, input.principalRef),
      eq(aiConversations.status, "ACTIVE"),
    )).returning().get();
    return row ? conversationFromRow(row) : null;
  }
}

function conversationFromRow(row: AIConversationRow): AIConversation {
  return {
    id: row.id,
    principalRef: row.principalRef,
    subjectKey: row.subjectKey,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastActivityAt: row.lastActivityAt,
    deletedAt: row.deletedAt,
    revision: row.revision,
  };
}

function messageFromRow(row: AIConversationMessageRow): AIConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    ordinal: row.ordinal,
    role: row.role,
    content: row.content,
    isPartial: row.isPartial,
    createdAt: row.createdAt,
  };
}

function responseFromRow(row: AIConversationResponseRow): AIConversationResponse {
  return {
    id: row.id,
    conversationId: row.conversationId,
    principalRef: row.principalRef,
    idempotencyKey: row.idempotencyKey,
    requestFingerprint: row.requestFingerprint,
    requestMessageId: row.requestMessageId,
    assistantMessageId: row.assistantMessageId,
    status: row.status,
    nextChunkSequence: row.nextChunkSequence,
    outputBytes: row.outputBytes,
    finishReason: row.finishReason,
    safeErrorCode: row.safeErrorCode,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    updatedAt: row.updatedAt,
  };
}

function chunkFromRow(row: AIConversationResponseChunkRow): AIConversationResponseChunk {
  return {
    responseId: row.responseId,
    sequence: row.sequence,
    text: row.text,
    textHash: row.textHash,
    byteLength: row.byteLength,
    createdAt: row.createdAt,
  };
}
