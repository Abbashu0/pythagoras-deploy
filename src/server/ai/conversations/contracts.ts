import type { CanonicalMaterial } from "../../canonical-content/contracts";

export const AI_STUDENT_PRINCIPAL_STATUSES = ["ACTIVE", "SUSPENDED", "DELETED"] as const;
export type AIStudentPrincipalStatus = (typeof AI_STUDENT_PRINCIPAL_STATUSES)[number];

export interface AIStudentPrincipal {
  principalRef: string;
  status: AIStudentPrincipalStatus;
}

export interface StudentPrincipalProvider {
  resolve(serverRequestContext: unknown): Promise<AIStudentPrincipal | null>;
}

export interface AIConversationSubject {
  subjectKey: string;
  label: string;
  available: boolean;
}

export interface AIConversationSubjectCatalog {
  getSubject(subjectKey: string): AIConversationSubject | null;
}

export type AIConversationSubjectRecord = Pick<CanonicalMaterial, "subjectKey" | "label" | "available">;

export const AI_CONVERSATION_STATUSES = ["ACTIVE", "DELETED"] as const;
export type AIConversationStatus = (typeof AI_CONVERSATION_STATUSES)[number];

export const AI_CONVERSATION_MESSAGE_ROLES = ["USER", "ASSISTANT"] as const;
export type AIConversationMessageRole = (typeof AI_CONVERSATION_MESSAGE_ROLES)[number];

export const AI_CONVERSATION_RESPONSE_STATUSES = ["PENDING", "STREAMING", "COMPLETED", "FAILED", "CANCELLED"] as const;
export type AIConversationResponseStatus = (typeof AI_CONVERSATION_RESPONSE_STATUSES)[number];

export const AI_CONVERSATION_FINISH_REASONS = ["STOP", "LENGTH", "CONTENT_FILTER", "OTHER", "FAILED", "CANCELLED"] as const;
export type AIConversationFinishReason = (typeof AI_CONVERSATION_FINISH_REASONS)[number];

export const AI_CONVERSATION_SAFE_ERROR_CODES = [
  "AI_CONVERSATION_RESPONSE_INVALID",
  "AI_CONVERSATION_STREAM_CONFLICT",
  "AI_CONVERSATION_CANCELLED",
  "AI_CONVERSATION_DELETED",
  "AI_CONVERSATION_INTERNAL",
] as const;
export type AIConversationSafeErrorCode = (typeof AI_CONVERSATION_SAFE_ERROR_CODES)[number];

export const AI_CONVERSATION_MAX_MESSAGE_BYTES = 512 * 1024;
export const AI_CONVERSATION_MAX_RESPONSE_BYTES = 512 * 1024;
export const AI_CONVERSATION_MAX_CHUNK_BYTES = 16 * 1024;
export const AI_CONVERSATION_MAX_MESSAGE_PAGE_SIZE = 100;
export const AI_CONVERSATION_MAX_CONVERSATION_PAGE_SIZE = 50;

export interface AIConversation {
  id: string;
  principalRef: string;
  subjectKey: string;
  status: AIConversationStatus;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
  deletedAt: number | null;
  revision: number;
}

export interface AIConversationMessage {
  id: string;
  conversationId: string;
  ordinal: number;
  role: AIConversationMessageRole;
  content: string;
  isPartial: boolean;
  createdAt: number;
}

export interface AIConversationResponse {
  id: string;
  conversationId: string;
  principalRef: string;
  idempotencyKey: string | null;
  requestFingerprint: string | null;
  requestMessageId: string | null;
  assistantMessageId: string | null;
  status: AIConversationResponseStatus;
  nextChunkSequence: number;
  outputBytes: number;
  finishReason: AIConversationFinishReason | null;
  safeErrorCode: AIConversationSafeErrorCode | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
}

export interface AIConversationResponseChunk {
  responseId: string;
  sequence: number;
  text: string;
  textHash: string;
  byteLength: number;
  createdAt: number;
}

export interface AIBeginTurnInput {
  conversationId: string;
  idempotencyKey: string;
  userContent: string;
}

export interface AIBeginTurnResult {
  replayed: boolean;
  conversation: AIConversation;
  userMessage: AIConversationMessage;
  response: AIConversationResponse;
}

export interface AICreateConversationResult {
  conversation: AIConversation;
}

export interface AIConversationListCursor {
  lastActivityAt: number;
  conversationId: string;
}

export interface AIConversationListQuery {
  subjectKey?: string;
  cursor?: AIConversationListCursor;
  limit?: number;
}

export interface AIConversationMessageQuery {
  afterOrdinal?: number;
  limit?: number;
}

export interface AIConversationResponseResult {
  response: AIConversationResponse;
  assistantMessage: AIConversationMessage | null;
}

export interface AIConversationChunkAppendResult {
  response: AIConversationResponse;
  chunk: AIConversationResponseChunk;
  replayed: boolean;
}
