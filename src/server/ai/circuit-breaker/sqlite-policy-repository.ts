import { and, asc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../../admin-auth/contracts";
import type { ContentDatabase } from "../../content/database";
import {
  aiCircuitBreakerPolicies,
  aiCircuitBreakerPolicyRevisions,
  type AICircuitBreakerPolicyRevisionRow,
} from "../../content/schema";
import type {
  AICircuitBreakerPolicy,
  AICircuitBreakerPolicyContent,
  AICircuitBreakerPolicyRepository,
  AICircuitBreakerPolicyRevision,
  SafeAICircuitBreakerPolicyDTO,
} from "./contracts";
import { AICircuitBreakerError } from "./errors";
import { normalizeAICircuitBreakerPolicyContent } from "./validation";

export class SQLiteAICircuitBreakerPolicyRepository implements AICircuitBreakerPolicyRepository {
  constructor(private readonly database: ContentDatabase) {}

  getById(id: string): AICircuitBreakerPolicy | null {
    const row = this.database.db.select().from(aiCircuitBreakerPolicies).where(eq(aiCircuitBreakerPolicies.id, id)).get();
    if (!row) return null;
    const revision = this.getRevision(id, row.currentRevision);
    if (!revision) throw new AICircuitBreakerError("AI_CIRCUIT_POLICY_INVALID", "The current Circuit Breaker Policy revision is missing.");
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

  getCurrentRevision(id: string): AICircuitBreakerPolicyRevision | null {
    const row = this.database.db.select({ currentRevision: aiCircuitBreakerPolicies.currentRevision })
      .from(aiCircuitBreakerPolicies)
      .where(eq(aiCircuitBreakerPolicies.id, id))
      .get();
    return row ? this.getRevision(id, row.currentRevision) : null;
  }

  getRevision(id: string, revision: number): AICircuitBreakerPolicyRevision | null {
    const row = this.database.db.select().from(aiCircuitBreakerPolicyRevisions).where(and(
      eq(aiCircuitBreakerPolicyRevisions.circuitPolicyId, id),
      eq(aiCircuitBreakerPolicyRevisions.revision, revision),
    )).get();
    return row ? this.revisionFromRow(row) : null;
  }

  list(): AICircuitBreakerPolicy[] {
    return this.database.db.select().from(aiCircuitBreakerPolicies)
      .orderBy(asc(aiCircuitBreakerPolicies.key)).all().map((row) => {
        const revision = this.getRevision(row.id, row.currentRevision);
        if (!revision) throw new AICircuitBreakerError("AI_CIRCUIT_POLICY_INVALID", "A Circuit Breaker Policy revision is missing.");
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

  listRevisions(): AICircuitBreakerPolicyRevision[] {
    return this.database.db.select().from(aiCircuitBreakerPolicyRevisions)
      .orderBy(asc(aiCircuitBreakerPolicyRevisions.circuitPolicyId), asc(aiCircuitBreakerPolicyRevisions.revision))
      .all().map((row) => this.revisionFromRow(row));
  }

  create(input: {
    id: string;
    content: AICircuitBreakerPolicyContent;
    actor: AdminActor;
    now: number;
  }): AICircuitBreakerPolicyRevision {
    const content = normalizeAICircuitBreakerPolicyContent(input.content);
    try {
      this.database.db.insert(aiCircuitBreakerPolicies).values({
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
      if (!revision) throw new AICircuitBreakerError("AI_CIRCUIT_POLICY_INVALID", "The new Circuit Breaker Policy revision could not be read.");
      return revision;
    } catch (error) {
      if (error instanceof AICircuitBreakerError) throw error;
      throw new AICircuitBreakerError("AI_CIRCUIT_POLICY_CONFLICT", "The Circuit Breaker Policy could not be created.", error);
    }
  }

  appendRevision(input: {
    id: string;
    expectedRevision: number;
    content: AICircuitBreakerPolicyContent;
    actor: AdminActor;
    now: number;
  }): AICircuitBreakerPolicyRevision {
    const current = this.database.db.select({ currentRevision: aiCircuitBreakerPolicies.currentRevision })
      .from(aiCircuitBreakerPolicies)
      .where(eq(aiCircuitBreakerPolicies.id, input.id)).get();
    if (!current) throw new AICircuitBreakerError("AI_CIRCUIT_POLICY_NOT_FOUND", "The Circuit Breaker Policy was not found.");
    if (current.currentRevision !== input.expectedRevision) throw new AICircuitBreakerError("AI_CIRCUIT_POLICY_CONFLICT", "The Circuit Breaker Policy changed before publication.");
    const content = normalizeAICircuitBreakerPolicyContent(input.content);
    const nextRevision = input.expectedRevision + 1;
    try {
      this.insertRevisionRows(input.id, nextRevision, content, input.actor, input.now);
      const updated = this.database.db.update(aiCircuitBreakerPolicies).set({
        currentRevision: nextRevision,
        updatedAt: input.now,
        updatedBy: input.actor.actorUserId,
      }).where(and(
        eq(aiCircuitBreakerPolicies.id, input.id),
        eq(aiCircuitBreakerPolicies.currentRevision, input.expectedRevision),
      )).returning({ currentRevision: aiCircuitBreakerPolicies.currentRevision }).get();
      if (!updated) throw new AICircuitBreakerError("AI_CIRCUIT_POLICY_CONFLICT", "The Circuit Breaker Policy changed before publication.");
      const revision = this.getRevision(input.id, nextRevision);
      if (!revision) throw new AICircuitBreakerError("AI_CIRCUIT_POLICY_INVALID", "The new Circuit Breaker Policy revision could not be read.");
      return revision;
    } catch (error) {
      if (error instanceof AICircuitBreakerError) throw error;
      throw new AICircuitBreakerError("AI_CIRCUIT_POLICY_CONFLICT", "The Circuit Breaker Policy revision could not be appended.", error);
    }
  }

  private insertRevisionRows(
    policyId: string,
    revision: number,
    content: AICircuitBreakerPolicyContent,
    actor: AdminActor,
    now: number,
  ): void {
    this.database.db.insert(aiCircuitBreakerPolicyRevisions).values({
      id: uuidv7(),
      circuitPolicyId: policyId,
      revision,
      displayName: content.displayName,
      failureThreshold: content.failureThreshold,
      openDurationMs: content.openDurationMs,
      halfOpenProbeLeaseMs: content.halfOpenProbeLeaseMs,
      enabled: content.enabled,
      createdAt: now,
      createdBy: actor.actorUserId,
    }).run();
  }

  private revisionFromRow(row: AICircuitBreakerPolicyRevisionRow): AICircuitBreakerPolicyRevision {
    const policy = this.database.db.select({ key: aiCircuitBreakerPolicies.key })
      .from(aiCircuitBreakerPolicies)
      .where(eq(aiCircuitBreakerPolicies.id, row.circuitPolicyId)).get();
    if (!policy) throw new AICircuitBreakerError("AI_CIRCUIT_POLICY_INVALID", "The Circuit Breaker Policy identity is missing.");
    return {
      key: policy.key,
      displayName: row.displayName,
      failureThreshold: row.failureThreshold,
      openDurationMs: row.openDurationMs,
      halfOpenProbeLeaseMs: row.halfOpenProbeLeaseMs,
      enabled: row.enabled,
      circuitPolicyId: row.circuitPolicyId,
      revision: row.revision,
      revisionId: row.id,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
    };
  }
}

export function toSafeAICircuitBreakerPolicyDTO(
  policy: AICircuitBreakerPolicy,
): SafeAICircuitBreakerPolicyDTO {
  return {
    id: policy.id,
    key: policy.key,
    displayName: policy.displayName,
    failureThreshold: policy.failureThreshold,
    openDurationMs: policy.openDurationMs,
    halfOpenProbeLeaseMs: policy.halfOpenProbeLeaseMs,
    enabled: policy.enabled,
    revision: policy.currentRevision,
    createdAt: policy.createdAt,
    updatedAt: policy.updatedAt,
  };
}
