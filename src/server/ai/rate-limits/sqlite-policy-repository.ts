import { and, asc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../../admin-auth/contracts";
import type { ContentDatabase } from "../../content/database";
import {
  aiRateLimitPolicies,
  aiRateLimitPolicyRevisions,
  type AIRateLimitPolicyRevisionRow,
} from "../../content/schema";
import type {
  AIRateLimitPolicy,
  AIRateLimitPolicyContent,
  AIRateLimitPolicyRepository,
  AIRateLimitPolicyRevision,
} from "./contracts";
import { AIRateLimitPolicyError } from "./errors";
import { normalizeAIRateLimitPolicyContent } from "./validation";

export class SQLiteAIRateLimitPolicyRepository implements AIRateLimitPolicyRepository {
  constructor(private readonly database: ContentDatabase) {}

  getById(id: string): AIRateLimitPolicy | null {
    const row = this.database.db.select().from(aiRateLimitPolicies).where(eq(aiRateLimitPolicies.id, id)).get();
    if (!row) return null;
    const revision = this.getRevision(id, row.currentRevision);
    if (!revision) throw new AIRateLimitPolicyError("AI_RATE_LIMIT_POLICY_INVALID", "The current Rate Limit Policy revision is missing.");
    return {
      ...revision,
      id: row.id,
      currentRevision: row.currentRevision,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
    };
  }

  getCurrentRevision(id: string): AIRateLimitPolicyRevision | null {
    const row = this.database.db
      .select({ currentRevision: aiRateLimitPolicies.currentRevision })
      .from(aiRateLimitPolicies)
      .where(eq(aiRateLimitPolicies.id, id))
      .get();
    return row ? this.getRevision(id, row.currentRevision) : null;
  }

  getRevision(id: string, revision: number): AIRateLimitPolicyRevision | null {
    const row = this.database.db
      .select()
      .from(aiRateLimitPolicyRevisions)
      .where(and(eq(aiRateLimitPolicyRevisions.rateLimitPolicyId, id), eq(aiRateLimitPolicyRevisions.revision, revision)))
      .get();
    return row ? this.revisionFromRow(row) : null;
  }

  list(): AIRateLimitPolicy[] {
    return this.database.db
      .select()
      .from(aiRateLimitPolicies)
      .orderBy(asc(aiRateLimitPolicies.key))
      .all()
      .map((row) => {
        const revision = this.getRevision(row.id, row.currentRevision);
        if (!revision) throw new AIRateLimitPolicyError("AI_RATE_LIMIT_POLICY_INVALID", "A Rate Limit Policy revision is missing.");
        return {
          ...revision,
          id: row.id,
          currentRevision: row.currentRevision,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          createdBy: row.createdBy,
          updatedBy: row.updatedBy,
        };
      });
  }

  listRevisions(): AIRateLimitPolicyRevision[] {
    return this.database.db
      .select()
      .from(aiRateLimitPolicyRevisions)
      .orderBy(asc(aiRateLimitPolicyRevisions.rateLimitPolicyId), asc(aiRateLimitPolicyRevisions.revision))
      .all()
      .map((row) => this.revisionFromRow(row));
  }

  create(input: {
    id: string;
    content: AIRateLimitPolicyContent;
    actor: AdminActor;
    now: number;
  }): AIRateLimitPolicyRevision {
    const content = normalizeAIRateLimitPolicyContent(input.content);
    try {
      this.database.db.insert(aiRateLimitPolicies).values({
        id: input.id,
        key: content.key,
        currentRevision: 1,
        createdAt: input.now,
        updatedAt: input.now,
        createdBy: input.actor.actorUserId,
        updatedBy: input.actor.actorUserId,
      }).run();
      this.insertRevisionRows(input.id, 1, content, input.actor, input.now);
      const revision = this.getRevision(input.id, 1);
      if (!revision) throw new AIRateLimitPolicyError("AI_RATE_LIMIT_POLICY_INVALID", "The new Rate Limit Policy revision could not be read.");
      return revision;
    } catch (error) {
      if (error instanceof AIRateLimitPolicyError) throw error;
      throw new AIRateLimitPolicyError("AI_RATE_LIMIT_POLICY_CONFLICT", "The Rate Limit Policy could not be created.", error);
    }
  }

  appendRevision(input: {
    id: string;
    expectedRevision: number;
    content: AIRateLimitPolicyContent;
    actor: AdminActor;
    now: number;
  }): AIRateLimitPolicyRevision {
    const current = this.database.db
      .select({ currentRevision: aiRateLimitPolicies.currentRevision })
      .from(aiRateLimitPolicies)
      .where(eq(aiRateLimitPolicies.id, input.id))
      .get();
    if (!current) throw new AIRateLimitPolicyError("AI_RATE_LIMIT_POLICY_NOT_FOUND", "The Rate Limit Policy was not found.");
    if (current.currentRevision !== input.expectedRevision) {
      throw new AIRateLimitPolicyError("AI_RATE_LIMIT_POLICY_CONFLICT", "The Rate Limit Policy changed before publication.");
    }
    const content = normalizeAIRateLimitPolicyContent(input.content);
    const nextRevision = input.expectedRevision + 1;
    try {
      this.insertRevisionRows(input.id, nextRevision, content, input.actor, input.now);
      const updated = this.database.db
        .update(aiRateLimitPolicies)
        .set({
          currentRevision: nextRevision,
          updatedAt: input.now,
          updatedBy: input.actor.actorUserId,
        })
        .where(and(eq(aiRateLimitPolicies.id, input.id), eq(aiRateLimitPolicies.currentRevision, input.expectedRevision)))
        .returning({ currentRevision: aiRateLimitPolicies.currentRevision })
        .get();
      if (!updated) throw new AIRateLimitPolicyError("AI_RATE_LIMIT_POLICY_CONFLICT", "The Rate Limit Policy changed before publication.");
      const revision = this.getRevision(input.id, nextRevision);
      if (!revision) throw new AIRateLimitPolicyError("AI_RATE_LIMIT_POLICY_INVALID", "The new Rate Limit Policy revision could not be read.");
      return revision;
    } catch (error) {
      if (error instanceof AIRateLimitPolicyError) throw error;
      throw new AIRateLimitPolicyError("AI_RATE_LIMIT_POLICY_CONFLICT", "The Rate Limit Policy revision could not be appended.", error);
    }
  }

  private insertRevisionRows(
    policyId: string,
    revision: number,
    content: AIRateLimitPolicyContent,
    actor: AdminActor,
    now: number,
  ): void {
    this.database.db.insert(aiRateLimitPolicyRevisions).values({
      id: uuidv7(),
      rateLimitPolicyId: policyId,
      revision,
      displayName: content.displayName,
      windowMs: content.windowMs,
      maxRequests: content.maxRequests,
      maxConcurrentRequests: content.maxConcurrentRequests,
      enabled: content.enabled,
      createdAt: now,
      createdBy: actor.actorUserId,
    }).run();
  }

  private revisionFromRow(row: AIRateLimitPolicyRevisionRow): AIRateLimitPolicyRevision {
    const policy = this.database.db
      .select({ key: aiRateLimitPolicies.key })
      .from(aiRateLimitPolicies)
      .where(eq(aiRateLimitPolicies.id, row.rateLimitPolicyId))
      .get();
    if (!policy) throw new AIRateLimitPolicyError("AI_RATE_LIMIT_POLICY_INVALID", "The Rate Limit Policy identity is missing.");
    return {
      key: policy.key,
      displayName: row.displayName,
      windowMs: row.windowMs,
      maxRequests: row.maxRequests,
      maxConcurrentRequests: row.maxConcurrentRequests,
      enabled: row.enabled,
      rateLimitPolicyId: row.rateLimitPolicyId,
      revision: row.revision,
      revisionId: row.id,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
    };
  }
}
