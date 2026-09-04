import { and, asc, eq } from "drizzle-orm";
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
} from "./contracts";
import { AIMemoryError } from "./contracts";
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
      currentRevision: row.currentRevision,
      currentRevisionId: revision.revisionId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
    };
  }

  getBySubjectKey(subjectKey: string): AIMemoryPolicy | null {
    const row = this.database.db.select({ id: aiMemoryPolicies.id }).from(aiMemoryPolicies)
      .where(eq(aiMemoryPolicies.subjectKey, subjectKey)).get();
    return row ? this.getById(row.id) : null;
  }

  getCurrentRevision(id: string): AIMemoryPolicyRevision | null {
    const row = this.database.db.select({ currentRevision: aiMemoryPolicies.currentRevision })
      .from(aiMemoryPolicies).where(eq(aiMemoryPolicies.id, id)).get();
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
    this.assertSubject(content.subjectKey);
    try {
      return this.atomic(() => {
        this.database.db.insert(aiMemoryPolicies).values({
          id: input.id,
          key: content.key,
          subjectKey: content.subjectKey,
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
    const current = this.database.db.select({ currentRevision: aiMemoryPolicies.currentRevision, key: aiMemoryPolicies.key, subjectKey: aiMemoryPolicies.subjectKey })
      .from(aiMemoryPolicies).where(eq(aiMemoryPolicies.id, input.id)).get();
    if (!current) throw new AIMemoryError("AI_MEMORY_POLICY_NOT_FOUND", "The Memory Policy was not found.");
    if (current.currentRevision !== input.expectedRevision) throw new AIMemoryError("AI_MEMORY_LIFECYCLE_CONFLICT", "The Memory Policy changed before publication.");
    const content = normalizeAIMemoryPolicyContent(input.content);
    if (content.key !== current.key || content.subjectKey !== current.subjectKey) throw new AIMemoryError("AI_MEMORY_SCOPE_MISMATCH", "Memory Policy key and subject are immutable after creation.");
    this.assertTimestamp(input.now);
    try {
      return this.atomic(() => {
        const nextRevision = input.expectedRevision + 1;
        this.insertRevision(input.id, nextRevision, content, input.actor, input.now);
        const updated = this.database.db.update(aiMemoryPolicies).set({
          currentRevision: nextRevision,
          updatedAt: input.now,
          updatedBy: input.actor.actorUserId,
        }).where(and(
          eq(aiMemoryPolicies.id, input.id),
          eq(aiMemoryPolicies.currentRevision, input.expectedRevision),
        )).returning({ currentRevision: aiMemoryPolicies.currentRevision }).get();
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
    this.database.db.insert(aiMemoryPolicyRevisions).values({
      id: uuidv7(),
      memoryPolicyId: id,
      revision,
      displayName: content.displayName,
      enabled: content.enabled,
      candidateReviewRequired: content.candidateReviewRequired,
      retentionDays: content.retentionDays,
      maxSelectedMemories: content.maxSelectedMemories,
      createdAt: now,
      createdBy: actor.actorUserId,
    }).run();
  }

  private revisionFromRow(row: AIMemoryPolicyRevisionRow): AIMemoryPolicyRevision {
    const policy = this.database.db.select({ key: aiMemoryPolicies.key, subjectKey: aiMemoryPolicies.subjectKey })
      .from(aiMemoryPolicies).where(eq(aiMemoryPolicies.id, row.memoryPolicyId)).get();
    if (!policy) throw new AIMemoryError("AI_MEMORY_POLICY_NOT_FOUND", "The Memory Policy identity is missing.");
    return {
      memoryPolicyId: row.memoryPolicyId,
      revisionId: row.id,
      revision: row.revision,
      key: policy.key,
      subjectKey: policy.subjectKey,
      displayName: row.displayName,
      enabled: row.enabled,
      candidateReviewRequired: row.candidateReviewRequired,
      retentionDays: row.retentionDays,
      maxSelectedMemories: row.maxSelectedMemories,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
    };
  }

  private assertSubject(subjectKey: string): void {
    const exists = this.database.db.select({ subjectKey: canonicalMaterials.subjectKey }).from(canonicalMaterials)
      .where(eq(canonicalMaterials.subjectKey, subjectKey)).get();
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
