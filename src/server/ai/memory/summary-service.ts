import { v7 as uuidv7 } from "uuid";

import type { ContentDatabase } from "../../content/database";
import { assertActiveStudentPrincipal } from "../conversations/principal";
import type { AIStudentPrincipal } from "../conversations/contracts";
import { SQLiteAIConversationRepository } from "../conversations/sqlite-repository";
import {
  AIMemoryError,
  AI_MEMORY_MAX_SOURCE_MESSAGES,
} from "./contracts";
import type {
  AIConversationSummary,
  AIConversationSummaryCreateInput,
  AIConversationSummaryRepository,
  AIConversationSummaryServiceContract,
} from "./summary-contracts";
import { AI_CONVERSATION_SUMMARY_MAX_BYTES } from "./summary-contracts";
import { SQLiteAIConversationSummaryRepository } from "./summary-repository";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SUBJECT_KEY_PATTERN = /^[a-z0-9-]{1,80}$/u;
const MAX_TIMESTAMP = 8_640_000_000_000_000;

export interface AIConversationSummaryServiceDependencies {
  summaries?: AIConversationSummaryRepository;
  conversations?: SQLiteAIConversationRepository;
  clock?: () => number;
  idFactory?: () => string;
}

export class AIConversationSummaryService implements AIConversationSummaryServiceContract {
  private readonly summaries: AIConversationSummaryRepository;
  private readonly conversations: SQLiteAIConversationRepository;
  private readonly clock: () => number;
  private readonly idFactory: () => string;

  constructor(private readonly database: ContentDatabase, dependencies: AIConversationSummaryServiceDependencies = {}) {
    this.summaries = dependencies.summaries ?? new SQLiteAIConversationSummaryRepository(database);
    this.conversations = dependencies.conversations ?? new SQLiteAIConversationRepository(database);
    this.clock = dependencies.clock ?? Date.now;
    this.idFactory = dependencies.idFactory ?? uuidv7;
  }

  createRevision(principal: AIStudentPrincipal, input: AIConversationSummaryCreateInput): AIConversationSummary {
    const activePrincipal = assertActiveStudentPrincipal(principal);
    const conversationId = normalizeUuid(input.conversationId, "The Summary Conversation identity is invalid.");
    const subjectKey = normalizeSubjectKey(input.subjectKey);
    const conversation = this.conversations.getConversation(activePrincipal.principalRef, conversationId);
    if (!conversation || conversation.status !== "ACTIVE") throw new AIMemoryError("AI_MEMORY_SOURCE_INVALID", "The source Conversation is not available for Summary creation.");
    if (conversation.subjectKey !== subjectKey) throw new AIMemoryError("AI_MEMORY_SCOPE_MISMATCH", "The Summary subject does not match its source Conversation.");
    const summaryText = normalizeSummaryText(input.summaryText);
    if (!Number.isSafeInteger(input.coversThroughOrdinal) || input.coversThroughOrdinal < 1 || input.coversThroughOrdinal > 100_000_000) throw new AIMemoryError("AI_MEMORY_SUMMARY_INVALID", "Summary coverage is invalid.");
    const sourceMessages = this.conversations.listMessagesBefore({
      principalRef: activePrincipal.principalRef,
      conversationId,
      beforeOrdinal: input.coversThroughOrdinal + 1,
      afterOrdinal: 0,
      limit: AI_MEMORY_MAX_SOURCE_MESSAGES,
      excludePartial: false,
    }).sort((left, right) => left.ordinal - right.ordinal);
    if (sourceMessages.length !== input.coversThroughOrdinal || sourceMessages.some((message) => message.isPartial) || sourceMessages.at(-1)?.role !== "ASSISTANT") {
      throw new AIMemoryError("AI_MEMORY_SUMMARY_INVALID", "Summary coverage must end at a complete non-partial Assistant message.");
    }
    const now = input.now ?? this.safeNow();
    this.assertTimestamp(now);
    return this.database.client.transaction(() => {
      const current = this.summaries.getCurrentForConversation({ principalRef: activePrincipal.principalRef, conversationId, subjectKey });
      const expectedRevision = input.expectedRevision ?? current?.revision ?? 0;
      if ((current?.revision ?? 0) !== expectedRevision) throw new AIMemoryError("AI_MEMORY_SUMMARY_CONFLICT", "The Conversation Summary changed before publication.");
      const nextRevision = expectedRevision + 1;
      if (current && input.coversThroughOrdinal < current.coversThroughOrdinal) throw new AIMemoryError("AI_MEMORY_SUMMARY_CONFLICT", "Summary coverage cannot move backward.");
      return this.summaries.insertRevision({
        id: this.idFactory(),
        conversationId,
        principalRef: activePrincipal.principalRef,
        subjectKey,
        revision: nextRevision,
        summaryText,
        coversThroughOrdinal: input.coversThroughOrdinal,
        sourceStartOrdinal: 1,
        sourceEndOrdinal: input.coversThroughOrdinal,
        sourceMessageCount: sourceMessages.length,
        createdAt: now,
      });
    }).immediate();
  }

  getCurrent(principal: AIStudentPrincipal, input: { conversationId: string; subjectKey: string }): AIConversationSummary | null {
    const activePrincipal = assertActiveStudentPrincipal(principal);
    const conversationId = normalizeUuid(input.conversationId, "The Summary Conversation identity is invalid.");
    const subjectKey = normalizeSubjectKey(input.subjectKey);
    return this.summaries.getCurrentForConversation({ principalRef: activePrincipal.principalRef, conversationId, subjectKey });
  }

  purgePrincipalInTransaction(principalRef: string, at: number, limit?: number): number {
    return this.summaries.purgeForPrincipalInTransaction({ principalRef, at, ...(limit === undefined ? {} : { limit }) });
  }

  private safeNow(): number {
    const value = this.clock();
    this.assertTimestamp(value);
    return value;
  }

  private assertTimestamp(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMESTAMP) throw new AIMemoryError("AI_MEMORY_INVALID", "Summary timestamp is invalid.");
  }
}

function normalizeSummaryText(value: unknown): string {
  if (typeof value !== "string") throw new AIMemoryError("AI_MEMORY_SUMMARY_INVALID", "Summary text must be text.");
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > AI_CONVERSATION_SUMMARY_MAX_BYTES) throw new AIMemoryError("AI_MEMORY_SUMMARY_INVALID", "Summary text exceeds its bounded limit.");
  return normalized;
}

function normalizeUuid(value: unknown, message: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new AIMemoryError("AI_MEMORY_SUMMARY_INVALID", message);
  return value;
}

function normalizeSubjectKey(value: unknown): string {
  if (typeof value !== "string") throw new AIMemoryError("AI_MEMORY_SCOPE_MISMATCH", "The Summary subject is invalid.");
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  if (!SUBJECT_KEY_PATTERN.test(normalized)) throw new AIMemoryError("AI_MEMORY_SCOPE_MISMATCH", "The Summary subject is invalid.");
  return normalized;
}
