import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";

import { assertActiveStudentPrincipal } from "../conversations/principal";
import type { AIStudentPrincipal } from "../conversations/contracts";
import { SQLiteAIConversationRepository } from "../conversations/sqlite-repository";
import { AIMemoryError, AI_MEMORY_CONFIDENCE_SCALE, AI_MEMORY_MAX_EVIDENCE_PER_REVISION, AI_MEMORY_MAX_PROPOSED_PER_SCOPE, AI_MEMORY_PURGE_BATCH_SIZE, type AIMemory, type AIMemoryCreationOrigin, type AIMemoryKind, type AIMemoryMutationIntent, type AIMemoryMutationRecord, type AIMemoryPolicyRepository, type AIMemoryProvenance, type AIMemoryRepository, type AIMemoryScope } from "./contracts";
import { SQLiteAIMemoryPolicyRepository } from "./policy-repository";
import { SQLiteAIMemoryRepository } from "./repository";
import { SQLiteAIMemoryMutationRepository } from "./mutation-repository";
import type { AIMemoryMutationRepository } from "./contracts";
import { normalizeAIMemoryText } from "./policy-validation";
import type { ContentDatabase } from "../../content/database";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SUBJECT_KEY_PATTERN = /^[a-z0-9-]{1,80}$/u;
const PRINCIPAL_PATTERN = /^[A-Za-z0-9_-]{1,200}$/u;
const COMMAND_PATTERN = /^[A-Za-z0-9._:-]{1,240}$/u;
const MAX_TIMESTAMP = 8_640_000_000_000_000;

export interface AIMemoryServiceDependencies {
  memories?: AIMemoryRepository;
  policies?: AIMemoryPolicyRepository;
  mutations?: AIMemoryMutationRepository;
  conversations?: SQLiteAIConversationRepository;
  clock?: () => number;
  idFactory?: () => string;
}

export interface AIMemorySourceEvidenceInput {
  conversationId: string;
  responseId: string;
  requestMessageId: string;
  assistantMessageId: string;
  sourceStartOrdinal: number;
  sourceEndOrdinal: number;
}

export interface AIMemoryCreateInput {
  id?: string;
  scope: AIMemoryScope;
  subjectKey: string | null;
  kind: AIMemoryKind;
  text: string;
  confidenceUnits: number;
  source: AIMemorySourceEvidenceInput;
  memoryPolicyId?: string;
  memoryPolicyRevision?: number;
  now?: number;
}

export interface AIMemoryMutationIntentInput {
  id?: string;
  commandId: string;
  principal: AIStudentPrincipal;
  responseId: string;
  conversationId: string;
  scope: AIMemoryScope;
  subjectKey: string | null;
  action: AIMemoryMutationIntent["action"];
  memoryId?: string | null;
  expectedRevision?: number | null;
  kind?: AIMemoryKind | null;
  origin?: AIMemoryCreationOrigin | null;
  confidenceUnits?: number | null;
  memoryText?: string | null;
  createdAt?: number;
}

export class AIMemoryService {
  private readonly memories: AIMemoryRepository;
  private readonly policies: AIMemoryPolicyRepository;
  private readonly mutations: AIMemoryMutationRepository;
  private readonly conversations: SQLiteAIConversationRepository;
  private readonly clock: () => number;
  private readonly idFactory: () => string;

  constructor(private readonly database: ContentDatabase, dependencies: AIMemoryServiceDependencies = {}) {
    this.memories = dependencies.memories ?? new SQLiteAIMemoryRepository(database);
    this.policies = dependencies.policies ?? new SQLiteAIMemoryPolicyRepository(database);
    this.mutations = dependencies.mutations ?? new SQLiteAIMemoryMutationRepository(database);
    this.conversations = dependencies.conversations ?? new SQLiteAIConversationRepository(database);
    this.clock = dependencies.clock ?? Date.now;
    this.idFactory = dependencies.idFactory ?? uuidv7;
  }

  get(principal: AIStudentPrincipal, memoryId: string, subjectKey?: string): AIMemory | null {
    const activePrincipal = assertActiveStudentPrincipal(principal);
    if (!UUID_PATTERN.test(memoryId)) throw new AIMemoryError("AI_MEMORY_INVALID", "The Memory identity is invalid.");
    return this.memories.getById({ principalRef: activePrincipal.principalRef, memoryId, ...(subjectKey === undefined ? {} : { subjectKey: normalizeSubject(subjectKey) }) });
  }

  listEligible(principal: AIStudentPrincipal, subjectKey: string, input: { at?: number; limit?: number } = {}) {
    return this.listEligibleByScope(principal, "SUBJECT", normalizeSubject(subjectKey), input);
  }

  /** Compatibility read path. M10C owns adding Global Memories to Context. */
  listEligibleByScope(principal: AIStudentPrincipal, scope: AIMemoryScope, subjectKey: string | null, input: { at?: number; limit?: number } = {}) {
    const activePrincipal = assertActiveStudentPrincipal(principal);
    const normalizedSubjectKey = normalizeScopedSubject(scope, subjectKey);
    const policy = this.policies.getByScope(scope, normalizedSubjectKey);
    if (!policy || (policy.scope ?? "SUBJECT") !== scope || !policy.enabled) return [];
    const limit = input.limit ?? policy.maxSelectedPerRequest ?? policy.maxSelectedMemories ?? 1;
    if (limit === 0) return [];
    return this.memories.listEligibleByScope({ principalRef: activePrincipal.principalRef, scope, subjectKey: normalizedSubjectKey, at: input.at ?? this.safeNow(), limit });
  }

  createExplicitActive(principal: AIStudentPrincipal, input: AIMemoryCreateInput): AIMemory {
    return this.atomic(() => {
      const activePrincipal = assertActiveStudentPrincipal(principal);
      const subjectKey = normalizeScopedSubject(input.scope, input.subjectKey);
      const source = this.validateSource(activePrincipal.principalRef, input.scope, subjectKey, input.source);
      const policy = this.requirePolicy(input.scope, subjectKey, input.memoryPolicyId, input.memoryPolicyRevision);
      this.requireMutationPolicy(policy);
      this.requireKind(policy, input.kind);
      const text = this.validateMemoryText(input.text, policy.perMemoryMaxBytes);
      validateConfidence(input.confidenceUnits);
      this.requireActiveQuota(activePrincipal.principalRef, input.scope, subjectKey, policy.hardActiveMaximum ?? 1);
      const now = input.now ?? this.safeNow();
      const memory = this.memories.insertMemory(this.newMemory({
        id: input.id ?? this.idFactory(),
        principalRef: activePrincipal.principalRef,
        scope: input.scope,
        subjectKey,
        memoryPolicyId: policy.memoryPolicyId,
        memoryPolicyRevision: policy.revision,
        revision: 1,
        status: "ACTIVE",
        visibilityScope: input.scope === "GLOBAL" ? "PRINCIPAL_GLOBAL" : "PRINCIPAL_SUBJECT",
        creationOrigin: "EXPLICIT",
        kind: input.kind,
        sourceConversationId: source.conversationId,
        sourceStartOrdinal: source.sourceStartOrdinal,
        sourceEndOrdinal: source.sourceEndOrdinal,
        memoryText: text,
        confidenceUnits: input.confidenceUnits,
        createdAt: now,
        updatedAt: now,
        reviewedAt: now,
        resolvedAt: null,
        deletedAt: null,
        expiresAt: this.expiry(now, policy.retentionDays),
        safeReviewCode: "EXPLICIT_CREATED",
        contentSha256: hash(text),
      }));
      this.memories.insertProvenance({ id: this.idFactory(), ...source, memoryId: memory.id, memoryRevision: memory.revision, principalRef: activePrincipal.principalRef, scope: input.scope, subjectKey, sourceState: "ACTIVE", createdAt: now });
      return memory;
    });
  }

  proposeInferred(principal: AIStudentPrincipal, input: AIMemoryCreateInput & { evidence?: AIMemorySourceEvidenceInput[] }): AIMemory {
    return this.atomic(() => {
      const activePrincipal = assertActiveStudentPrincipal(principal);
      const subjectKey = normalizeScopedSubject(input.scope, input.subjectKey);
      assertInferenceAllowed(input.scope, input.kind);
      const sources = [input.source, ...(input.evidence ?? [])];
      if (sources.length > AI_MEMORY_MAX_EVIDENCE_PER_REVISION) throw new AIMemoryError("AI_MEMORY_PROVENANCE_INVALID", "The Memory evidence set exceeds its bound.");
      const validatedSources = sources.map((source) => this.validateSource(activePrincipal.principalRef, input.scope, subjectKey, source));
      if (new Set(validatedSources.map((source) => source.responseId)).size !== validatedSources.length) throw new AIMemoryError("AI_MEMORY_PROVENANCE_INVALID", "Memory evidence turns must be distinct.");
      const policy = this.requirePolicy(input.scope, subjectKey, input.memoryPolicyId, input.memoryPolicyRevision);
      this.requireMutationPolicy(policy);
      this.requireKind(policy, input.kind);
      const text = this.validateMemoryText(input.text, policy.perMemoryMaxBytes);
      validateConfidence(input.confidenceUnits);
      this.requireProposedQuota(activePrincipal.principalRef, input.scope, input.subjectKey, policy.proposedHardMaximum ?? AI_MEMORY_MAX_PROPOSED_PER_SCOPE);
      const now = input.now ?? this.safeNow();
      const first = validatedSources[0]!;
      const memory = this.memories.insertMemory(this.newMemory({
        id: input.id ?? this.idFactory(),
        principalRef: activePrincipal.principalRef,
        scope: input.scope,
        subjectKey,
        memoryPolicyId: policy.memoryPolicyId,
        memoryPolicyRevision: policy.revision,
        revision: 1,
        status: "PROPOSED",
        visibilityScope: input.scope === "GLOBAL" ? "PRINCIPAL_GLOBAL" : "PRINCIPAL_SUBJECT",
        creationOrigin: "INFERRED",
        kind: input.kind,
        sourceConversationId: first.conversationId,
        sourceStartOrdinal: first.sourceStartOrdinal,
        sourceEndOrdinal: first.sourceEndOrdinal,
        memoryText: text,
        confidenceUnits: input.confidenceUnits,
        createdAt: now,
        updatedAt: now,
        reviewedAt: null,
        resolvedAt: null,
        deletedAt: null,
        expiresAt: this.expiry(now, policy.retentionDays),
        safeReviewCode: "INFERRED_PROPOSED",
        contentSha256: hash(text),
      }));
      for (const source of validatedSources) this.memories.insertProvenance({ id: this.idFactory(), ...source, memoryId: memory.id, memoryRevision: memory.revision, principalRef: activePrincipal.principalRef, scope: input.scope, subjectKey, sourceState: "ACTIVE", createdAt: now });
      return memory;
    });
  }

  addProposedEvidence(principal: AIStudentPrincipal, input: { memoryId: string; scope: AIMemoryScope; subjectKey: string | null; expectedRevision: number; source: AIMemorySourceEvidenceInput; now?: number }): AIMemoryProvenance {
    return this.atomic(() => {
      const activePrincipal = assertActiveStudentPrincipal(principal);
      const subjectKey = normalizeScopedSubject(input.scope, input.subjectKey);
      const memory = this.requireOwnedCurrent(activePrincipal.principalRef, input.memoryId, input.scope, subjectKey);
      if (memory.status !== "PROPOSED" || memory.creationOrigin !== "INFERRED" || memory.revision !== input.expectedRevision) throw new AIMemoryError("AI_MEMORY_REVISION_CONFLICT", "The inferred Memory proposal is not available for evidence accumulation.");
      const policy = this.requirePolicy(memory.scope, memory.subjectKey, memory.memoryPolicyId, memory.memoryPolicyRevision);
      this.requireMutationPolicy(policy);
      const source = this.validateSource(activePrincipal.principalRef, input.scope, subjectKey, input.source);
      const existing = this.memories.listProvenance(memory.id, memory.revision);
      if (existing.some((item) => item.responseId === source.responseId)) throw new AIMemoryError("AI_MEMORY_PROVENANCE_INVALID", "The Memory evidence turn is already attached.");
      if (existing.length >= AI_MEMORY_MAX_EVIDENCE_PER_REVISION) throw new AIMemoryError("AI_MEMORY_PROVENANCE_INVALID", "The Memory evidence set exceeds its bound.");
      const now = input.now ?? this.safeNow();
      return this.memories.insertProvenance({ id: this.idFactory(), ...source, memoryId: memory.id, memoryRevision: memory.revision, principalRef: activePrincipal.principalRef, scope: memory.scope, subjectKey: memory.subjectKey, sourceState: "ACTIVE", createdAt: now });
    });
  }

  activateInferred(principal: AIStudentPrincipal, input: { memoryId: string; subjectKey: string | null; scope: AIMemoryScope; expectedRevision: number; now?: number }): AIMemory {
    return this.atomic(() => {
      const activePrincipal = assertActiveStudentPrincipal(principal);
      const subjectKey = normalizeScopedSubject(input.scope, input.subjectKey);
      const current = this.requireOwnedCurrent(activePrincipal.principalRef, input.memoryId, input.scope, subjectKey);
      if (current.status !== "PROPOSED" || current.creationOrigin !== "INFERRED") throw new AIMemoryError("AI_MEMORY_LIFECYCLE_CONFLICT", "Only an inferred Memory proposal can be activated.");
      if (current.revision !== input.expectedRevision) throw new AIMemoryError("AI_MEMORY_REVISION_CONFLICT", "The inferred Memory proposal changed before activation.");
      const policy = this.requirePolicy(current.scope, current.subjectKey, current.memoryPolicyId, current.memoryPolicyRevision);
      this.requireMutationPolicy(policy);
      if (current.confidenceUnits < (policy.inferredMinConfidenceUnits ?? 900_000)) throw new AIMemoryError("AI_MEMORY_LIFECYCLE_CONFLICT", "The inferred Memory confidence is below policy.");
      const evidence = this.memories.listProvenance(current.id, current.revision).filter((item) => item.sourceState === "ACTIVE");
      const evidenceCount = new Set(evidence.map((item) => item.responseId)).size;
      if (evidenceCount < (policy.inferredMinDistinctEvidenceTurns ?? 2)) throw new AIMemoryError("AI_MEMORY_PROVENANCE_INVALID", "The inferred Memory does not have enough distinct completed evidence turns.");
      this.requireActiveQuota(activePrincipal.principalRef, current.scope, current.subjectKey, policy.hardActiveMaximum ?? 1);
      const now = input.now ?? this.safeNow();
      const nextRevision = current.revision + 1;
      const updated = this.memories.updateCurrent({ id: current.id, principalRef: activePrincipal.principalRef, expectedRevision: current.revision, revision: nextRevision, updatedAt: now, patch: { status: "ACTIVE", reviewedAt: now, safeReviewCode: "INFERRED_ACTIVATED", resolvedAt: null, deletedAt: null } });
      this.copyProvenance(evidence, updated, now);
      return updated;
    });
  }

  updateExplicitActive(principal: AIStudentPrincipal, input: { memoryId: string; scope: AIMemoryScope; subjectKey: string | null; expectedRevision: number; kind: AIMemoryKind; text: string; confidenceUnits: number; source: AIMemorySourceEvidenceInput; now?: number }): AIMemory {
    return this.atomic(() => {
      const activePrincipal = assertActiveStudentPrincipal(principal);
      const subjectKey = normalizeScopedSubject(input.scope, input.subjectKey);
      const current = this.requireOwnedCurrent(activePrincipal.principalRef, input.memoryId, input.scope, subjectKey);
      if (current.status !== "ACTIVE" || current.creationOrigin !== "EXPLICIT") throw new AIMemoryError("AI_MEMORY_LIFECYCLE_CONFLICT", "The Memory lifecycle permits updates only for an active explicit Memory.");
      if (current.revision !== input.expectedRevision) throw new AIMemoryError("AI_MEMORY_REVISION_CONFLICT", "The Memory changed before it could be updated.");
      const policy = this.requirePolicy(current.scope, current.subjectKey, current.memoryPolicyId, current.memoryPolicyRevision);
      this.requireMutationPolicy(policy);
      this.requireKind(policy, input.kind);
      const text = this.validateMemoryText(input.text, policy.perMemoryMaxBytes);
      validateConfidence(input.confidenceUnits);
      const source = this.validateSource(activePrincipal.principalRef, input.scope, subjectKey, input.source);
      const now = input.now ?? this.safeNow();
      const updated = this.memories.updateCurrent({ id: current.id, principalRef: activePrincipal.principalRef, expectedRevision: current.revision, revision: current.revision + 1, updatedAt: now, patch: { status: "ACTIVE", kind: input.kind, memoryText: text, confidenceUnits: input.confidenceUnits, reviewedAt: now, resolvedAt: null, deletedAt: null, safeReviewCode: "EXPLICIT_CREATED", contentSha256: hash(text), expiresAt: current.expiresAt } });
      this.memories.insertProvenance({ id: this.idFactory(), ...source, memoryId: updated.id, memoryRevision: updated.revision, principalRef: activePrincipal.principalRef, scope: input.scope, subjectKey, sourceState: "ACTIVE", createdAt: now });
      return updated;
    });
  }

  resolve(principal: AIStudentPrincipal, input: { memoryId: string; scope: AIMemoryScope; subjectKey: string | null; expectedRevision: number; now?: number }): AIMemory {
    return this.transitionInactive(principal, input, "RESOLVED", "MEMORY_RESOLVED");
  }

  delete(principal: AIStudentPrincipal, input: { memoryId: string; scope: AIMemoryScope; subjectKey: string | null; expectedRevision: number; now?: number }): AIMemory {
    return this.transitionInactive(principal, input, "DELETED", "MEMORY_DELETED");
  }

  expire(principal: AIStudentPrincipal, input: { memoryId: string; scope: AIMemoryScope; subjectKey: string | null; expectedRevision: number; now?: number }): AIMemory {
    return this.transitionInactive(principal, input, "EXPIRED", "MEMORY_EXPIRED");
  }

  /** Historical M10A compatibility creation; it is always non-active. */
  createCandidate(principal: AIStudentPrincipal, input: { id?: string; conversationId: string; subjectKey: string; text: string; kind?: AIMemoryKind; memoryPolicyId?: string; memoryPolicyRevision?: number; confidenceUnits: number; sourceStartOrdinal: number; sourceEndOrdinal: number; now?: number }): AIMemory {
    const source = this.findSourceForRange(principal.principalRef, input.conversationId, input.sourceStartOrdinal, input.sourceEndOrdinal);
    return this.proposeInferred(principal, { id: input.id, scope: "SUBJECT", subjectKey: normalizeSubject(input.subjectKey), kind: input.kind ?? "LEARNING_PREFERENCE", text: input.text, confidenceUnits: input.confidenceUnits, source, memoryPolicyId: input.memoryPolicyId, memoryPolicyRevision: input.memoryPolicyRevision, now: input.now });
  }

  /** Historical manual review alias; new Agent 1 tools use explicit methods. */
  approve(principal: AIStudentPrincipal, input: { memoryId: string; subjectKey: string; now?: number }): AIMemory {
    const activePrincipal = assertActiveStudentPrincipal(principal);
    const memory = this.requireOwnedCurrent(activePrincipal.principalRef, input.memoryId, "SUBJECT", normalizeSubject(input.subjectKey));
    if (memory.status !== "PROPOSED") throw new AIMemoryError("AI_MEMORY_LIFECYCLE_CONFLICT", "Only a proposed Memory can be reviewed.");
    const now = input.now ?? this.safeNow();
    return this.memories.review({ id: memory.id, principalRef: activePrincipal.principalRef, status: "ACTIVE", reviewedAt: now, safeReviewCode: "STUDENT_APPROVED" });
  }

  reject(principal: AIStudentPrincipal, input: { memoryId: string; subjectKey: string; now?: number }): AIMemory {
    const activePrincipal = assertActiveStudentPrincipal(principal);
    const memory = this.requireOwnedCurrent(activePrincipal.principalRef, input.memoryId, "SUBJECT", normalizeSubject(input.subjectKey));
    if (memory.status !== "PROPOSED") throw new AIMemoryError("AI_MEMORY_LIFECYCLE_CONFLICT", "Only a proposed Memory can be rejected.");
    const now = input.now ?? this.safeNow();
    return this.memories.review({ id: memory.id, principalRef: activePrincipal.principalRef, status: "RESOLVED", reviewedAt: now, safeReviewCode: "MEMORY_RESOLVED" });
  }

  /** Legacy automatic extraction is intentionally disabled after M10A2 cutover. */
  approveAutomatically(_input?: unknown): never {
    throw new AIMemoryError("AI_MEMORY_MUTATION_INVALID", "Legacy automatic Memory extraction is disabled after the M10A2 scope cutover.");
  }

  createMutationIntent(input: AIMemoryMutationIntentInput): AIMemoryMutationIntent {
    const principal = assertActiveStudentPrincipal(input.principal);
    validateCommandId(input.commandId);
    const subjectKey = normalizeScopedSubject(input.scope, input.subjectKey);
    if (input.origin === "INFERRED" && input.kind) assertInferenceAllowed(input.scope, input.kind);
    const createdAt = input.createdAt ?? this.safeNow();
    const text = input.memoryText === null || input.memoryText === undefined ? null : this.validateMemoryText(input.memoryText, 131_072);
    if (input.action === "NOOP" && (input.memoryId ?? null) !== null) throw new AIMemoryError("AI_MEMORY_MUTATION_INVALID", "A NOOP Memory mutation cannot target a Memory.");
    if (input.action === "CREATE" && (!input.kind || !input.origin || !text)) throw new AIMemoryError("AI_MEMORY_MUTATION_INVALID", "A Memory CREATE intent is incomplete.");
    if (["UPDATE", "RESOLVE", "DELETE"].includes(input.action) && !UUID_PATTERN.test(input.memoryId ?? "")) throw new AIMemoryError("AI_MEMORY_MUTATION_INVALID", "A Memory mutation target is invalid.");
    return this.mutations.insertIntent({ id: input.id ?? this.idFactory(), commandId: input.commandId, principalRef: principal.principalRef, responseId: normalizeUuid(input.responseId), conversationId: normalizeUuid(input.conversationId), scope: input.scope, subjectKey, action: input.action, memoryId: input.memoryId ?? null, expectedRevision: input.expectedRevision ?? null, kind: input.kind ?? null, origin: input.origin ?? null, confidenceUnits: input.confidenceUnits ?? null, memoryText: text, status: "PENDING", contentSha256: text ? hash(text) : null, createdAt, appliedAt: null });
  }

  getMutationIntent(commandId: string): AIMemoryMutationIntent | null {
    validateCommandId(commandId);
    return this.mutations.getIntent(commandId);
  }

  listProvenance(memoryId: string, memoryRevision?: number): AIMemoryProvenance[] {
    if (!UUID_PATTERN.test(memoryId)) throw new AIMemoryError("AI_MEMORY_PROVENANCE_INVALID", "The Memory identity is invalid.");
    return this.memories.listProvenance(memoryId, memoryRevision);
  }

  /** Internal future-Agent-1 commit boundary; no caller invokes it in M10A2. */
  applyMutationIntent(commandId: string, now = this.safeNow()): AIMemoryMutationRecord {
    const existingRecord = this.mutations.getRecord(commandId);
    if (existingRecord) return existingRecord;
    const intent = this.mutations.getIntent(commandId);
    if (!intent || intent.status !== "PENDING") throw new AIMemoryError("AI_MEMORY_MUTATION_INVALID", "The Memory mutation intent is unavailable.");
    try {
      return this.atomic(() => {
        const source = this.sourceFromResponse(intent.principalRef, intent.responseId, intent.conversationId);
        let memory: AIMemory | null = null;
        if (intent.action === "CREATE") {
          const principal = { principalRef: intent.principalRef, status: "ACTIVE" } as AIStudentPrincipal;
          if (intent.origin === "EXPLICIT") memory = this.createExplicitActive(principal, { scope: intent.scope, subjectKey: intent.subjectKey, kind: intent.kind!, text: intent.memoryText!, confidenceUnits: intent.confidenceUnits ?? 0, source });
          else if (intent.origin === "INFERRED") memory = this.proposeInferred(principal, { scope: intent.scope, subjectKey: intent.subjectKey, kind: intent.kind!, text: intent.memoryText!, confidenceUnits: intent.confidenceUnits ?? 0, source });
          else throw new AIMemoryError("AI_MEMORY_MUTATION_INVALID", "The Memory mutation origin is invalid.");
        } else if (intent.action === "UPDATE") {
          memory = this.updateExplicitActive({ principalRef: intent.principalRef, status: "ACTIVE" } as AIStudentPrincipal, { memoryId: intent.memoryId!, scope: intent.scope, subjectKey: intent.subjectKey, expectedRevision: intent.expectedRevision!, kind: intent.kind!, text: intent.memoryText!, confidenceUnits: intent.confidenceUnits ?? 0, source });
        } else if (intent.action === "RESOLVE") {
          memory = this.resolve({ principalRef: intent.principalRef, status: "ACTIVE" } as AIStudentPrincipal, { memoryId: intent.memoryId!, scope: intent.scope, subjectKey: intent.subjectKey, expectedRevision: intent.expectedRevision!, now });
        } else if (intent.action === "DELETE") {
          memory = this.delete({ principalRef: intent.principalRef, status: "ACTIVE" } as AIStudentPrincipal, { memoryId: intent.memoryId!, scope: intent.scope, subjectKey: intent.subjectKey, expectedRevision: intent.expectedRevision!, now });
        }
        const record = this.mutations.insertRecord({ id: this.idFactory(), commandId: intent.commandId, principalRef: intent.principalRef, responseId: intent.responseId, scope: intent.scope, subjectKey: intent.subjectKey, action: intent.action, memoryId: memory?.id ?? intent.memoryId, origin: intent.origin, expectedRevision: intent.expectedRevision, resultRevision: memory?.revision ?? null, status: "APPLIED", contentSha256: intent.contentSha256, safeErrorCode: null, createdAt: now });
        this.mutations.markIntentApplied(intent.commandId, now);
        return record;
      });
    } catch (error) {
      try { this.mutations.markIntentFailed(commandId, safeCode(error), now); } catch { /* preserve a bounded retry marker if storage is unavailable */ }
      throw error;
    }
  }

  recoverPendingMutationIntents(input: { limit: number; now?: number }): { scanned: number; applied: number; skipped: number } {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new AIMemoryError("AI_MEMORY_MUTATION_INVALID", "The pending Memory mutation limit is invalid.");
    const pending = this.mutations.listPendingIntents(input.limit);
    let applied = 0;
    let skipped = 0;
    for (const intent of pending) {
      try { this.applyMutationIntent(intent.commandId, input.now ?? this.safeNow()); applied += 1; } catch { skipped += 1; }
    }
    return { scanned: pending.length, applied, skipped };
  }

  purgeForConversationInTransaction(principalRef: string, conversationId: string, at: number): number {
    return this.memories.purgeForConversationInTransaction({ principalRef, conversationId, at });
  }

  purgePrincipalInTransaction(principalRef: string, at: number, limit?: number): number {
    const boundedLimit = limit ?? AI_MEMORY_PURGE_BATCH_SIZE;
    return this.atomic(() => {
      const purged = this.memories.purgeForPrincipalInTransaction({ principalRef, at, limit: boundedLimit });
      this.mutations.cancelPendingForPrincipal(principalRef, at, boundedLimit);
      return purged;
    });
  }

  private transitionInactive(principal: AIStudentPrincipal, input: { memoryId: string; scope: AIMemoryScope; subjectKey: string | null; expectedRevision: number; now?: number }, status: "RESOLVED" | "EXPIRED" | "DELETED", safeReviewCode: AIMemory["safeReviewCode"]): AIMemory {
    return this.atomic(() => {
      const activePrincipal = assertActiveStudentPrincipal(principal);
      const subjectKey = normalizeScopedSubject(input.scope, input.subjectKey);
      const current = this.requireOwnedCurrent(activePrincipal.principalRef, input.memoryId, input.scope, subjectKey);
      if (!(["PROPOSED", "ACTIVE"].includes(current.status)) || current.revision !== input.expectedRevision) throw new AIMemoryError("AI_MEMORY_REVISION_CONFLICT", "The Memory changed before it could be transitioned.");
      const now = input.now ?? this.safeNow();
      return this.memories.updateCurrent({ id: current.id, principalRef: activePrincipal.principalRef, expectedRevision: current.revision, revision: current.revision + 1, updatedAt: now, patch: { status, memoryText: null, resolvedAt: status === "RESOLVED" ? now : null, deletedAt: status === "DELETED" ? now : null, reviewedAt: null, safeReviewCode, contentSha256: current.contentSha256 } });
    });
  }

  private requireOwnedCurrent(principalRef: string, memoryId: string, scope: AIMemoryScope, subjectKey: string | null): AIMemory {
    const memory = this.memories.getById({ principalRef, memoryId });
    if (!memory || memory.scope !== scope || memory.subjectKey !== subjectKey) throw new AIMemoryError("AI_MEMORY_SCOPE_MISMATCH", "The Memory is not owned by the requested scope.");
    return memory;
  }

  private requirePolicy(scope: AIMemoryScope, subjectKey: string | null, id?: string, revision?: number) {
    assertScope(scope, subjectKey);
    const identity = id === undefined ? this.policies.getByScope(scope, subjectKey) : null;
    const found = id === undefined ? identity ? this.policies.getCurrentRevision(identity.id) : null : this.policies.getRevision(id, revision ?? 0);
    if (!found || (found.scope ?? "SUBJECT") !== scope || found.subjectKey !== subjectKey) throw new AIMemoryError("AI_MEMORY_POLICY_NOT_FOUND", "The scoped Memory Policy is unavailable.");
    if (!found.enabled) throw new AIMemoryError("AI_MEMORY_POLICY_DISABLED", "The scoped Memory Policy is disabled.");
    return found;
  }

  private requireMutationPolicy(policy: { mutationEnabled?: boolean }): void {
    if (policy.mutationEnabled === false) throw new AIMemoryError("AI_MEMORY_POLICY_DISABLED", "Memory mutation is disabled by Policy.");
  }

  private requireKind(policy: { allowedKinds?: AIMemoryKind[] }, kind: AIMemoryKind): void {
    if (!(policy.allowedKinds ?? []).includes(kind)) throw new AIMemoryError("AI_MEMORY_MUTATION_INVALID", "The Memory kind is not allowed by Policy.");
  }

  private requireActiveQuota(principalRef: string, scope: AIMemoryScope, subjectKey: string | null, maximum: number): void {
    if (this.memories.countByScope({ principalRef, scope, subjectKey, status: "ACTIVE" }) >= maximum) throw new AIMemoryError("AI_MEMORY_QUOTA_EXCEEDED", "The Memory active quota has been reached.");
  }

  private requireProposedQuota(principalRef: string, scope: AIMemoryScope, subjectKey: string | null, maximum: number): void {
    if (this.memories.countByScope({ principalRef, scope, subjectKey, status: "PROPOSED" }) >= maximum) throw new AIMemoryError("AI_MEMORY_QUOTA_EXCEEDED", "The Memory proposed quota has been reached.");
  }

  private validateMemoryText(value: string, maxBytes?: number): string {
    const text = normalizeAIMemoryText(value, maxBytes ?? 131_072);
    if (hasNarrowDlpPattern(text)) throw new AIMemoryError("AI_MEMORY_MUTATION_INVALID", "The Memory text matches a protected credential pattern.");
    return text;
  }

  private validateSource(principalRef: string, scope: AIMemoryScope, subjectKey: string | null, source: AIMemorySourceEvidenceInput): AIMemorySourceEvidenceInput {
    const conversation = this.conversations.getConversation(principalRef, normalizeUuid(source.conversationId), true);
    const response = this.conversations.getResponse(principalRef, normalizeUuid(source.responseId), true);
    const request = this.conversations.getMessage(source.requestMessageId);
    const assistant = this.conversations.getMessage(source.assistantMessageId);
    if (!conversation || conversation.origin !== "STUDENT" || conversation.status !== "ACTIVE" || !response || response.status !== "COMPLETED" || response.conversationId !== conversation.id || response.principalRef !== principalRef || response.requestMessageId !== source.requestMessageId || response.assistantMessageId !== source.assistantMessageId || !request || !assistant || request.role !== "USER" || assistant.role !== "ASSISTANT" || request.isPartial || assistant.isPartial || request.conversationId !== conversation.id || assistant.conversationId !== conversation.id || request.ordinal !== source.sourceStartOrdinal || assistant.ordinal !== source.sourceEndOrdinal || assistant.ordinal !== request.ordinal + 1) throw new AIMemoryError("AI_MEMORY_PROVENANCE_INVALID", "Memory evidence must be a completed non-partial Student Tutor turn.");
    if (scope === "SUBJECT" && conversation.subjectKey !== subjectKey) throw new AIMemoryError("AI_MEMORY_SCOPE_MISMATCH", "Subject Memory evidence does not match the requested subject.");
    if (!Number.isSafeInteger(source.sourceStartOrdinal) || source.sourceStartOrdinal < 1 || !Number.isSafeInteger(source.sourceEndOrdinal) || source.sourceEndOrdinal !== source.sourceStartOrdinal + 1) throw new AIMemoryError("AI_MEMORY_PROVENANCE_INVALID", "Memory evidence range is invalid.");
    return { conversationId: conversation.id, responseId: response.id, requestMessageId: request.id, assistantMessageId: assistant.id, sourceStartOrdinal: request.ordinal, sourceEndOrdinal: assistant.ordinal };
  }

  private sourceFromResponse(principalRef: string, responseId: string, conversationId: string): AIMemorySourceEvidenceInput {
    const response = this.conversations.getResponse(principalRef, normalizeUuid(responseId), true);
    if (!response || response.conversationId !== conversationId || !response.requestMessageId || !response.assistantMessageId) throw new AIMemoryError("AI_MEMORY_PROVENANCE_INVALID", "The mutation source response is unavailable.");
    const request = this.conversations.getMessage(response.requestMessageId);
    const assistant = this.conversations.getMessage(response.assistantMessageId);
    if (!request || !assistant) throw new AIMemoryError("AI_MEMORY_PROVENANCE_INVALID", "The mutation source messages are unavailable.");
    return this.validateSource(principalRef, "GLOBAL", null, { conversationId, responseId, requestMessageId: request.id, assistantMessageId: assistant.id, sourceStartOrdinal: request.ordinal, sourceEndOrdinal: assistant.ordinal });
  }

  private findSourceForRange(principalRef: string, conversationId: string, start: number, end: number): AIMemorySourceEvidenceInput {
    const rows = this.conversations.listResponsesForConversation(conversationId, principalRef);
    const response = rows.find((candidate) => candidate.requestMessageId && candidate.assistantMessageId && candidate.requestMessageId && this.conversations.getMessage(candidate.requestMessageId)?.ordinal === start && this.conversations.getMessage(candidate.assistantMessageId)?.ordinal === end);
    if (!response?.requestMessageId || !response.assistantMessageId) throw new AIMemoryError("AI_MEMORY_SOURCE_INVALID", "The Memory source turn could not be resolved.");
    return { conversationId, responseId: response.id, requestMessageId: response.requestMessageId, assistantMessageId: response.assistantMessageId, sourceStartOrdinal: start, sourceEndOrdinal: end };
  }

  private copyProvenance(rows: AIMemoryProvenance[], memory: AIMemory, createdAt: number): void {
    for (const row of rows) this.memories.insertProvenance({ id: this.idFactory(), memoryId: memory.id, memoryRevision: memory.revision, principalRef: memory.principalRef, scope: memory.scope, subjectKey: memory.subjectKey, conversationId: row.conversationId, responseId: row.responseId, requestMessageId: row.requestMessageId, assistantMessageId: row.assistantMessageId, sourceStartOrdinal: row.sourceStartOrdinal, sourceEndOrdinal: row.sourceEndOrdinal, sourceState: row.sourceState, createdAt });
  }

  private newMemory(input: AIMemory): AIMemory { return input; }

  private expiry(now: number, retentionDays: number): number {
    const value = now + retentionDays * 86_400_000;
    if (!Number.isSafeInteger(value) || value <= now || value > MAX_TIMESTAMP) throw new AIMemoryError("AI_MEMORY_INVALID", "The Memory expiry timestamp is invalid.");
    return value;
  }

  private atomic<T>(operation: () => T): T {
    return this.database.client.inTransaction ? operation() : this.database.client.transaction(operation).immediate();
  }

  private safeNow(): number {
    const value = this.clock();
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMESTAMP) throw new AIMemoryError("AI_MEMORY_INVALID", "Memory time is invalid.");
    return value;
  }
}

function assertScope(scope: AIMemoryScope, subjectKey: string | null): void {
  normalizeScopedSubject(scope, subjectKey);
}

function normalizeScopedSubject(scope: AIMemoryScope, subjectKey: string | null): string | null {
  if (scope === "GLOBAL") {
    if (subjectKey !== null) throw new AIMemoryError("AI_MEMORY_SCOPE_MISMATCH", "The Memory scope and subject are inconsistent.");
    return null;
  }
  if (subjectKey === null || normalizeSubject(subjectKey) !== subjectKey) throw new AIMemoryError("AI_MEMORY_SCOPE_MISMATCH", "The Memory scope and subject are inconsistent.");
  return subjectKey;
}

function assertInferenceAllowed(scope: AIMemoryScope, kind: AIMemoryKind): void {
  if (scope === "GLOBAL" && (kind === "PREFERRED_NAME" || kind === "FORM_OF_ADDRESS")) throw new AIMemoryError("AI_MEMORY_MUTATION_INVALID", "This Global Memory kind requires explicit Student input.");
}

function normalizeSubject(value: string): string {
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  if (!SUBJECT_KEY_PATTERN.test(normalized)) throw new AIMemoryError("AI_MEMORY_SCOPE_MISMATCH", "The Memory subject is invalid.");
  return normalized;
}

function normalizeUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new AIMemoryError("AI_MEMORY_MUTATION_INVALID", "The Memory reference is invalid.");
  return value;
}

function validateConfidence(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > AI_MEMORY_CONFIDENCE_SCALE) throw new AIMemoryError("AI_MEMORY_MUTATION_INVALID", "Memory confidence is invalid.");
}

function validateCommandId(value: string): void {
  if (!COMMAND_PATTERN.test(value)) throw new AIMemoryError("AI_MEMORY_MUTATION_INVALID", "The Memory command identity is invalid.");
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hasNarrowDlpPattern(value: string): boolean {
  return /\b(?:password|passwd|api[-_ ]?key|access[-_ ]?token|secret[-_ ]?key)\b/iu.test(value)
    || /(?:كلمة المرور|كلمة السر|رمز الدخول|مفتاح\s*API|بطاقتي الائتمانية|حسابي البنكي)/u.test(value)
    || (/(?:credit\s*card|bank\s*account|رقم بطاقتي|رقم حسابي)/iu.test(value) && /\d/.test(value));
}

function safeCode(error: unknown): string {
  if (error instanceof AIMemoryError) return error.code;
  return "AI_MEMORY_MUTATION_INVALID";
}
