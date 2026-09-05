import { and, asc, eq, isNull } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../../admin-auth/contracts";
import type { ContentDatabase } from "../../content/database";
import {
  aiMemoryPolicies,
  aiMemoryPolicyRevisions,
  canonicalMaterials,
  type AIMemoryPolicyRevisionRow,
} from "../../content/schema";
import type {
  AIMemoryPolicy,
  AIMemoryPolicyContent,
  AIMemoryPolicyRepository,
  AIMemoryPolicyRevision,
  AIMemoryScope,
} from "./contracts";
import { AIMemoryError, AI_MEMORY_KINDS } from "./contracts";
import { normalizeAIMemoryPolicyContent } from "./policy-validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_TIMESTAMP = 8_640_000_000_000_000;

export class SQLiteAIMemoryPolicyRepository implements AIMemoryPolicyRepository {
  constructor(private readonly database: ContentDatabase) {}

  getById(id: string): AIMemoryPolicy | null {
    const row = this.database.db.select().from(aiMemoryPolicies).where(eq(aiMemoryPolicies.id, id)).get();
    if (!row) return null;
    const revision = this.getRevision(id, row.currentRevision);
    if (!revision) throw new AIMemoryError("AI_MEMORY_POLICY_NOT_FOUND", "The current Memory Policy revision is missing.");
    return {
      ...revision,
      id: row.id,
      m10a2MutationAuthority: row.m10a2MutationAuthority,
      currentRevision: row.currentRevision,
      currentRevisionId: revision.revisionId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
    };
  }

  getByScope(scope: AIMemoryScope, subjectKey: string | null): AIMemoryPolicy | null {
    const row = this.database.db.select({ id: aiMemoryPolicies.id }).from(aiMemoryPolicies).where(and(
      eq(aiMemoryPolicies.scope, scope),
      subjectKey === null ? isNull(aiMemoryPolicies.subjectKey) : eq(aiMemoryPolicies.subjectKey, subjectKey),
    )).get();
    return row ? this.getById(row.id) : null;
  }

  getBySubjectKey(subjectKey: string): AIMemoryPolicy | null {
    return this.getByScope("SUBJECT", subjectKey);
  }

  getCurrentRevision(id: string): AIMemoryPolicyRevision | null {
    const row = this.database.db.select({ currentRevision: aiMemoryPolicies.currentRevision }).from(aiMemoryPolicies).where(eq(aiMemoryPolicies.id, id)).get();
    return row ? this.getRevision(id, row.currentRevision) : null;
  }

  getRevision(id: string, revision: number): AIMemoryPolicyRevision | null {
    const row = this.database.db.select().from(aiMemoryPolicyRevisions).where(and(
      eq(aiMemoryPolicyRevisions.memoryPolicyId, id),
      eq(aiMemoryPolicyRevisions.revision, revision),
    )).get();
    return row ? this.revisionFromRow(row) : null;
  }

  list(): AIMemoryPolicy[] {
    return this.database.db.select().from(aiMemoryPolicies).orderBy(asc(aiMemoryPolicies.key)).all()
      .map((row) => this.getById(row.id))
      .filter((policy): policy is AIMemoryPolicy => policy !== null);
  }

  create(input: { id: string; content: AIMemoryPolicyContent; actor: AdminActor; now: number }): AIMemoryPolicyRevision {
    const content = normalizeAIMemoryPolicyContent(input.content);
    this.assertUuid(input.id, "Memory Policy identity");
    this.assertTimestamp(input.now);
    this.assertSubject(content.scope ?? "SUBJECT", content.subjectKey);
    try {
      return this.atomic(() => {
        this.database.db.insert(aiMemoryPolicies).values({
          id: input.id,
          key: content.key,
          scope: content.scope ?? "SUBJECT",
          subjectKey: content.subjectKey,
          m10a2MutationAuthority: true,
          currentRevision: 1,
          createdAt: input.now,
          updatedAt: input.now,
          createdBy: input.actor.actorUserId,
          updatedBy: input.actor.actorUserId,
        }).run();
        this.insertRevision(input.id, 1, content, input.actor, input.now);
        const revision = this.getRevision(input.id, 1);
        if (!revision) throw new AIMemoryError("AI_MEMORY_INVALID", "The Memory Policy revision could not be read after creation.");
        return revision;
      });
    } catch (error) {
      if (error instanceof AIMemoryError) throw error;
      throw new AIMemoryError("AI_MEMORY_LIFECYCLE_CONFLICT", "The Memory Policy could not be created safely.", {}, error);
    }
  }

  appendRevision(input: { id: string; expectedRevision: number; content: AIMemoryPolicyContent; actor: AdminActor; now: number }): AIMemoryPolicyRevision {
    const current = this.database.db.select({ currentRevision: aiMemoryPolicies.currentRevision, key: aiMemoryPolicies.key, scope: aiMemoryPolicies.scope, subjectKey: aiMemoryPolicies.subjectKey })
      .from(aiMemoryPolicies).where(eq(aiMemoryPolicies.id, input.id)).get();
    if (!current) throw new AIMemoryError("AI_MEMORY_POLICY_NOT_FOUND", "The Memory Policy was not found.");
    if (current.currentRevision !== input.expectedRevision) throw new AIMemoryError("AI_MEMORY_LIFECYCLE_CONFLICT", "The Memory Policy changed before publication.");
    const content = normalizeAIMemoryPolicyContent(input.content);
    if (content.key !== current.key || (content.scope ?? "SUBJECT") !== current.scope || content.subjectKey !== current.subjectKey) throw new AIMemoryError("AI_MEMORY_SCOPE_MISMATCH", "Memory Policy identity and scope are immutable after creation.");
    this.assertSubject(current.scope, current.subjectKey);
    this.assertTimestamp(input.now);
    try {
      return this.atomic(() => {
        const nextRevision = input.expectedRevision + 1;
        this.insertRevision(input.id, nextRevision, content, input.actor, input.now);
        const updated = this.database.db.update(aiMemoryPolicies).set({
          currentRevision: nextRevision,
          updatedAt: input.now,
          updatedBy: input.actor.actorUserId,
        }).where(and(eq(aiMemoryPolicies.id, input.id), eq(aiMemoryPolicies.currentRevision, input.expectedRevision))).returning({ currentRevision: aiMemoryPolicies.currentRevision }).get();
        if (!updated) throw new AIMemoryError("AI_MEMORY_LIFECYCLE_CONFLICT", "The Memory Policy changed before publication.");
        const revision = this.getRevision(input.id, nextRevision);
        if (!revision) throw new AIMemoryError("AI_MEMORY_INVALID", "The Memory Policy revision could not be read after publication.");
        return revision;
      });
    } catch (error) {
      if (error instanceof AIMemoryError) throw error;
      throw new AIMemoryError("AI_MEMORY_LIFECYCLE_CONFLICT", "The Memory Policy revision could not be appended safely.", {}, error);
    }
  }

  private insertRevision(id: string, revision: number, content: AIMemoryPolicyContent, actor: AdminActor, now: number): void {
    const resolved = normalizeAIMemoryPolicyContent(content);
    this.database.db.insert(aiMemoryPolicyRevisions).values({
      id: uuidv7(),
      memoryPolicyId: id,
      revision,
      displayName: resolved.displayName,
      enabled: resolved.enabled,
      candidateReviewRequired: resolved.candidateReviewRequired ?? true,
      allowedKinds: JSON.stringify(resolved.allowedKinds ?? [...AI_MEMORY_KINDS]),
      targetActiveCount: resolved.targetActiveCount ?? 0,
      hardActiveMaximum: resolved.hardActiveMaximum ?? 1,
      maxSelectedPerRequest: resolved.maxSelectedPerRequest ?? 0,
      proposedHardMaximum: resolved.proposedHardMaximum ?? 0,
      perMemoryMaxBytes: resolved.perMemoryMaxBytes ?? 1,
      retentionDays: resolved.retentionDays,
      maxSelectedMemories: resolved.maxSelectedMemories ?? resolved.maxSelectedPerRequest ?? 1,
      mutationEnabled: resolved.mutationEnabled ?? true,
      explicitMinConfidenceUnits: resolved.explicitMinConfidenceUnits ?? 0,
      inferredMinConfidenceUnits: resolved.inferredMinConfidenceUnits ?? 900_000,
      inferredMinDistinctEvidenceTurns: resolved.inferredMinDistinctEvidenceTurns ?? 2,
      createdAt: now,
      createdBy: actor.actorUserId,
    }).run();
  }

  private revisionFromRow(row: AIMemoryPolicyRevisionRow): AIMemoryPolicyRevision {
    const policy = this.database.db.select({ key: aiMemoryPolicies.key, scope: aiMemoryPolicies.scope, subjectKey: aiMemoryPolicies.subjectKey })
      .from(aiMemoryPolicies).where(eq(aiMemoryPolicies.id, row.memoryPolicyId)).get();
    if (!policy) throw new AIMemoryError("AI_MEMORY_POLICY_NOT_FOUND", "The Memory Policy identity is missing.");
    let allowedKinds: string[];
    try { allowedKinds = JSON.parse(row.allowedKinds) as string[]; } catch { throw new AIMemoryError("AI_MEMORY_POLICY_SCOPE_INVALID", "The Memory Policy allowed kind set is invalid."); }
    if (!Array.isArray(allowedKinds) || allowedKinds.some((kind) => !AI_MEMORY_KINDS.includes(kind as (typeof AI_MEMORY_KINDS)[number]))) throw new AIMemoryError("AI_MEMORY_POLICY_SCOPE_INVALID", "The Memory Policy allowed kind set is invalid.");
    return {
      memoryPolicyId: row.memoryPolicyId,
      revisionId: row.id,
      revision: row.revision,
      key: policy.key,
      scope: policy.scope,
      subjectKey: policy.subjectKey,
      displayName: row.displayName,
      enabled: row.enabled,
      allowedKinds: allowedKinds as AIMemoryPolicyRevision["allowedKinds"],
      targetActiveCount: row.targetActiveCount,
      hardActiveMaximum: row.hardActiveMaximum,
      maxSelectedPerRequest: row.maxSelectedPerRequest,
      proposedHardMaximum: row.proposedHardMaximum,
      perMemoryMaxBytes: row.perMemoryMaxBytes,
      retentionDays: row.retentionDays,
      mutationEnabled: row.mutationEnabled,
      explicitMinConfidenceUnits: row.explicitMinConfidenceUnits,
      inferredMinConfidenceUnits: row.inferredMinConfidenceUnits,
      inferredMinDistinctEvidenceTurns: row.inferredMinDistinctEvidenceTurns,
      candidateReviewRequired: row.candidateReviewRequired,
      maxSelectedMemories: row.maxSelectedMemories,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
    };
  }

  private assertSubject(scope: AIMemoryScope, subjectKey: string | null): void {
    if (scope === "GLOBAL") {
      if (subjectKey !== null) throw new AIMemoryError("AI_MEMORY_POLICY_SCOPE_INVALID", "A GLOBAL Memory Policy cannot have a subject.");
      return;
    }
    if (subjectKey === null) throw new AIMemoryError("AI_MEMORY_POLICY_SCOPE_INVALID", "A SUBJECT Memory Policy requires a subject.");
    const exists = this.database.db.select({ subjectKey: canonicalMaterials.subjectKey }).from(canonicalMaterials).where(eq(canonicalMaterials.subjectKey, subjectKey)).get();
    if (!exists) throw new AIMemoryError("AI_MEMORY_SCOPE_MISMATCH", "The Memory Policy subject is not canonical.");
  }

  private atomic<T>(operation: () => T): T {
    return this.database.client.inTransaction ? operation() : this.database.client.transaction(operation).immediate();
  }

  private assertUuid(value: string, label: string): void {
    if (!UUID_PATTERN.test(value)) throw new AIMemoryError("AI_MEMORY_INVALID", `${label} is invalid.`);
  }

  private assertTimestamp(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMESTAMP) throw new AIMemoryError("AI_MEMORY_INVALID", "Memory Policy timestamp is invalid.");
  }
}
