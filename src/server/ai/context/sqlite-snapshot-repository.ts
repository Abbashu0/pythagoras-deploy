import { and, asc, eq } from "drizzle-orm";

import type { ContentDatabase } from "../../content/database";
import {
  aiContextSnapshotItems,
  aiContextSnapshots,
  aiConversationResponses,
  type AIContextSnapshotItemRow,
  type AIContextSnapshotRow,
} from "../../content/schema";
import type {
  AIContextSnapshot,
  AIContextSnapshotItem,
  AIContextSnapshotRepository,
} from "./contracts";
import { AIContextError } from "./errors";

export class SQLiteAIContextSnapshotRepository implements AIContextSnapshotRepository {
  constructor(private readonly database: ContentDatabase) {}

  getByResponse(principalRef: string, responseId: string): AIContextSnapshot | null {
    const row = this.database.db.select({ snapshot: aiContextSnapshots }).from(aiContextSnapshots)
      .innerJoin(aiConversationResponses, eq(aiContextSnapshots.responseId, aiConversationResponses.id))
      .where(and(
        eq(aiContextSnapshots.responseId, responseId),
        eq(aiContextSnapshots.principalRef, principalRef),
        eq(aiConversationResponses.principalRef, principalRef),
      )).get();
    return row ? snapshotFromRow(row.snapshot) : null;
  }

  listItems(snapshotId: string): AIContextSnapshotItem[] {
    return this.database.db.select().from(aiContextSnapshotItems)
      .where(eq(aiContextSnapshotItems.snapshotId, snapshotId))
      .orderBy(asc(aiContextSnapshotItems.ordinal)).all().map(itemFromRow);
  }

  insertSnapshot(input: Omit<AIContextSnapshot, "id"> & { id: string }): AIContextSnapshot {
    try {
      const row = this.database.db.insert(aiContextSnapshots).values({
        id: input.id,
        responseId: input.responseId,
        conversationId: input.conversationId,
        principalRef: input.principalRef,
        subjectKey: input.subjectKey,
        globalPolicyId: input.globalPolicyId,
        globalPolicyRevision: input.globalPolicyRevision,
        subjectPolicyId: input.subjectPolicyId,
        subjectPolicyRevision: input.subjectPolicyRevision,
        contextPolicyId: input.contextPolicyId,
        contextPolicyRevision: input.contextPolicyRevision,
        precedenceEnvelopeVersion: input.precedenceEnvelopeVersion,
        estimatorKey: input.estimatorKey,
        softInputBudgetTokens: input.softInputBudgetTokens,
        hardInputBudgetTokens: input.hardInputBudgetTokens,
        outputReserveTokens: input.outputReserveTokens,
        globalPolicyTokens: input.globalPolicyTokens,
        subjectPolicyTokens: input.subjectPolicyTokens,
        precedenceEnvelopeTokens: input.precedenceEnvelopeTokens,
        summaryTokens: input.summaryTokens,
        recentTurnsTokens: input.recentTurnsTokens,
        currentMessageTokens: input.currentMessageTokens,
        reservedMemoryBudgetTokens: input.reservedMemoryBudgetTokens,
        reservedEvidenceBudgetTokens: input.reservedEvidenceBudgetTokens,
        totalInputTokens: input.totalInputTokens,
        fingerprint: input.fingerprint,
        createdAt: input.createdAt,
      }).returning().get();
      return snapshotFromRow(row);
    } catch (error) {
      throw new AIContextError("AI_CONTEXT_SNAPSHOT_CONFLICT", "The Context Snapshot could not be created safely.", {}, error);
    }
  }

  insertItem(input: AIContextSnapshotItem): AIContextSnapshotItem {
    try {
      const row = this.database.db.insert(aiContextSnapshotItems).values({
        snapshotId: input.snapshotId,
        ordinal: input.ordinal,
        kind: input.kind,
        sourceId: input.sourceId,
        sourceRevision: input.sourceRevision,
        estimatedTokens: input.estimatedTokens,
        decision: input.decision,
        decisionReason: input.decisionReason,
      }).returning().get();
      return itemFromRow(row);
    } catch (error) {
      throw new AIContextError("AI_CONTEXT_SNAPSHOT_CONFLICT", "The Context Snapshot item could not be created safely.", {}, error);
    }
  }
}

function snapshotFromRow(row: AIContextSnapshotRow): AIContextSnapshot {
  return {
    id: row.id,
    responseId: row.responseId,
    conversationId: row.conversationId,
    principalRef: row.principalRef,
    subjectKey: row.subjectKey,
    globalPolicyId: row.globalPolicyId,
    globalPolicyRevision: row.globalPolicyRevision,
    subjectPolicyId: row.subjectPolicyId,
    subjectPolicyRevision: row.subjectPolicyRevision,
    contextPolicyId: row.contextPolicyId,
    contextPolicyRevision: row.contextPolicyRevision,
    precedenceEnvelopeVersion: row.precedenceEnvelopeVersion,
    estimatorKey: row.estimatorKey,
    softInputBudgetTokens: row.softInputBudgetTokens,
    hardInputBudgetTokens: row.hardInputBudgetTokens,
    outputReserveTokens: row.outputReserveTokens,
    globalPolicyTokens: row.globalPolicyTokens,
    subjectPolicyTokens: row.subjectPolicyTokens,
    precedenceEnvelopeTokens: row.precedenceEnvelopeTokens,
    summaryTokens: row.summaryTokens,
    recentTurnsTokens: row.recentTurnsTokens,
    currentMessageTokens: row.currentMessageTokens,
    reservedMemoryBudgetTokens: row.reservedMemoryBudgetTokens,
    reservedEvidenceBudgetTokens: row.reservedEvidenceBudgetTokens,
    totalInputTokens: row.totalInputTokens,
    fingerprint: row.fingerprint,
    createdAt: row.createdAt,
  };
}

function itemFromRow(row: AIContextSnapshotItemRow): AIContextSnapshotItem {
  return {
    snapshotId: row.snapshotId,
    ordinal: row.ordinal,
    kind: row.kind,
    sourceId: row.sourceId,
    sourceRevision: row.sourceRevision,
    estimatedTokens: row.estimatedTokens,
    decision: row.decision,
    decisionReason: row.decisionReason,
  };
}
