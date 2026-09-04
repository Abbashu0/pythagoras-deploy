import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";

import type { ContentDatabase } from "../../content/database";
import {
  aiConversationSummaryRevisions,
  aiConversations,
  type AIConversationSummaryRevisionRow,
} from "../../content/schema";
import type { AIConversationSummary, AIConversationSummaryRepository } from "./summary-contracts";
import { AI_MEMORY_PURGE_BATCH_SIZE, AIMemoryError } from "./contracts";

export class SQLiteAIConversationSummaryRepository implements AIConversationSummaryRepository {
  constructor(private readonly database: ContentDatabase) {}

  getCurrentForConversation(input: { principalRef: string; conversationId: string; subjectKey: string }): AIConversationSummary | null {
    const row = this.database.db.select({ summary: aiConversationSummaryRevisions }).from(aiConversationSummaryRevisions)
      .innerJoin(aiConversations, eq(aiConversationSummaryRevisions.conversationId, aiConversations.id))
      .where(and(
        eq(aiConversationSummaryRevisions.conversationId, input.conversationId),
        eq(aiConversationSummaryRevisions.principalRef, input.principalRef),
        eq(aiConversationSummaryRevisions.subjectKey, input.subjectKey),
        eq(aiConversationSummaryRevisions.status, "ACTIVE"),
        isNotNull(aiConversationSummaryRevisions.summaryText),
        eq(aiConversations.principalRef, input.principalRef),
        eq(aiConversations.subjectKey, input.subjectKey),
        eq(aiConversations.status, "ACTIVE"),
      )).orderBy(desc(aiConversationSummaryRevisions.revision), desc(aiConversationSummaryRevisions.id)).limit(1).get();
    return row ? fromRow(row.summary) : null;
  }

  getRevision(input: { principalRef: string; conversationId: string; revision: number }): AIConversationSummary | null {
    const row = this.database.db.select({ summary: aiConversationSummaryRevisions }).from(aiConversationSummaryRevisions)
      .innerJoin(aiConversations, eq(aiConversationSummaryRevisions.conversationId, aiConversations.id))
      .where(and(
        eq(aiConversationSummaryRevisions.conversationId, input.conversationId),
        eq(aiConversationSummaryRevisions.principalRef, input.principalRef),
        eq(aiConversationSummaryRevisions.revision, input.revision),
        eq(aiConversations.principalRef, input.principalRef),
      )).get();
    return row ? fromRow(row.summary) : null;
  }

  insertRevision(input: Omit<AIConversationSummary, "status" | "deletedAt"> & { id: string }): AIConversationSummary {
    try {
      const row = this.database.db.insert(aiConversationSummaryRevisions).values({
        id: input.id,
        conversationId: input.conversationId,
        principalRef: input.principalRef,
        subjectKey: input.subjectKey,
        revision: input.revision,
        status: "ACTIVE",
        summaryText: input.summaryText,
        coversThroughOrdinal: input.coversThroughOrdinal,
        sourceStartOrdinal: input.sourceStartOrdinal,
        sourceEndOrdinal: input.sourceEndOrdinal,
        sourceMessageCount: input.sourceMessageCount,
        createdAt: input.createdAt,
        deletedAt: null,
      }).returning().get();
      return fromRow(row);
    } catch (error) {
      throw new AIMemoryError("AI_MEMORY_SUMMARY_CONFLICT", "The Conversation Summary revision could not be created safely.", {}, error);
    }
  }

  purgeForConversationInTransaction(input: { conversationId: string; principalRef: string; at: number }): number {
    const result = this.database.db.update(aiConversationSummaryRevisions).set({
      status: "DELETED",
      summaryText: null,
      deletedAt: input.at,
    }).where(and(
      eq(aiConversationSummaryRevisions.conversationId, input.conversationId),
      eq(aiConversationSummaryRevisions.principalRef, input.principalRef),
      inArray(aiConversationSummaryRevisions.status, ["ACTIVE"]),
    )).run();
    return result.changes;
  }

  purgeForPrincipalInTransaction(input: { principalRef: string; at: number; limit?: number }): number {
    const limit = input.limit ?? AI_MEMORY_PURGE_BATCH_SIZE;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > AI_MEMORY_PURGE_BATCH_SIZE) throw new AIMemoryError("AI_MEMORY_SUMMARY_INVALID", "The Summary principal purge limit is invalid.");
    const rows = this.database.db.select({ id: aiConversationSummaryRevisions.id }).from(aiConversationSummaryRevisions)
      .innerJoin(aiConversations, eq(aiConversationSummaryRevisions.conversationId, aiConversations.id))
      .where(and(eq(aiConversationSummaryRevisions.principalRef, input.principalRef), eq(aiConversations.status, "DELETED"), eq(aiConversationSummaryRevisions.status, "ACTIVE")))
      .orderBy(asc(aiConversationSummaryRevisions.createdAt), asc(aiConversationSummaryRevisions.id))
      .limit(limit)
      .all();
    let count = 0;
    for (const row of rows) {
      count += this.database.db.update(aiConversationSummaryRevisions).set({
        status: "DELETED",
        summaryText: null,
        deletedAt: input.at,
      }).where(eq(aiConversationSummaryRevisions.id, row.id)).run().changes;
    }
    return count;
  }
}

function fromRow(row: AIConversationSummaryRevisionRow): AIConversationSummary {
  return {
    id: row.id,
    conversationId: row.conversationId,
    principalRef: row.principalRef,
    subjectKey: row.subjectKey,
    revision: row.revision,
    status: row.status,
    summaryText: row.summaryText,
    coversThroughOrdinal: row.coversThroughOrdinal,
    sourceStartOrdinal: row.sourceStartOrdinal,
    sourceEndOrdinal: row.sourceEndOrdinal,
    sourceMessageCount: row.sourceMessageCount,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
  };
}
