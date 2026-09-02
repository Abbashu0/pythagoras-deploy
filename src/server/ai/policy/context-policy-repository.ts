import { and, asc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../../admin-auth/contracts";
import type { ContentDatabase } from "../../content/database";
import {
  aiContextPolicies,
  aiContextPolicyRevisions,
  type AIContextPolicyRevisionRow,
} from "../../content/schema";
import type {
  AIContextPolicy,
  AIContextPolicyContent,
  AIContextPolicyRepository,
  AIContextPolicyRevision,
} from "./context-policy-contracts";
import { AIPolicyError } from "./errors";
import { normalizeAIContextPolicyContent } from "./context-policy-validation";

export class SQLiteAIContextPolicyRepository implements AIContextPolicyRepository {
  constructor(private readonly database: ContentDatabase) {}

  getById(id: string): AIContextPolicy | null {
    const row = this.database.db.select().from(aiContextPolicies).where(eq(aiContextPolicies.id, id)).get();
    if (!row) return null;
    const revision = this.getRevision(id, row.currentRevision);
    if (!revision) throw new AIPolicyError("AI_POLICY_INVALID", "The current Context Policy revision is missing.");
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

  getCurrentRevision(id: string): AIContextPolicyRevision | null {
    const row = this.database.db.select({ currentRevision: aiContextPolicies.currentRevision })
      .from(aiContextPolicies).where(eq(aiContextPolicies.id, id)).get();
    return row ? this.getRevision(id, row.currentRevision) : null;
  }

  getRevision(id: string, revision: number): AIContextPolicyRevision | null {
    const row = this.database.db.select().from(aiContextPolicyRevisions).where(and(
      eq(aiContextPolicyRevisions.contextPolicyId, id),
      eq(aiContextPolicyRevisions.revision, revision),
    )).get();
    return row ? this.revisionFromRow(row) : null;
  }

  list(): AIContextPolicy[] {
    return this.database.db.select().from(aiContextPolicies).orderBy(asc(aiContextPolicies.key)).all()
      .map((row) => {
        const policy = this.getById(row.id);
        if (!policy) throw new AIPolicyError("AI_POLICY_INVALID", "A Context Policy revision is missing.");
        return policy;
      });
  }

  create(input: { id: string; content: AIContextPolicyContent; actor: AdminActor; now: number }): AIContextPolicyRevision {
    const content = normalizeAIContextPolicyContent(input.content);
    try {
      this.database.db.insert(aiContextPolicies).values({
        id: input.id,
        key: content.key,
        currentRevision: 1,
        createdAt: input.now,
        updatedAt: input.now,
        createdBy: input.actor.actorUserId,
        updatedBy: input.actor.actorUserId,
      }).run();
      this.insertRevision(input.id, 1, content, input.actor, input.now);
      const revision = this.getRevision(input.id, 1);
      if (!revision) throw new AIPolicyError("AI_POLICY_INVALID", "The new Context Policy revision could not be read.");
      return revision;
    } catch (error) {
      if (error instanceof AIPolicyError) throw error;
      throw new AIPolicyError("AI_POLICY_SCOPE_CONFLICT", "The Context Policy could not be created.", {}, error);
    }
  }

  appendRevision(input: { id: string; expectedRevision: number; content: AIContextPolicyContent; actor: AdminActor; now: number }): AIContextPolicyRevision {
    const current = this.database.db.select({ currentRevision: aiContextPolicies.currentRevision })
      .from(aiContextPolicies).where(eq(aiContextPolicies.id, input.id)).get();
    if (!current) throw new AIPolicyError("AI_POLICY_NOT_FOUND", "The Context Policy was not found.");
    if (current.currentRevision !== input.expectedRevision) throw new AIPolicyError("AI_POLICY_CONFLICT", "The Context Policy changed before publication.");
    const content = normalizeAIContextPolicyContent(input.content);
    const nextRevision = input.expectedRevision + 1;
    try {
      this.insertRevision(input.id, nextRevision, content, input.actor, input.now);
      const updated = this.database.db.update(aiContextPolicies).set({
        currentRevision: nextRevision,
        updatedAt: input.now,
        updatedBy: input.actor.actorUserId,
      }).where(and(
        eq(aiContextPolicies.id, input.id),
        eq(aiContextPolicies.currentRevision, input.expectedRevision),
      )).returning({ currentRevision: aiContextPolicies.currentRevision }).get();
      if (!updated) throw new AIPolicyError("AI_POLICY_CONFLICT", "The Context Policy changed before publication.");
      const revision = this.getRevision(input.id, nextRevision);
      if (!revision) throw new AIPolicyError("AI_POLICY_INVALID", "The new Context Policy revision could not be read.");
      return revision;
    } catch (error) {
      if (error instanceof AIPolicyError) throw error;
      throw new AIPolicyError("AI_POLICY_CONFLICT", "The Context Policy revision could not be appended.", {}, error);
    }
  }

  private insertRevision(contextPolicyId: string, revision: number, content: AIContextPolicyContent, actor: AdminActor, now: number): void {
    this.database.db.insert(aiContextPolicyRevisions).values({
      id: uuidv7(),
      contextPolicyId,
      revision,
      displayName: content.displayName,
      softInputBudgetTokens: content.softInputBudgetTokens,
      hardInputBudgetTokens: content.hardInputBudgetTokens,
      outputReserveTokens: content.outputReserveTokens,
      policyBudgetTokens: content.policyBudgetTokens,
      summaryBudgetTokens: content.summaryBudgetTokens,
      recentTurnsBudgetTokens: content.recentTurnsBudgetTokens,
      memoryBudgetTokens: content.memoryBudgetTokens,
      evidenceBudgetTokens: content.evidenceBudgetTokens,
      maxRecentTurns: content.maxRecentTurns,
      enabled: content.enabled,
      createdAt: now,
      createdBy: actor.actorUserId,
    }).run();
  }

  private revisionFromRow(row: AIContextPolicyRevisionRow): AIContextPolicyRevision {
    const policy = this.database.db.select({ key: aiContextPolicies.key })
      .from(aiContextPolicies).where(eq(aiContextPolicies.id, row.contextPolicyId)).get();
    if (!policy) throw new AIPolicyError("AI_POLICY_INVALID", "The Context Policy identity is missing.");
    return {
      contextPolicyId: row.contextPolicyId,
      revisionId: row.id,
      revision: row.revision,
      key: policy.key,
      displayName: row.displayName,
      softInputBudgetTokens: row.softInputBudgetTokens,
      hardInputBudgetTokens: row.hardInputBudgetTokens,
      outputReserveTokens: row.outputReserveTokens,
      policyBudgetTokens: row.policyBudgetTokens,
      summaryBudgetTokens: row.summaryBudgetTokens,
      recentTurnsBudgetTokens: row.recentTurnsBudgetTokens,
      memoryBudgetTokens: row.memoryBudgetTokens,
      evidenceBudgetTokens: row.evidenceBudgetTokens,
      maxRecentTurns: row.maxRecentTurns,
      enabled: row.enabled,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
    };
  }
}
