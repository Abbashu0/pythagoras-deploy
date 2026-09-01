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
import {
  AI_BUDGET_POLICY_RESOURCE_TYPE,
  type AIBudgetPolicy,
  type AIBudgetPolicyContent,
} from "./contracts";
import { AIBudgetPolicyError } from "./errors";
import { SQLiteAIBudgetPolicyRepository } from "./sqlite-policy-repository";
import { normalizeAIBudgetPolicyContent } from "./validation";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const FIELD_LABELS: Record<string, string> = {
  key: "Budget Policy key",
  displayName: "Display name",
  currency: "Currency",
  costCenter: "Cost center",
  hardCapNano: "Hard cap",
  enabled: "Enabled state",
};

export class AIBudgetPolicyChangeAdapter implements ChangeResourceAdapter {
  readonly resourceType = AI_BUDGET_POLICY_RESOURCE_TYPE;
  readonly areaLabel = "AI / Budget Policies";
  readonly mergeStrategy = "THREE_WAY" as const;

  loadCurrent(database: ContentDatabase, resourceId: string): ResourceState {
    assertUuid(resourceId, "resourceId");
    const policy = new SQLiteAIBudgetPolicyRepository(database).getById(resourceId);
    if (!policy) throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Budget Policy was not found.");
    return {
      resourceId: policy.id,
      revision: policy.currentRevision,
      snapshot: snapshotFromContent(policy),
    };
  }

  captureProposal(
    database: ContentDatabase,
    resourceId: string,
    desired: unknown,
    operation: ChangeOperation = "UPDATE",
  ) {
    assertUuid(resourceId, "resourceId");
    const repository = new SQLiteAIBudgetPolicyRepository(database);
    const current = operation === "CREATE"
      ? this.emptyCreateState(repository, resourceId)
      : this.loadCurrent(database, resourceId);
    try {
      const content = normalizeAIBudgetPolicyContent(desired);
      if (operation === "UPDATE") assertStableIdentity(current.snapshot, content);
      const proposedSnapshot = snapshotFromContent(content);
      validateChangeSnapshot(proposedSnapshot);
      const changedPaths = deriveChangedPaths(current.snapshot, proposedSnapshot);
      if (!changedPaths.length) throw new AIBudgetPolicyError("AI_BUDGET_POLICY_INVALID", "The Budget Policy proposal does not change any fields.");
      return { current, proposedSnapshot, changedPaths };
    } catch (error) {
      throw mapPolicyError(error);
    }
  }

  validateSnapshot(snapshot: ChangeSnapshot): void {
    try {
      validateChangeSnapshot(snapshot);
      normalizeAIBudgetPolicyContent(snapshot);
    } catch (error) {
      throw mapPolicyError(error);
    }
  }

  describe(
    resourceId: string,
    before: ChangeSnapshot,
    proposed: ChangeSnapshot,
    operation: ChangeOperation = "UPDATE",
  ): ChangePresentation {
    const after = normalizeAIBudgetPolicyContent(proposed);
    const previous = operation === "CREATE" && Object.keys(before).length === 0
      ? null
      : normalizeAIBudgetPolicyContent(before);
    if (previous) assertStableIdentity(previous, after);
    const changedPaths = deriveChangedPaths(
      previous ? snapshotFromContent(previous) : {},
      snapshotFromContent(after),
    );
    return {
      resourceLabel: after.displayName,
      resourceSubtitle: operation === "CREATE" ? "New governed Budget Policy" : `Budget Policy · ${resourceId}`,
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

  apply(
    database: ContentDatabase,
    resourceId: string,
    value: ChangeSnapshot,
    expectedRevision: number,
    actor: AdminActor,
    operation: ChangeOperation = "UPDATE",
  ): ResourceState {
    if (actor.actorRole !== "OWNER") throw new ChangeManagementError("CHANGE_AUTHORIZATION_FAILED", "Only OWNER may publish Budget Policies.");
    assertUuid(resourceId, "resourceId");
    const content = normalizeAIBudgetPolicyContent(value);
    const repository = new SQLiteAIBudgetPolicyRepository(database);
    const current = operation === "UPDATE" ? repository.getCurrentRevision(resourceId) : null;
    if (operation === "UPDATE") {
      if (!current) throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Budget Policy was not found.");
      assertStableIdentity(current, content);
    }
    try {
      const revision = operation === "CREATE"
        ? repository.create({ id: resourceId, content, actor, now: Date.now() })
        : repository.appendRevision({ id: resourceId, expectedRevision, content, actor, now: Date.now() });
      return { resourceId, revision: revision.revision, snapshot: snapshotFromContent(revision) };
    } catch (error) {
      throw mapPolicyError(error);
    }
  }

  validatePublication(database: ContentDatabase): void {
    const repository = new SQLiteAIBudgetPolicyRepository(database);
    for (const policy of repository.list()) {
      if (!repository.getCurrentRevision(policy.id)) {
        throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "A Budget Policy current revision is missing.");
      }
    }
  }

  private emptyCreateState(repository: SQLiteAIBudgetPolicyRepository, resourceId: string): ResourceState {
    if (repository.getById(resourceId)) throw new ChangeManagementError("CHANGE_CONFLICT", "The Budget Policy identifier is already in use.");
    return { resourceId, revision: 0, snapshot: {} };
  }
}
function snapshotFromContent(content: AIBudgetPolicy | AIBudgetPolicyContent): ChangeSnapshot {
  return structuredClone({
    key: content.key,
    displayName: content.displayName,
    currency: content.currency,
    costCenter: content.costCenter,
    hardCapNano: content.hardCapNano,
    enabled: content.enabled,
  }) as ChangeSnapshot;
}

function assertStableIdentity(
  current: Pick<AIBudgetPolicyContent, "key" | "currency" | "costCenter"> | ChangeSnapshot,
  next: AIBudgetPolicyContent,
): void {
  if (current.key !== next.key || current.currency !== next.currency || current.costCenter !== next.costCenter) {
    throw new AIBudgetPolicyError("AI_BUDGET_POLICY_INVALID", "Budget Policy key, currency, and cost center are immutable after creation.");
  }
}

function assertUuid(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", `${field} must be a stable UUID.`);
}

function mapPolicyError(error: unknown): Error {
  if (error instanceof ChangeManagementError) return error;
  if (error instanceof AIBudgetPolicyError) {
    return new ChangeManagementError(
      error.code === "AI_BUDGET_POLICY_CONFLICT" ? "CHANGE_CONFLICT" : "CHANGE_VALIDATION_FAILED",
      error.message,
      error,
    );
  }
  return error instanceof Error
    ? new ChangeManagementError("CHANGE_PUBLICATION_FAILED", "The Budget Policy operation failed.", error)
    : new ChangeManagementError("CHANGE_PUBLICATION_FAILED", "The Budget Policy operation failed.");
}
