import { and, eq } from "drizzle-orm";

import type { AdminActor } from "../../admin-auth/contracts";
import type { ContentDatabase } from "../../content/database";
import { aiBudgetPolicyRevisions, aiRateLimitPolicyRevisions, canonicalMaterials } from "../../content/schema";
import { ChangeManagementError } from "../../change-management/errors";
import type { ChangeOperation, ChangePresentation, ChangeResourceAdapter, ChangeSnapshot, ResourceState } from "../../change-management/contracts";
import { deriveChangedPaths, validateChangeSnapshot } from "../../change-management/snapshot";
import {
  AI_EVAL_EXECUTION_CONFIG_RESOURCE_TYPE,
  type AIEvalExecutionConfig,
  type AIEvalExecutionConfigContent,
} from "./contracts";
import { AIEvalError } from "./errors";
import { SQLiteAIEvalExecutionConfigRepository, normalizeAIEvalExecutionConfigContent } from "./execution-config";

export class AIEvalExecutionConfigChangeAdapter implements ChangeResourceAdapter {
  readonly resourceType = AI_EVAL_EXECUTION_CONFIG_RESOURCE_TYPE;
  readonly areaLabel = "AI / Eval Execution";
  readonly mergeStrategy = "CONSERVATIVE" as const;

  loadCurrent(database: ContentDatabase, resourceId: string): ResourceState {
    assertUuid(resourceId);
    const config = new SQLiteAIEvalExecutionConfigRepository(database).getById(resourceId);
    if (!config) throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Eval Execution Config was not found.");
    return { resourceId, revision: config.currentRevision, snapshot: snapshot(config) };
  }

  captureProposal(database: ContentDatabase, resourceId: string, desired: unknown, operation: ChangeOperation = "UPDATE") {
    assertUuid(resourceId);
    const repository = new SQLiteAIEvalExecutionConfigRepository(database);
    const current = operation === "CREATE" ? emptyState(repository.getById(resourceId), resourceId) : this.loadCurrent(database, resourceId);
    try {
      const content = normalizeAIEvalExecutionConfigContent(desired);
      assertCanonicalAndDependencies(database, content);
      if (operation === "UPDATE" && (current.snapshot.key !== content.key || current.snapshot.subjectKey !== content.subjectKey)) throw new AIEvalError("AI_EVAL_CONFLICT", "Eval Execution Config key and subject are immutable.");
      const proposedSnapshot = snapshot(content);
      validateChangeSnapshot(proposedSnapshot);
      const changedPaths = deriveChangedPaths(current.snapshot, proposedSnapshot);
      if (!changedPaths.length) throw new AIEvalError("AI_EVAL_INVALID", "The Eval Execution Config proposal does not change any fields.");
      return { current, proposedSnapshot, changedPaths };
    } catch (error) { throw mapError(error); }
  }

  validateSnapshot(value: ChangeSnapshot): void {
    try { normalizeAIEvalExecutionConfigContent(value); } catch (error) { throw mapError(error); }
  }

  describe(resourceId: string, before: ChangeSnapshot, proposed: ChangeSnapshot, operation: ChangeOperation = "UPDATE"): ChangePresentation {
    const after = normalizeAIEvalExecutionConfigContent(proposed);
    const changedPaths = deriveChangedPaths(before, snapshot(after));
    return { resourceLabel: after.displayName, resourceSubtitle: operation === "CREATE" ? "New governed Eval Execution Config" : `Eval Execution Config · ${resourceId}`, changeSummary: `${changedPaths.length} changed field${changedPaths.length === 1 ? "" : "s"}`, areaLabel: this.areaLabel, fieldDiffs: changedPaths.map((path) => ({ path, label: path, before: before[path], after: snapshot(after)[path] })) };
  }

  apply(database: ContentDatabase, resourceId: string, value: ChangeSnapshot, expectedRevision: number, actor: AdminActor, operation: ChangeOperation = "UPDATE"): ResourceState {
    if (actor.actorRole !== "OWNER") throw new ChangeManagementError("CHANGE_AUTHORIZATION_FAILED", "Only OWNER may publish Eval Execution Config changes.");
    assertUuid(resourceId);
    try {
      const content = normalizeAIEvalExecutionConfigContent(value);
      assertCanonicalAndDependencies(database, content);
      const repository = new SQLiteAIEvalExecutionConfigRepository(database);
      if (operation === "CREATE") repository.create({ id: resourceId, content, actor, now: Date.now() });
      else repository.appendRevision({ id: resourceId, expectedRevision, content, actor, now: Date.now() });
      return this.loadCurrent(database, resourceId);
    } catch (error) { throw mapError(error); }
  }

  validatePublication(database: ContentDatabase): void {
    for (const config of new SQLiteAIEvalExecutionConfigRepository(database).list()) {
      assertCanonicalAndDependencies(database, config);
    }
  }
}

function snapshot(value: AIEvalExecutionConfig | AIEvalExecutionConfigContent): ChangeSnapshot {
  return structuredClone({ key: value.key, subjectKey: value.subjectKey, displayName: value.displayName, enabled: value.enabled, budgetPolicyId: value.budgetPolicyId, budgetPolicyRevision: value.budgetPolicyRevision, rateLimitPolicyId: value.rateLimitPolicyId, rateLimitPolicyRevision: value.rateLimitPolicyRevision, protocolKey: value.protocolKey, protocolRevision: value.protocolRevision, targetTimeoutMs: value.targetTimeoutMs, maxConcurrency: value.maxConcurrency, cleanupProtocolKey: value.cleanupProtocolKey, cleanupProtocolRevision: value.cleanupProtocolRevision });
}

function assertCanonicalAndDependencies(database: ContentDatabase, content: AIEvalExecutionConfigContent): void {
  if (!database.db.select({ subjectKey: canonicalMaterials.subjectKey }).from(canonicalMaterials).where(eq(canonicalMaterials.subjectKey, content.subjectKey)).get()) throw new AIEvalError("AI_EVAL_GOVERNANCE_INVALID", "The Eval Execution Config subject is not canonical.");
  const budget = database.db.select({ enabled: aiBudgetPolicyRevisions.enabled, costCenter: aiBudgetPolicyRevisions.costCenter }).from(aiBudgetPolicyRevisions).where(and(eq(aiBudgetPolicyRevisions.budgetPolicyId, content.budgetPolicyId), eq(aiBudgetPolicyRevisions.revision, content.budgetPolicyRevision))).get();
  const rate = database.db.select({ enabled: aiRateLimitPolicyRevisions.enabled }).from(aiRateLimitPolicyRevisions).where(and(eq(aiRateLimitPolicyRevisions.rateLimitPolicyId, content.rateLimitPolicyId), eq(aiRateLimitPolicyRevisions.revision, content.rateLimitPolicyRevision))).get();
  if (!budget?.enabled || budget.costCenter !== "EVALS" || !rate?.enabled) throw new AIEvalError("AI_EVAL_EXECUTION_CONFIG_INVALID", "The Eval Execution Config policies are not enabled for EVALS.");
}

function emptyState(existing: unknown, resourceId: string): ResourceState {
  if (existing) throw new ChangeManagementError("CHANGE_CONFLICT", "The Eval Execution Config identifier is already in use.");
  return { resourceId, revision: 0, snapshot: {} };
}

function mapError(error: unknown): Error {
  if (error instanceof ChangeManagementError) return error;
  if (error instanceof AIEvalError) return new ChangeManagementError(error.code === "AI_EVAL_CONFLICT" ? "CHANGE_CONFLICT" : "CHANGE_VALIDATION_FAILED", error.message, error);
  return new ChangeManagementError("CHANGE_PUBLICATION_FAILED", "The Eval Execution Config operation failed.", error);
}

function assertUuid(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "The Eval Execution Config identifier must be a stable UUID.");
}
