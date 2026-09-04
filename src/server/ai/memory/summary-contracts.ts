import type { AIStudentPrincipal, AIConversationMessage } from "../conversations/contracts";

export const AI_CONVERSATION_SUMMARY_MAX_BYTES = 128 * 1024;
export const AI_CONVERSATION_SUMMARY_STATUSES = ["ACTIVE", "DELETED"] as const;
export type AIConversationSummaryStatus = (typeof AI_CONVERSATION_SUMMARY_STATUSES)[number];
export const AI_CONVERSATION_SUMMARY_SAFE_DELETION_CODES = ["CONVERSATION_DELETED", "PRINCIPAL_PURGED"] as const;
export type AIConversationSummarySafeDeletionCode = (typeof AI_CONVERSATION_SUMMARY_SAFE_DELETION_CODES)[number];

export interface AIConversationSummary {
  id: string;
  conversationId: string;
  principalRef: string;
  subjectKey: string;
  revision: number;
  status: AIConversationSummaryStatus;
  summaryText: string | null;
  coversThroughOrdinal: number;
  sourceStartOrdinal: number;
  sourceEndOrdinal: number;
  sourceMessageCount: number;
  createdAt: number;
  deletedAt: number | null;
  safeDeletionCode: AIConversationSummarySafeDeletionCode | null;
}

export interface AIConversationSummaryRepository {
  getCurrentForConversation(input: { principalRef: string; conversationId: string; subjectKey: string }): AIConversationSummary | null;
  getRevision(input: { principalRef: string; conversationId: string; revision: number }): AIConversationSummary | null;
  insertRevision(input: Omit<AIConversationSummary, "status" | "deletedAt" | "safeDeletionCode"> & { id: string }): AIConversationSummary;
  purgeForConversationInTransaction(input: { conversationId: string; principalRef: string; at: number }): number;
  purgeForPrincipalInTransaction(input: { principalRef: string; at: number; limit?: number }): number;
}

export interface AIConversationSummaryCreateInput {
  conversationId: string;
  subjectKey: string;
  summaryText: string;
  coversThroughOrdinal: number;
  expectedRevision?: number;
  now?: number;
}

export interface AIConversationSummaryServiceContract {
  createRevision(principal: AIStudentPrincipal, input: AIConversationSummaryCreateInput): AIConversationSummary;
  getCurrent(principal: AIStudentPrincipal, input: { conversationId: string; subjectKey: string }): AIConversationSummary | null;
}

/** Internal validation shape for complete M4 source coverage. */
export type AIConversationSummarySourceMessages = readonly AIConversationMessage[];
