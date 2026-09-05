import type { AdminActor } from "../../admin-auth/contracts";

export const AI_MEMORY_POLICY_RESOURCE_TYPE = "ai.memory-policy" as const;
export const AI_MEMORY_POLICY_MAX_RETENTION_DAYS = 3_650;
export const AI_MEMORY_POLICY_MAX_SELECTED_MEMORIES = 100;
export const AI_MEMORY_MAX_TEXT_BYTES = 128 * 1024;
export const AI_MEMORY_MAX_SOURCE_MESSAGES = 10_000;
export const AI_MEMORY_PURGE_BATCH_SIZE = 100;
export const AI_MEMORY_CONFIDENCE_SCALE = 1_000_000;
export const AI_MEMORY_MAX_PROPOSED_PER_SCOPE = 20;
export const AI_MEMORY_MAX_EVIDENCE_PER_REVISION = 10;
export const AI_MEMORY_POLICY_MAX_HARD_ACTIVE = 100;
export const AI_MEMORY_POLICY_MAX_SELECTED_PER_REQUEST = 100;
export const AI_MEMORY_POLICY_MAX_PER_MEMORY_BYTES = 131_072;

export const AI_MEMORY_SCOPES = ["GLOBAL", "SUBJECT"] as const;
export type AIMemoryScope = (typeof AI_MEMORY_SCOPES)[number];

export const AI_MEMORY_STATUSES = ["PROPOSED", "ACTIVE", "RESOLVED", "EXPIRED", "DELETED"] as const;
export type AIMemoryStatus = (typeof AI_MEMORY_STATUSES)[number];

export const AI_MEMORY_VISIBILITY_SCOPES = ["PRINCIPAL_GLOBAL", "PRINCIPAL_SUBJECT"] as const;
export type AIMemoryVisibilityScope = (typeof AI_MEMORY_VISIBILITY_SCOPES)[number];

export const AI_MEMORY_CREATION_ORIGINS = ["EXPLICIT", "INFERRED", "LEGACY_SUBJECT"] as const;
export type AIMemoryCreationOrigin = (typeof AI_MEMORY_CREATION_ORIGINS)[number];

export const AI_MEMORY_KINDS = [
  "LEARNING_PREFERENCE",
  "EXPLANATION_PREFERENCE",
  "RESPONSE_DEPTH_PREFERENCE",
  "FORM_OF_ADDRESS",
  "PREFERRED_NAME",
  "LEARNING_DIFFICULTY",
  "STUDY_GOAL",
  "STUDY_PROGRESS",
  "LEARNING_STRATEGY_PREFERENCE",
] as const;
export type AIMemoryKind = (typeof AI_MEMORY_KINDS)[number];

export const AI_MEMORY_SAFE_REVIEW_CODES = [
  "EXPLICIT_CREATED",
  "INFERRED_PROPOSED",
  "INFERRED_ACTIVATED",
  "MEMORY_RESOLVED",
  "MEMORY_EXPIRED",
  "MEMORY_DELETED",
  "LEGACY_MIGRATED",
  "CONVERSATION_DELETED",
  "PRINCIPAL_PURGED",
  "STUDENT_APPROVED",
  "STUDENT_REJECTED",
  "SYSTEM_AUTO_APPROVED",
] as const;
export type AIMemorySafeReviewCode = (typeof AI_MEMORY_SAFE_REVIEW_CODES)[number];

export interface AIMemoryPolicyContent {
  key: string;
  scope?: AIMemoryScope;
  subjectKey: string | null;
  displayName: string;
  enabled: boolean;
  allowedKinds?: AIMemoryKind[];
  targetActiveCount?: number;
  hardActiveMaximum?: number;
  maxSelectedPerRequest?: number;
  proposedHardMaximum?: number;
  perMemoryMaxBytes?: number;
  retentionDays: number;
  mutationEnabled?: boolean;
  explicitMinConfidenceUnits?: number;
  inferredMinConfidenceUnits?: number;
  inferredMinDistinctEvidenceTurns?: number;
  /** Deprecated M10A compatibility field; not used by the new mutation path. */
  candidateReviewRequired?: boolean;
  /** Deprecated M10A compatibility field; maps to the new selection bound. */
  maxSelectedMemories?: number;
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
  m10a2MutationAuthority: boolean;
  currentRevision: number;
  currentRevisionId: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}

export interface AIMemoryPolicyRepository {
  getById(id: string): AIMemoryPolicy | null;
  getByScope(scope: AIMemoryScope, subjectKey: string | null): AIMemoryPolicy | null;
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
  scope: AIMemoryScope;
  subjectKey: string | null;
  memoryPolicyId: string;
  memoryPolicyRevision: number;
  revision: number;
  status: AIMemoryStatus;
  visibilityScope: AIMemoryVisibilityScope;
  creationOrigin: AIMemoryCreationOrigin;
  kind: AIMemoryKind | null;
  sourceConversationId: string;
  sourceStartOrdinal: number;
  sourceEndOrdinal: number;
  memoryText: string | null;
  confidenceUnits: number;
  createdAt: number;
  updatedAt: number;
  reviewedAt: number | null;
  resolvedAt: number | null;
  deletedAt: number | null;
  expiresAt: number;
  safeReviewCode: AIMemorySafeReviewCode | null;
  contentSha256: string | null;
}

/** Runtime-only selected memory; its text is never copied into Context Snapshots. */
export interface AIContextMemory {
  memoryId: string;
  revision: number;
  scope: AIMemoryScope;
  subjectKey: string | null;
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
  listEligibleByScope(input: { principalRef: string; scope: AIMemoryScope; subjectKey: string | null; at: number; limit: number }): AIContextMemory[];
  listByScope(input: { principalRef: string; scope: AIMemoryScope; subjectKey: string | null; statuses: AIMemoryStatus[]; limit?: number }): AIMemory[];
  countByScope(input: { principalRef: string; scope: AIMemoryScope; subjectKey: string | null; status: AIMemoryStatus }): number;
  insertMemory(input: Omit<AIMemory, "id"> & { id: string }): AIMemory;
  updateCurrent(input: { id: string; principalRef: string; expectedRevision: number; patch: Partial<Pick<AIMemory, "status" | "kind" | "memoryText" | "confidenceUnits" | "expiresAt" | "safeReviewCode" | "reviewedAt" | "resolvedAt" | "deletedAt" | "contentSha256">>; revision: number; updatedAt: number }): AIMemory;
  insertCandidate(input: Omit<AIMemory, "id"> & { id: string }): AIMemory;
  review(input: { id: string; principalRef: string; status: "ACTIVE" | "RESOLVED"; reviewedAt: number; safeReviewCode: AIMemorySafeReviewCode }): AIMemory;
  insertProvenance(input: Omit<AIMemoryProvenance, "id"> & { id: string }): AIMemoryProvenance;
  listProvenance(memoryId: string, memoryRevision?: number): AIMemoryProvenance[];
  purgeForConversationInTransaction(input: { conversationId: string; principalRef: string; at: number }): number;
  purgeForPrincipalInTransaction(input: { principalRef: string; at: number; limit?: number }): number;
  countPurgeableForPrincipal(principalRef: string): number;
}

export interface AIMemoryPurgeResult {
  memoriesChanged: number;
  intentsCancelled: number;
  remainingMemories: number;
  remainingIntents: number;
  remainingWork: boolean;
}

export interface AIMemoryProvenance {
  id: string;
  memoryId: string;
  memoryRevision: number;
  principalRef: string;
  scope: AIMemoryScope;
  subjectKey: string | null;
  conversationId: string;
  responseId: string;
  requestMessageId: string;
  assistantMessageId: string;
  sourceStartOrdinal: number;
  sourceEndOrdinal: number;
  sourceState: "ACTIVE" | "DELETED";
  createdAt: number;
}

export interface AIMemoryMutationIntent {
  id: string;
  commandId: string;
  principalRef: string;
  responseId: string;
  conversationId: string;
  scope: AIMemoryScope;
  subjectKey: string | null;
  action: "NOOP" | "CREATE" | "UPDATE" | "RESOLVE" | "DELETE";
  memoryId: string | null;
  expectedRevision: number | null;
  kind: AIMemoryKind | null;
  origin: AIMemoryCreationOrigin | null;
  confidenceUnits: number | null;
  memoryText: string | null;
  status: "PENDING" | "APPLIED" | "FAILED" | "CANCELLED";
  contentSha256: string | null;
  createdAt: number;
  appliedAt: number | null;
}

export interface AIMemoryMutationRecord {
  id: string;
  commandId: string;
  principalRef: string;
  responseId: string;
  scope: AIMemoryScope;
  subjectKey: string | null;
  action: "NOOP" | "CREATE" | "UPDATE" | "RESOLVE" | "DELETE";
  memoryId: string | null;
  origin: AIMemoryCreationOrigin | null;
  expectedRevision: number | null;
  resultRevision: number | null;
  status: "APPLIED" | "REJECTED";
  contentSha256: string | null;
  safeErrorCode: string | null;
  createdAt: number;
}

export interface AIMemoryMutationRepository {
  getIntent(commandId: string): AIMemoryMutationIntent | null;
  insertIntent(input: Omit<AIMemoryMutationIntent, "id" | "contentSha256"> & { id: string; contentSha256: string | null }): AIMemoryMutationIntent;
  markIntentApplied(commandId: string, appliedAt: number): AIMemoryMutationIntent;
  markIntentFailed(commandId: string, safeErrorCode: string, at: number): AIMemoryMutationIntent;
  markIntentCancelled(commandId: string, at: number): AIMemoryMutationIntent;
  cancelPendingForPrincipal(principalRef: string, at: number, limit: number): number;
  countPendingForPrincipal(principalRef: string): number;
  listPendingIntents(limit: number): AIMemoryMutationIntent[];
  insertRecord(input: Omit<AIMemoryMutationRecord, "id"> & { id: string }): AIMemoryMutationRecord;
  getRecord(commandId: string): AIMemoryMutationRecord | null;
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
  "AI_MEMORY_POLICY_SCOPE_INVALID",
  "AI_MEMORY_QUOTA_EXCEEDED",
  "AI_MEMORY_REVISION_CONFLICT",
  "AI_MEMORY_PROVENANCE_INVALID",
  "AI_MEMORY_MUTATION_INVALID",
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
