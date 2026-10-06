import { and, asc, desc, eq, isNull, lt } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../../admin-auth/contracts";
import type { ContentDatabase } from "../../content/database";
import {
  aiInstructionPolicies,
  aiInstructionPolicyRevisions,
  type AIInstructionPolicyRevisionRow,
} from "../../content/schema";
import type {
  AIInstructionPolicy,
  AIInstructionPolicyContent,
  AIInstructionPolicyRepository,
  AIInstructionPolicyRevision,
  AIInstructionPolicyScope,
} from "./instruction-contracts";
import { AIPolicyError } from "./errors";
import { normalizeAIInstructionPolicyContent } from "./instruction-validation";
import { validateInstructionAuthoring } from "./instruction-compiler";

export class SQLiteAIInstructionPolicyRepository implements AIInstructionPolicyRepository {
  constructor(private readonly database: ContentDatabase) {}

  getById(id: string): AIInstructionPolicy | null {
    const row = this.database.db.select().from(aiInstructionPolicies).where(eq(aiInstructionPolicies.id, id)).get();
    if (!row) return null;
    const revision = this.getRevision(id, row.currentRevision);
    if (!revision) throw new AIPolicyError("AI_POLICY_INVALID", "The current Instruction Policy revision is missing.");
    return {
      ...revision,
      id: row.id,
      currentRevision: row.currentRevision,
      currentRevisionId: revision.revisionId,
      scope: row.scope,
      subjectKey: row.subjectKey,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
    };
  }

  getByScope(scope: AIInstructionPolicyScope, subjectKey: string | null): AIInstructionPolicy | null {
    const row = this.database.db.select().from(aiInstructionPolicies).where(and(
      eq(aiInstructionPolicies.scope, scope),
      subjectKey === null ? isNull(aiInstructionPolicies.subjectKey) : eq(aiInstructionPolicies.subjectKey, subjectKey),
    )).get();
    return row ? this.getById(row.id) : null;
  }

  getCurrentRevision(id: string): AIInstructionPolicyRevision | null {
    const row = this.database.db.select({ currentRevision: aiInstructionPolicies.currentRevision })
      .from(aiInstructionPolicies).where(eq(aiInstructionPolicies.id, id)).get();
    return row ? this.getRevision(id, row.currentRevision) : null;
  }

  getRevision(id: string, revision: number): AIInstructionPolicyRevision | null {
    const row = this.database.db.select().from(aiInstructionPolicyRevisions).where(and(
      eq(aiInstructionPolicyRevisions.policyId, id),
      eq(aiInstructionPolicyRevisions.revision, revision),
    )).get();
    return row ? this.revisionFromRow(row) : null;
  }

  list(): AIInstructionPolicy[] {
    return this.database.db.select().from(aiInstructionPolicies).orderBy(asc(aiInstructionPolicies.key)).all()
      .map((row) => {
        const policy = this.getById(row.id);
        if (!policy) throw new AIPolicyError("AI_POLICY_INVALID", "An Instruction Policy revision is missing.");
        return policy;
      });
  }

  listRevisions(id: string, before?: number): AIInstructionPolicyRevision[] {
    return this.database.db.select().from(aiInstructionPolicyRevisions).where(and(
      eq(aiInstructionPolicyRevisions.policyId, id),
      before === undefined ? undefined : lt(aiInstructionPolicyRevisions.revision, before),
    )).orderBy(desc(aiInstructionPolicyRevisions.revision)).limit(20).all().map((row) => this.revisionFromRow(row));
  }

  create(input: { id: string; content: AIInstructionPolicyContent; actor: AdminActor; now: number }): AIInstructionPolicyRevision {
    const content = normalizeAIInstructionPolicyContent(input.content);
    return this.database.client.transaction(() => {
    try {
      this.database.db.insert(aiInstructionPolicies).values({
        id: input.id,
        key: content.key,
        scope: content.scope,
        subjectKey: content.subjectKey,
        currentRevision: 1,
        createdAt: input.now,
        updatedAt: input.now,
        createdBy: input.actor.actorUserId,
        updatedBy: input.actor.actorUserId,
      }).run();
      this.insertRevision(input.id, 1, content, input.actor, input.now);
      const revision = this.getRevision(input.id, 1);
      if (!revision) throw new AIPolicyError("AI_POLICY_INVALID", "The new Instruction Policy revision could not be read.");
      return revision;
    } catch (error) {
      if (error instanceof AIPolicyError) throw error;
      throw new AIPolicyError("AI_POLICY_SCOPE_CONFLICT", "The Instruction Policy could not be created.", {}, error);
    }
    }).immediate();
  }

  appendRevision(input: { id: string; expectedRevision: number; content: AIInstructionPolicyContent; actor: AdminActor; now: number }): AIInstructionPolicyRevision {
    return this.database.client.transaction(() => {
    const current = this.database.db.select({ currentRevision: aiInstructionPolicies.currentRevision })
      .from(aiInstructionPolicies).where(eq(aiInstructionPolicies.id, input.id)).get();
    if (!current) throw new AIPolicyError("AI_POLICY_NOT_FOUND", "The Instruction Policy was not found.");
    if (current.currentRevision !== input.expectedRevision) throw new AIPolicyError("AI_POLICY_CONFLICT", "The Instruction Policy changed before publication.");
    const content = normalizeAIInstructionPolicyContent(input.content);
    const identity = this.getById(input.id)!;
    if (identity.key !== content.key || identity.scope !== content.scope || identity.subjectKey !== content.subjectKey) throw new AIPolicyError("AI_POLICY_INVALID", "Instruction Policy identity is immutable.");
    const nextRevision = input.expectedRevision + 1;
    try {
      this.insertRevision(input.id, nextRevision, content, input.actor, input.now);
      const updated = this.database.db.update(aiInstructionPolicies).set({
        currentRevision: nextRevision,
        updatedAt: input.now,
        updatedBy: input.actor.actorUserId,
      }).where(and(
        eq(aiInstructionPolicies.id, input.id),
        eq(aiInstructionPolicies.currentRevision, input.expectedRevision),
      )).returning({ currentRevision: aiInstructionPolicies.currentRevision }).get();
      if (!updated) throw new AIPolicyError("AI_POLICY_CONFLICT", "The Instruction Policy changed before publication.");
      const revision = this.getRevision(input.id, nextRevision);
      if (!revision) throw new AIPolicyError("AI_POLICY_INVALID", "The new Instruction Policy revision could not be read.");
      return revision;
    } catch (error) {
      if (error instanceof AIPolicyError) throw error;
      throw new AIPolicyError("AI_POLICY_CONFLICT", "The Instruction Policy revision could not be appended.", {}, error);
    }
    }).immediate();
  }

  private insertRevision(policyId: string, revision: number, content: AIInstructionPolicyContent, actor: AdminActor, now: number): void {
    this.database.db.insert(aiInstructionPolicyRevisions).values({
      id: uuidv7(),
      policyId,
      revision,
      displayName: content.displayName,
      instructions: content.instructions,
      sectionsJson: content.authoring ? JSON.stringify(content.authoring.sections) : null,
      compilerVersion: content.authoring?.compilerVersion ?? null,
      compiledHash: content.authoring?.compiledHash ?? null,
      enabled: content.enabled,
      createdAt: now,
      createdBy: actor.actorUserId,
    }).run();
  }

  private revisionFromRow(row: AIInstructionPolicyRevisionRow): AIInstructionPolicyRevision {
    const policy = this.database.db.select({
      key: aiInstructionPolicies.key,
      scope: aiInstructionPolicies.scope,
      subjectKey: aiInstructionPolicies.subjectKey,
    }).from(aiInstructionPolicies).where(eq(aiInstructionPolicies.id, row.policyId)).get();
    if (!policy) throw new AIPolicyError("AI_POLICY_INVALID", "The Instruction Policy identity is missing.");
    let authoring;
    if (row.sectionsJson !== null || row.compilerVersion !== null || row.compiledHash !== null) {
      try {
        authoring = validateInstructionAuthoring({ sections: JSON.parse(row.sectionsJson ?? "null"), compilerVersion: row.compilerVersion, compiledHash: row.compiledHash }, row.instructions);
      } catch (error) { throw new AIPolicyError("AI_POLICY_INVALID", "Instruction revision integrity check failed.", {}, error); }
    }
    return {
      policyId: row.policyId,
      revisionId: row.id,
      revision: row.revision,
      key: policy.key,
      scope: policy.scope,
      subjectKey: policy.subjectKey,
      displayName: row.displayName,
      instructions: row.instructions,
      ...(authoring ? { authoring } : {}),
      enabled: row.enabled,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
    };
  }
}
