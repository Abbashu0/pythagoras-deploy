import { and, asc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../../admin-auth/contracts";
import type { ContentDatabase } from "../../content/database";
import {
  aiBudgetPolicies,
  aiBudgetPolicyRevisions,
  type AIBudgetPolicyRevisionRow,
} from "../../content/schema";
import type {
  AIBudgetPolicy,
  AIBudgetPolicyContent,
  AIBudgetPolicyRepository,
  AIBudgetPolicyRevision,
  SafeAIBudgetPolicyDTO,
} from "./contracts";
import { AIBudgetPolicyError } from "./errors";
import { normalizeAIBudgetPolicyContent } from "./validation";

export class SQLiteAIBudgetPolicyRepository implements AIBudgetPolicyRepository {
  constructor(private readonly database: ContentDatabase) {}

  getById(id: string): AIBudgetPolicy | null {
    const row = this.database.db
      .select()
      .from(aiBudgetPolicies)
      .where(eq(aiBudgetPolicies.id, id))
      .get();
    if (!row) return null;
    const revision = this.getRevision(id, row.currentRevision);
    if (!revision) throw new AIBudgetPolicyError("AI_BUDGET_POLICY_INVALID", "The current Budget Policy revision is missing.");
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

  getCurrentRevision(id: string): AIBudgetPolicyRevision | null {
    const row = this.database.db
      .select({ currentRevision: aiBudgetPolicies.currentRevision })
      .from(aiBudgetPolicies)
      .where(eq(aiBudgetPolicies.id, id))
      .get();
    return row ? this.getRevision(id, row.currentRevision) : null;
  }

  getRevision(id: string, revision: number): AIBudgetPolicyRevision | null {
    const row = this.database.db
      .select()
      .from(aiBudgetPolicyRevisions)
      .where(and(eq(aiBudgetPolicyRevisions.budgetPolicyId, id), eq(aiBudgetPolicyRevisions.revision, revision)))
      .get();
    return row ? this.revisionFromRow(row) : null;
  }

  list(): AIBudgetPolicy[] {
    return this.database.db
      .select()
      .from(aiBudgetPolicies)
      .orderBy(asc(aiBudgetPolicies.key))
      .all()
      .map((row) => {
        const revision = this.getRevision(row.id, row.currentRevision);
        if (!revision) throw new AIBudgetPolicyError("AI_BUDGET_POLICY_INVALID", "A Budget Policy revision is missing.");
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

  listRevisions(): AIBudgetPolicyRevision[] {
    return this.database.db
      .select()
      .from(aiBudgetPolicyRevisions)
      .orderBy(asc(aiBudgetPolicyRevisions.budgetPolicyId), asc(aiBudgetPolicyRevisions.revision))
      .all()
      .map((row) => this.revisionFromRow(row));
  }

  create(input: {
    id: string;
    content: AIBudgetPolicyContent;
    actor: AdminActor;
    now: number;
  }): AIBudgetPolicyRevision {
    const content = normalizeAIBudgetPolicyContent(input.content);
    try {
      this.database.db.insert(aiBudgetPolicies).values({
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
      if (!revision) throw new AIBudgetPolicyError("AI_BUDGET_POLICY_INVALID", "The new Budget Policy revision could not be read.");
      return revision;
    } catch (error) {
      if (error instanceof AIBudgetPolicyError) throw error;
      throw new AIBudgetPolicyError("AI_BUDGET_POLICY_CONFLICT", "The Budget Policy could not be created.", error);
    }
  }

  appendRevision(input: {
    id: string;
    expectedRevision: number;
    content: AIBudgetPolicyContent;
    actor: AdminActor;
    now: number;
  }): AIBudgetPolicyRevision {
    const current = this.database.db
      .select({ currentRevision: aiBudgetPolicies.currentRevision })
      .from(aiBudgetPolicies)
      .where(eq(aiBudgetPolicies.id, input.id))
      .get();
    if (!current) throw new AIBudgetPolicyError("AI_BUDGET_POLICY_NOT_FOUND", "The Budget Policy was not found.");
    if (current.currentRevision !== input.expectedRevision) {
      throw new AIBudgetPolicyError("AI_BUDGET_POLICY_CONFLICT", "The Budget Policy changed before publication.");
    }
    const content = normalizeAIBudgetPolicyContent(input.content);
    const nextRevision = input.expectedRevision + 1;
    try {
      this.insertRevisionRows(input.id, nextRevision, content, input.actor, input.now);
      const updated = this.database.db
        .update(aiBudgetPolicies)
        .set({
          currentRevision: nextRevision,
          updatedAt: input.now,
          updatedBy: input.actor.actorUserId,
        })
        .where(and(eq(aiBudgetPolicies.id, input.id), eq(aiBudgetPolicies.currentRevision, input.expectedRevision)))
        .returning({ currentRevision: aiBudgetPolicies.currentRevision })
        .get();
      if (!updated) throw new AIBudgetPolicyError("AI_BUDGET_POLICY_CONFLICT", "The Budget Policy changed before publication.");
      const revision = this.getRevision(input.id, nextRevision);
      if (!revision) throw new AIBudgetPolicyError("AI_BUDGET_POLICY_INVALID", "The new Budget Policy revision could not be read.");
      return revision;
    } catch (error) {
      if (error instanceof AIBudgetPolicyError) throw error;
      throw new AIBudgetPolicyError("AI_BUDGET_POLICY_CONFLICT", "The Budget Policy revision could not be appended.", error);
    }
  }

  private insertRevisionRows(
    policyId: string,
    revision: number,
    content: AIBudgetPolicyContent,
    actor: AdminActor,
    now: number,
  ): void {
    this.database.db.insert(aiBudgetPolicyRevisions).values({
      id: uuidv7(),
      budgetPolicyId: policyId,
      revision,
      displayName: content.displayName,
      currency: content.currency,
      costCenter: content.costCenter,
      hardCapNano: content.hardCapNano,
      enabled: content.enabled,
      createdAt: now,
      createdBy: actor.actorUserId,
    }).run();
  }

  private revisionFromRow(row: AIBudgetPolicyRevisionRow): AIBudgetPolicyRevision {
    const policy = this.database.db
      .select({ key: aiBudgetPolicies.key })
      .from(aiBudgetPolicies)
      .where(eq(aiBudgetPolicies.id, row.budgetPolicyId))
      .get();
    if (!policy) throw new AIBudgetPolicyError("AI_BUDGET_POLICY_INVALID", "The Budget Policy identity is missing.");
    return {
      key: policy.key,
      displayName: row.displayName,
      currency: row.currency,
      costCenter: row.costCenter,
      hardCapNano: row.hardCapNano,
      enabled: row.enabled,
      budgetPolicyId: row.budgetPolicyId,
      revision: row.revision,
      revisionId: row.id,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
    };
  }
}

export function toSafeAIBudgetPolicyDTO(
  policy: AIBudgetPolicy,
): SafeAIBudgetPolicyDTO {
  return {
    id: policy.id,
    key: policy.key,
    displayName: policy.displayName,
    currency: policy.currency,
    costCenter: policy.costCenter,
    hardCapNano: policy.hardCapNano,
    enabled: policy.enabled,
    revision: policy.currentRevision,
    createdAt: policy.createdAt,
    updatedAt: policy.updatedAt,
  };
}
