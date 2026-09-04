import type { AdminActor } from "../../admin-auth/contracts";

export const AI_MEMORY_POLICY_RESOURCE_TYPE = "ai.memory-policy" as const;
export const AI_MEMORY_POLICY_MAX_RETENTION_DAYS = 3_650;
export const AI_MEMORY_POLICY_MAX_SELECTED_MEMORIES = 100;
export const AI_MEMORY_MAX_TEXT_BYTES = 128 * 1024;
export const AI_MEMORY_MAX_SOURCE_MESSAGES = 10_000;
export const AI_MEMORY_PURGE_BATCH_SIZE = 100;
export const AI_MEMORY_CONFIDENCE_SCALE = 1_000_000;

export const AI_MEMORY_STATUSES = ["CANDIDATE", "APPROVED", "REJECTED", "DELETED"] as const;
export type AIMemoryStatus = (typeof AI_MEMORY_STATUSES)[number];

export const AI_MEMORY_VISIBILITY_SCOPES = ["PRINCIPAL_SUBJECT"] as const;
export type AIMemoryVisibilityScope = (typeof AI_MEMORY_VISIBILITY_SCOPES)[number];

export const AI_MEMORY_CREATION_ORIGINS = ["CONVERSATION"] as const;
export type AIMemoryCreationOrigin = (typeof AI_MEMORY_CREATION_ORIGINS)[number];

export const AI_MEMORY_SAFE_REVIEW_CODES = [
  "STUDENT_APPROVED",
  "STUDENT_REJECTED",
  "CONVERSATION_DELETED",
  "PRINCIPAL_PURGED",
] as const;
export type AIMemorySafeReviewCode = (typeof AI_MEMORY_SAFE_REVIEW_CODES)[number];

export interface AIMemoryPolicyContent {
  key: string;
  subjectKey: string;
  displayName: string;
  enabled: boolean;
  candidateReviewRequired: boolean;
  retentionDays: number;
  maxSelectedMemories: number;
}

export interface AIMemoryPolicyRevision extends AIMemoryPolicyContent {
  memoryPolicyId: string;
  revisionId: string;
  revision: number;
  createdAt: number;
  createdBy: string;
}

export interface AIMemoryPolicy extends AIMemoryPolicyContent {
  id: string;
  currentRevision: number;
  currentRevisionId: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}

export interface AIMemoryPolicyRepository {
  getById(id: string): AIMemoryPolicy | null;
  getBySubjectKey(subjectKey: string): AIMemoryPolicy | null;
  getCurrentRevision(id: string): AIMemoryPolicyRevision | null;
  getRevision(id: string, revision: number): AIMemoryPolicyRevision | null;
  list(): AIMemoryPolicy[];
  create(input: { id: string; content: AIMemoryPolicyContent; actor: AdminActor; now: number }): AIMemoryPolicyRevision;
  appendRevision(input: { id: string; expectedRevision: number; content: AIMemoryPolicyContent; actor: AdminActor; now: number }): AIMemoryPolicyRevision;
}

export interface AIMemory {
  id: string;
  principalRef: string;
  subjectKey: string;
  memoryPolicyId: string;
  memoryPolicyRevision: number;
  revision: number;
  status: AIMemoryStatus;
  visibilityScope: AIMemoryVisibilityScope;
  creationOrigin: AIMemoryCreationOrigin;
  sourceConversationId: string;
  sourceStartOrdinal: number;
  sourceEndOrdinal: number;
  memoryText: string | null;
  confidenceUnits: number;
  createdAt: number;
  reviewedAt: number | null;
  deletedAt: number | null;
  expiresAt: number;
  safeReviewCode: AIMemorySafeReviewCode | null;
}

/** Runtime-only selected memory; its text is never copied into Context Snapshots. */
export interface AIContextMemory {
  memoryId: string;
  revision: number;
  subjectKey: string;
  text: string;
  confidenceUnits: number;
  sourceConversationId: string;
  sourceStartOrdinal: number;
  sourceEndOrdinal: number;
  createdAt: number;
  expiresAt: number;
}

export interface AIMemoryRepository {
  getById(input: { principalRef: string; memoryId: string; subjectKey?: string }): AIMemory | null;
  listEligible(input: { principalRef: string; subjectKey: string; at: number; limit: number }): AIContextMemory[];
  insertCandidate(input: Omit<AIMemory, "id"> & { id: string }): AIMemory;
  review(input: { id: string; principalRef: string; status: "APPROVED" | "REJECTED"; reviewedAt: number; safeReviewCode: "STUDENT_APPROVED" | "STUDENT_REJECTED" }): AIMemory;
  purgeForConversationInTransaction(input: { conversationId: string; principalRef: string; at: number }): number;
  purgeForPrincipalInTransaction(input: { principalRef: string; at: number; limit?: number }): number;
}

export const AI_MEMORY_ERROR_CODES = [
  "AI_MEMORY_INVALID",
  "AI_MEMORY_NOT_FOUND",
  "AI_MEMORY_POLICY_NOT_FOUND",
  "AI_MEMORY_POLICY_DISABLED",
  "AI_MEMORY_SCOPE_MISMATCH",
  "AI_MEMORY_SOURCE_INVALID",
  "AI_MEMORY_LIFECYCLE_CONFLICT",
  "AI_MEMORY_SUMMARY_INVALID",
  "AI_MEMORY_SUMMARY_CONFLICT",
] as const;
export type AIMemoryErrorCode = (typeof AI_MEMORY_ERROR_CODES)[number];

export class AIMemoryError extends Error {
  constructor(
    readonly code: AIMemoryErrorCode,
    message: string,
    readonly details: Readonly<Record<string, boolean | number | string | null>> = {},
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AIMemoryError";
  }
}
