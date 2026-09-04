import { v7 as uuidv7 } from "uuid";

import { assertActiveStudentPrincipal } from "../conversations/principal";
import type { AIStudentPrincipal } from "../conversations/contracts";
import { SQLiteAIConversationRepository } from "../conversations/sqlite-repository";
import { AIMemoryError, AI_MEMORY_MAX_SOURCE_MESSAGES, AI_MEMORY_CONFIDENCE_SCALE } from "./contracts";
import type { AIMemory, AIMemoryPolicyRepository, AIMemoryRepository } from "./contracts";
import { SQLiteAIMemoryPolicyRepository } from "./policy-repository";
import { SQLiteAIMemoryRepository } from "./repository";
import { normalizeAIMemoryText } from "./policy-validation";
import type { ContentDatabase } from "../../content/database";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SUBJECT_KEY_PATTERN = /^[a-z0-9-]{1,80}$/u;
const DAY_MS = 86_400_000;
const MAX_TIMESTAMP = 8_640_000_000_000_000;

export interface AIMemoryServiceDependencies {
  memories?: AIMemoryRepository;
  policies?: AIMemoryPolicyRepository;
  conversations?: SQLiteAIConversationRepository;
  clock?: () => number;
  idFactory?: () => string;
}

export class AIMemoryService {
  private readonly memories: AIMemoryRepository;
  private readonly policies: AIMemoryPolicyRepository;
  private readonly conversations: SQLiteAIConversationRepository;
  private readonly clock: () => number;
  private readonly idFactory: () => string;

  constructor(private readonly database: ContentDatabase, dependencies: AIMemoryServiceDependencies = {}) {
    this.memories = dependencies.memories ?? new SQLiteAIMemoryRepository(database);
    this.policies = dependencies.policies ?? new SQLiteAIMemoryPolicyRepository(database);
    this.conversations = dependencies.conversations ?? new SQLiteAIConversationRepository(database);
    this.clock = dependencies.clock ?? Date.now;
    this.idFactory = dependencies.idFactory ?? uuidv7;
  }

  createCandidate(principal: AIStudentPrincipal, input: {
    id?: string;
    conversationId: string;
    subjectKey: string;
    text: string;
    confidenceUnits: number;
    sourceStartOrdinal: number;
    sourceEndOrdinal: number;
    now?: number;
  }): AIMemory {
    const activePrincipal = assertActiveStudentPrincipal(principal);
    const subjectKey = normalizeSubjectKey(input.subjectKey);
    const conversation = this.conversations.getConversation(activePrincipal.principalRef, input.conversationId);
    if (!conversation || conversation.status !== "ACTIVE") throw new AIMemoryError("AI_MEMORY_SOURCE_INVALID", "The source Conversation is not available for Memory creation.");
    if (conversation.subjectKey !== subjectKey) throw new AIMemoryError("AI_MEMORY_SCOPE_MISMATCH", "The Memory subject does not match its source Conversation.");
    const policy = this.policies.getBySubjectKey(subjectKey);
    if (!policy) throw new AIMemoryError("AI_MEMORY_POLICY_NOT_FOUND", "No Memory Policy is published for this subject.");
    const policyRevision = this.policies.getCurrentRevision(policy.id);
    if (!policyRevision) throw new AIMemoryError("AI_MEMORY_POLICY_NOT_FOUND", "The current Memory Policy revision is unavailable.");
    if (!policyRevision.enabled) throw new AIMemoryError("AI_MEMORY_POLICY_DISABLED", "The Memory Policy is disabled.");
    const text = normalizeAIMemoryText(input.text);
    this.validateConfidence(input.confidenceUnits);
    this.validateSourceRange(input.sourceStartOrdinal, input.sourceEndOrdinal);
    const messages = this.conversations.listMessagesBefore({
      principalRef: activePrincipal.principalRef,
      conversationId: conversation.id,
      beforeOrdinal: input.sourceEndOrdinal + 1,
      afterOrdinal: input.sourceStartOrdinal - 1,
      limit: AI_MEMORY_MAX_SOURCE_MESSAGES,
      excludePartial: false,
    }).sort((left, right) => left.ordinal - right.ordinal);
    if (messages.length !== input.sourceEndOrdinal - input.sourceStartOrdinal + 1 || messages.some((message) => message.isPartial) || messages.at(-1)?.role !== "ASSISTANT") {
      throw new AIMemoryError("AI_MEMORY_SOURCE_INVALID", "Memory provenance must cover complete non-partial Conversation messages.");
    }
    const now = input.now ?? this.safeNow();
    this.assertTimestamp(now);
    const expiresAt = this.addRetention(now, policyRevision.retentionDays);
    return this.database.client.transaction(() => this.memories.insertCandidate({
      id: input.id ?? this.idFactory(),
      principalRef: activePrincipal.principalRef,
      subjectKey,
      memoryPolicyId: policy.id,
      memoryPolicyRevision: policyRevision.revision,
      revision: 1,
      status: "CANDIDATE",
      visibilityScope: "PRINCIPAL_SUBJECT",
      creationOrigin: "CONVERSATION",
      sourceConversationId: conversation.id,
      sourceStartOrdinal: input.sourceStartOrdinal,
      sourceEndOrdinal: input.sourceEndOrdinal,
      memoryText: text,
      confidenceUnits: input.confidenceUnits,
      createdAt: now,
      reviewedAt: null,
      deletedAt: null,
      expiresAt,
      safeReviewCode: null,
    })).immediate();
  }

  get(principal: AIStudentPrincipal, memoryId: string, subjectKey: string): AIMemory | null {
    const activePrincipal = assertActiveStudentPrincipal(principal);
    if (!UUID_PATTERN.test(memoryId)) throw new AIMemoryError("AI_MEMORY_INVALID", "The Memory identity is invalid.");
    return this.memories.getById({ principalRef: activePrincipal.principalRef, memoryId, subjectKey: normalizeSubjectKey(subjectKey) });
  }

  listEligible(principal: AIStudentPrincipal, subjectKey: string, input: { at?: number; limit?: number } = {}) {
    const activePrincipal = assertActiveStudentPrincipal(principal);
    const normalizedSubject = normalizeSubjectKey(subjectKey);
    const policy = this.policies.getBySubjectKey(normalizedSubject);
    if (!policy || !policy.enabled) return [];
    return this.memories.listEligible({ principalRef: activePrincipal.principalRef, subjectKey: normalizedSubject, at: input.at ?? this.safeNow(), limit: input.limit ?? policy.maxSelectedMemories });
  }

  approve(principal: AIStudentPrincipal, input: { memoryId: string; subjectKey: string; now?: number }): AIMemory {
    const activePrincipal = assertActiveStudentPrincipal(principal);
    const memory = this.requireCandidate(activePrincipal.principalRef, input.memoryId, input.subjectKey);
    const reviewedAt = this.reviewTimestamp(input.now, memory.createdAt);
    return this.memories.review({ id: memory.id, principalRef: activePrincipal.principalRef, status: "APPROVED", reviewedAt, safeReviewCode: "STUDENT_APPROVED" });
  }

  reject(principal: AIStudentPrincipal, input: { memoryId: string; subjectKey: string; now?: number }): AIMemory {
    const activePrincipal = assertActiveStudentPrincipal(principal);
    const memory = this.requireCandidate(activePrincipal.principalRef, input.memoryId, input.subjectKey);
    const reviewedAt = this.reviewTimestamp(input.now, memory.createdAt);
    return this.memories.review({ id: memory.id, principalRef: activePrincipal.principalRef, status: "REJECTED", reviewedAt, safeReviewCode: "STUDENT_REJECTED" });
  }

  /** Internal, server-owned preparation for future principal deletion. */
  purgePrincipalInTransaction(principalRef: string, at: number, limit?: number): number {
    return this.memories.purgeForPrincipalInTransaction({ principalRef, at, ...(limit === undefined ? {} : { limit }) });
  }

  private requireCandidate(principalRef: string, memoryId: string, subjectKey: string): AIMemory {
    const normalizedSubject = normalizeSubjectKey(subjectKey);
    const memory = this.memories.getById({ principalRef, memoryId, subjectKey: normalizedSubject });
    if (!memory) throw new AIMemoryError("AI_MEMORY_NOT_FOUND", "The Memory was not found.");
    if (memory.status !== "CANDIDATE") throw new AIMemoryError("AI_MEMORY_LIFECYCLE_CONFLICT", "Only a Memory candidate can be reviewed.");
    return memory;
  }

  private addRetention(now: number, retentionDays: number): number {
    const duration = retentionDays * DAY_MS;
    if (!Number.isSafeInteger(duration) || now > MAX_TIMESTAMP - duration) throw new AIMemoryError("AI_MEMORY_INVALID", "The Memory expiry timestamp is invalid.");
    return now + duration;
  }

  private validateConfidence(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > AI_MEMORY_CONFIDENCE_SCALE) throw new AIMemoryError("AI_MEMORY_INVALID", "Memory confidence is invalid.");
  }

  private validateSourceRange(start: number, end: number): void {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end - start + 1 > AI_MEMORY_MAX_SOURCE_MESSAGES) throw new AIMemoryError("AI_MEMORY_SOURCE_INVALID", "Memory source coverage is invalid.");
  }

  private assertTimestamp(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMESTAMP) throw new AIMemoryError("AI_MEMORY_INVALID", "Memory timestamp is invalid.");
  }

  private reviewTimestamp(value: number | undefined, createdAt: number): number {
    const reviewedAt = value === undefined ? this.safeNow() : value;
    this.assertTimestamp(reviewedAt);
    if (reviewedAt < createdAt) throw new AIMemoryError("AI_MEMORY_INVALID", "The Memory review timestamp precedes creation.");
    return reviewedAt;
  }

  private safeNow(): number {
    const value = this.clock();
    this.assertTimestamp(value);
    return value;
  }
}

function normalizeSubjectKey(value: unknown): string {
  if (typeof value !== "string") throw new AIMemoryError("AI_MEMORY_SCOPE_MISMATCH", "The Memory subject is invalid.");
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  if (!SUBJECT_KEY_PATTERN.test(normalized)) throw new AIMemoryError("AI_MEMORY_SCOPE_MISMATCH", "The Memory subject is invalid.");
  return normalized;
}
