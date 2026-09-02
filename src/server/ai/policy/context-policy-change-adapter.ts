import type { AdminActor } from "../../admin-auth/contracts";
import type {
  ChangeOperation,
  ChangePresentation,
  ChangeResourceAdapter,
  ChangeSnapshot,
  ResourceState,
} from "../../change-management/contracts";
import { ChangeManagementError } from "../../change-management/errors";
import { deriveChangedPaths, validateChangeSnapshot } from "../../change-management/snapshot";
import type { ContentDatabase } from "../../content/database";
import { AIPolicyError } from "./errors";
import {
  AI_CONTEXT_POLICY_RESOURCE_TYPE,
  type AIContextPolicy,
  type AIContextPolicyContent,
} from "./context-policy-contracts";
import { SQLiteAIContextPolicyRepository } from "./context-policy-repository";
import { normalizeAIContextPolicyContent } from "./context-policy-validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FIELD_LABELS: Record<string, string> = {
  key: "Context Policy key",
  displayName: "Display name",
  softInputBudgetTokens: "Soft input budget",
  hardInputBudgetTokens: "Hard input budget",
  outputReserveTokens: "Output reserve",
  policyBudgetTokens: "Policy budget",
  summaryBudgetTokens: "Summary budget",
  recentTurnsBudgetTokens: "Recent turns budget",
  memoryBudgetTokens: "Memory budget",
  evidenceBudgetTokens: "Evidence budget",
  maxRecentTurns: "Maximum recent turns",
  enabled: "Enabled state",
};

export class AIContextPolicyChangeAdapter implements ChangeResourceAdapter {
  readonly resourceType = AI_CONTEXT_POLICY_RESOURCE_TYPE;
  readonly areaLabel = "AI / Context Policies";
  readonly mergeStrategy = "THREE_WAY" as const;

  loadCurrent(database: ContentDatabase, resourceId: string): ResourceState {
    assertUuid(resourceId, "resourceId");
    const policy = new SQLiteAIContextPolicyRepository(database).getById(resourceId);
    if (!policy) throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Context Policy was not found.");
    return { resourceId: policy.id, revision: policy.currentRevision, snapshot: snapshotFromContent(policy) };
  }

  captureProposal(database: ContentDatabase, resourceId: string, desired: unknown, operation: ChangeOperation = "UPDATE") {
    assertUuid(resourceId, "resourceId");
    const repository = new SQLiteAIContextPolicyRepository(database);
    const current = operation === "CREATE" ? this.emptyCreateState(repository, resourceId) : this.loadCurrent(database, resourceId);
    try {
      const content = normalizeAIContextPolicyContent(desired);
      if (operation === "CREATE" && repository.getById(resourceId)) throw new AIPolicyError("AI_POLICY_SCOPE_CONFLICT", "The Context Policy identifier is already in use.");
      if (operation === "UPDATE" && current.snapshot.key !== content.key) throw new AIPolicyError("AI_POLICY_INVALID", "Context Policy key is immutable after creation.");
      const proposedSnapshot = snapshotFromContent(content);
      validateChangeSnapshot(proposedSnapshot);
      const changedPaths = deriveChangedPaths(current.snapshot, proposedSnapshot);
      if (!changedPaths.length) throw new AIPolicyError("AI_POLICY_INVALID", "The Context Policy proposal does not change any fields.");
      return { current, proposedSnapshot, changedPaths };
    } catch (error) {
      throw mapPolicyError(error);
    }
  }

  validateSnapshot(snapshot: ChangeSnapshot): void {
    try {
      validateChangeSnapshot(snapshot);
      normalizeAIContextPolicyContent(snapshot);
    } catch (error) {
      throw mapPolicyError(error);
    }
  }

  describe(resourceId: string, before: ChangeSnapshot, proposed: ChangeSnapshot, operation: ChangeOperation = "UPDATE"): ChangePresentation {
    const after = normalizeAIContextPolicyContent(proposed);
    const previous = operation === "CREATE" && Object.keys(before).length === 0 ? null : normalizeAIContextPolicyContent(before);
    if (previous && previous.key !== after.key) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "Context Policy key is immutable after creation.");
    const changedPaths = deriveChangedPaths(previous ? snapshotFromContent(previous) : {}, snapshotFromContent(after));
    return {
      resourceLabel: after.displayName,
      resourceSubtitle: operation === "CREATE" ? "New governed Context Policy" : `Context Policy · ${resourceId}`,
      changeSummary: `${changedPaths.length} changed field${changedPaths.length === 1 ? "" : "s"}`,
      areaLabel: this.areaLabel,
      fieldDiffs: changedPaths.map((path) => ({
        path,
        label: FIELD_LABELS[path] ?? path,
        before: previous ? snapshotFromContent(previous)[path] : undefined,
        after: snapshotFromContent(after)[path],
      })),
    };
  }

  apply(database: ContentDatabase, resourceId: string, value: ChangeSnapshot, expectedRevision: number, actor: AdminActor, operation: ChangeOperation = "UPDATE"): ResourceState {
    if (actor.actorRole !== "OWNER") throw new ChangeManagementError("CHANGE_AUTHORIZATION_FAILED", "Only OWNER may publish Context Policies.");
    assertUuid(resourceId, "resourceId");
    const content = normalizeAIContextPolicyContent(value);
    const repository = new SQLiteAIContextPolicyRepository(database);
    const current = operation === "UPDATE" ? repository.getById(resourceId) : null;
    if (operation === "UPDATE") {
      if (!current) throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Context Policy was not found.");
      if (current.key !== content.key) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "Context Policy key is immutable after creation.");
    }
    try {
      const revision = operation === "CREATE"
        ? repository.create({ id: resourceId, content, actor, now: Date.now() })
        : repository.appendRevision({ id: resourceId, expectedRevision, content, actor, now: Date.now() });
      const policy = repository.getById(resourceId);
      if (!policy) throw new AIPolicyError("AI_POLICY_INVALID", "The published Context Policy could not be read.");
      return { resourceId, revision: revision.revision, snapshot: snapshotFromContent(policy) };
    } catch (error) {
      throw mapPolicyError(error);
    }
  }

  validatePublication(database: ContentDatabase): void {
    const repository = new SQLiteAIContextPolicyRepository(database);
    for (const policy of repository.list()) {
      if (!repository.getCurrentRevision(policy.id)) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "A Context Policy current revision is missing.");
    }
  }

  private emptyCreateState(repository: SQLiteAIContextPolicyRepository, resourceId: string): ResourceState {
    if (repository.getById(resourceId)) throw new ChangeManagementError("CHANGE_CONFLICT", "The Context Policy identifier is already in use.");
    return { resourceId, revision: 0, snapshot: {} };
  }
}

function snapshotFromContent(content: AIContextPolicy | AIContextPolicyContent): ChangeSnapshot {
  return structuredClone({
    key: content.key,
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
  }) as ChangeSnapshot;
}

function assertUuid(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", `${field} must be a stable UUID.`);
}

function mapPolicyError(error: unknown): Error {
  if (error instanceof ChangeManagementError) return error;
  if (error instanceof AIPolicyError) return new ChangeManagementError(error.code === "AI_POLICY_CONFLICT" ? "CHANGE_CONFLICT" : "CHANGE_VALIDATION_FAILED", error.message, error);
  return error instanceof Error
    ? new ChangeManagementError("CHANGE_PUBLICATION_FAILED", "The Context Policy operation failed.", error)
    : new ChangeManagementError("CHANGE_PUBLICATION_FAILED", "The Context Policy operation failed.");
}
