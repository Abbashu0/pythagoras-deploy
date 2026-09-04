import { and, eq } from "drizzle-orm";

import type { AdminActor } from "../../admin-auth/contracts";
import type { ContentDatabase } from "../../content/database";
import {
  aiBudgetPolicyRevisions,
  aiModelConfigs,
  aiProviderConfigs,
  aiRateLimitPolicyRevisions,
  canonicalMaterials,
} from "../../content/schema";
import { ChangeManagementError } from "../../change-management/errors";
import type {
  ChangeOperation,
  ChangePresentation,
  ChangeResourceAdapter,
  ChangeSnapshot,
  ResourceState,
} from "../../change-management/contracts";
import { deriveChangedPaths, validateChangeSnapshot } from "../../change-management/snapshot";
import {
  AI_EVAL_JUDGE_CONFIG_RESOURCE_TYPE,
  type AIEvalJudgeConfig,
  type AIEvalJudgeConfigContent,
} from "./contracts";
import { AIEvalError } from "./errors";
import { SQLiteAIEvalJudgeConfigRepository, normalizeAIEvalJudgeConfigContent } from "./judge-config";

export class AIEvalJudgeConfigChangeAdapter implements ChangeResourceAdapter {
  readonly resourceType = AI_EVAL_JUDGE_CONFIG_RESOURCE_TYPE;
  readonly areaLabel = "AI / Eval Judge";
  readonly mergeStrategy = "CONSERVATIVE" as const;

  loadCurrent(database: ContentDatabase, resourceId: string): ResourceState {
    assertUuid(resourceId);
    const config = new SQLiteAIEvalJudgeConfigRepository(database).getById(resourceId);
    if (!config) throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Eval Judge Config was not found.");
    return { resourceId, revision: config.currentRevision, snapshot: snapshot(config) };
  }

  captureProposal(database: ContentDatabase, resourceId: string, desired: unknown, operation: ChangeOperation = "UPDATE") {
    assertUuid(resourceId);
    const repository = new SQLiteAIEvalJudgeConfigRepository(database);
    const current = operation === "CREATE" ? emptyState(repository.getById(resourceId), resourceId) : this.loadCurrent(database, resourceId);
    try {
      const content = normalizeAIEvalJudgeConfigContent(desired);
      assertCanonicalAndDependencies(database, content);
      if (operation === "UPDATE" && (current.snapshot.key !== content.key || current.snapshot.subjectKey !== content.subjectKey)) {
        throw new AIEvalError("AI_EVAL_CONFLICT", "Eval Judge Config key and subject are immutable.");
      }
      const proposedSnapshot = snapshot(content);
      validateChangeSnapshot(proposedSnapshot);
      const changedPaths = deriveChangedPaths(current.snapshot, proposedSnapshot);
      if (!changedPaths.length) throw new AIEvalError("AI_EVAL_INVALID", "The Eval Judge Config proposal does not change any fields.");
      return { current, proposedSnapshot, changedPaths };
    } catch (error) {
      throw mapError(error);
    }
  }

  validateSnapshot(value: ChangeSnapshot): void {
    try {
      normalizeAIEvalJudgeConfigContent(value);
    } catch (error) {
      throw mapError(error);
    }
  }

  describe(resourceId: string, before: ChangeSnapshot, proposed: ChangeSnapshot, operation: ChangeOperation = "UPDATE"): ChangePresentation {
    const after = normalizeAIEvalJudgeConfigContent(proposed);
    const changedPaths = deriveChangedPaths(before, snapshot(after));
    return {
      resourceLabel: after.displayName,
      resourceSubtitle: operation === "CREATE" ? "New governed Eval Judge Config" : `Eval Judge Config · ${resourceId}`,
      changeSummary: `${changedPaths.length} changed field${changedPaths.length === 1 ? "" : "s"}`,
      areaLabel: this.areaLabel,
      fieldDiffs: changedPaths.map((path) => ({ path, label: path, before: before[path], after: snapshot(after)[path] })),
    };
  }

  apply(
    database: ContentDatabase,
    resourceId: string,
    value: ChangeSnapshot,
    expectedRevision: number,
    actor: AdminActor,
    operation: ChangeOperation = "UPDATE",
  ): ResourceState {
    if (actor.actorRole !== "OWNER") {
      throw new ChangeManagementError("CHANGE_AUTHORIZATION_FAILED", "Only OWNER may publish Eval Judge Config changes.");
    }
    assertUuid(resourceId);
    try {
      const content = normalizeAIEvalJudgeConfigContent(value);
      assertCanonicalAndDependencies(database, content);
      const repository = new SQLiteAIEvalJudgeConfigRepository(database);
      if (operation === "CREATE") repository.create({ id: resourceId, content, actor, now: Date.now() });
      else repository.appendRevision({ id: resourceId, expectedRevision, content, actor, now: Date.now() });
      return this.loadCurrent(database, resourceId);
    } catch (error) {
      throw mapError(error);
    }
  }

  validatePublication(database: ContentDatabase): void {
    for (const config of new SQLiteAIEvalJudgeConfigRepository(database).list()) {
      assertCanonicalAndDependencies(database, config);
    }
  }
}

function snapshot(value: AIEvalJudgeConfig | AIEvalJudgeConfigContent): ChangeSnapshot {
  return structuredClone({
    key: value.key,
    subjectKey: value.subjectKey,
    displayName: value.displayName,
    enabled: value.enabled,
    modelConfigId: value.modelConfigId,
    modelConfigRevision: value.modelConfigRevision,
    providerConfigId: value.providerConfigId,
    providerConfigRevision: value.providerConfigRevision,
    budgetPolicyId: value.budgetPolicyId,
    budgetPolicyRevision: value.budgetPolicyRevision,
    rateLimitPolicyId: value.rateLimitPolicyId,
    rateLimitPolicyRevision: value.rateLimitPolicyRevision,
    protocolKey: value.protocolKey,
    protocolRevision: value.protocolRevision,
    timeoutMs: value.timeoutMs,
    maxOutputTokens: value.maxOutputTokens,
  });
}

function assertCanonicalAndDependencies(database: ContentDatabase, content: AIEvalJudgeConfigContent): void {
  if (!database.db.select({ subjectKey: canonicalMaterials.subjectKey }).from(canonicalMaterials).where(eq(canonicalMaterials.subjectKey, content.subjectKey)).get()) {
    throw new AIEvalError("AI_EVAL_GOVERNANCE_INVALID", "The Eval Judge Config subject is not canonical.");
  }
  const model = database.db
    .select({ id: aiModelConfigs.id, revision: aiModelConfigs.revision, capability: aiModelConfigs.capability, enabled: aiModelConfigs.enabled, providerConfigId: aiModelConfigs.providerConfigId })
    .from(aiModelConfigs)
    .where(and(eq(aiModelConfigs.id, content.modelConfigId), eq(aiModelConfigs.revision, content.modelConfigRevision)))
    .get();
  const provider = database.db
    .select({ id: aiProviderConfigs.id, revision: aiProviderConfigs.revision, enabled: aiProviderConfigs.enabled, credentialRef: aiProviderConfigs.credentialRef })
    .from(aiProviderConfigs)
    .where(and(eq(aiProviderConfigs.id, content.providerConfigId), eq(aiProviderConfigs.revision, content.providerConfigRevision)))
    .get();
  const budget = database.db
    .select({ costCenter: aiBudgetPolicyRevisions.costCenter, enabled: aiBudgetPolicyRevisions.enabled })
    .from(aiBudgetPolicyRevisions)
    .where(and(eq(aiBudgetPolicyRevisions.budgetPolicyId, content.budgetPolicyId), eq(aiBudgetPolicyRevisions.revision, content.budgetPolicyRevision)))
    .get();
  const rate = database.db
    .select({ enabled: aiRateLimitPolicyRevisions.enabled })
    .from(aiRateLimitPolicyRevisions)
    .where(and(eq(aiRateLimitPolicyRevisions.rateLimitPolicyId, content.rateLimitPolicyId), eq(aiRateLimitPolicyRevisions.revision, content.rateLimitPolicyRevision)))
    .get();

  if (!model || !model.enabled || model.capability !== "GENERATION") {
    throw new AIEvalError("AI_EVAL_JUDGE_CONFIG_INVALID", "The Eval Judge Config must reference an enabled GENERATION Model Config.");
  }
  if (!provider || !provider.enabled || !provider.credentialRef) {
    throw new AIEvalError("AI_EVAL_JUDGE_CONFIG_INVALID", "The Eval Judge Config must reference an enabled Provider Config with credentials.");
  }
  if (model.providerConfigId !== content.providerConfigId) {
    throw new AIEvalError("AI_EVAL_JUDGE_CONFIG_INVALID", "The Judge Model Config does not belong to the specified Provider Config.");
  }
  if (!budget || !budget.enabled || budget.costCenter !== "EVALS") {
    throw new AIEvalError("AI_EVAL_JUDGE_CONFIG_INVALID", "The Eval Judge Config must reference an enabled EVALS Budget Policy.");
  }
  if (!rate || !rate.enabled) {
    throw new AIEvalError("AI_EVAL_JUDGE_CONFIG_INVALID", "The Eval Judge Config must reference an enabled Rate Limit Policy.");
  }
}

function emptyState(existing: unknown, resourceId: string): ResourceState {
  if (existing) throw new ChangeManagementError("CHANGE_CONFLICT", "The Eval Judge Config identifier is already in use.");
  return { resourceId, revision: 0, snapshot: {} };
}

function mapError(error: unknown): Error {
  if (error instanceof ChangeManagementError) return error;
  if (error instanceof AIEvalError) return new ChangeManagementError(error.code === "AI_EVAL_CONFLICT" ? "CHANGE_CONFLICT" : "CHANGE_VALIDATION_FAILED", error.message, error);
  return new ChangeManagementError("CHANGE_PUBLICATION_FAILED", "The Eval Judge Config operation failed.", error);
}

function assertUuid(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "The Eval Judge Config identifier must be a stable UUID.");
  }
}
