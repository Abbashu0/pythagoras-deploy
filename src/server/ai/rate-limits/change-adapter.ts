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
  AI_RATE_LIMIT_POLICY_RESOURCE_TYPE,
  type AIRateLimitPolicy,
  type AIRateLimitPolicyContent,
} from "./contracts";
import { AIRateLimitPolicyError } from "./errors";
import { normalizeAIRateLimitPolicyContent } from "./validation";
import { SQLiteAIRateLimitPolicyRepository } from "./sqlite-policy-repository";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const FIELD_LABELS: Record<string, string> = {
  key: "Rate Limit Policy key",
  displayName: "Display name",
  windowMs: "Window",
  maxRequests: "Maximum requests",
  maxConcurrentRequests: "Maximum concurrent requests",
  enabled: "Enabled state",
};

export class AIRateLimitPolicyChangeAdapter implements ChangeResourceAdapter {
  readonly resourceType = AI_RATE_LIMIT_POLICY_RESOURCE_TYPE;
  readonly areaLabel = "AI / Rate Limits";
  readonly mergeStrategy = "THREE_WAY" as const;

  loadCurrent(database: ContentDatabase, resourceId: string): ResourceState {
    assertUuid(resourceId, "resourceId");
    const policy = new SQLiteAIRateLimitPolicyRepository(database).getById(resourceId);
    if (!policy) throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Rate Limit Policy was not found.");
    return { resourceId: policy.id, revision: policy.currentRevision, snapshot: snapshotFromContent(policy) };
  }

  captureProposal(
    database: ContentDatabase,
    resourceId: string,
    desired: unknown,
    operation: ChangeOperation = "UPDATE",
  ) {
    assertUuid(resourceId, "resourceId");
    const repository = new SQLiteAIRateLimitPolicyRepository(database);
    const current = operation === "CREATE" ? this.emptyCreateState(repository, resourceId) : this.loadCurrent(database, resourceId);
    try {
      const content = normalizeAIRateLimitPolicyContent(desired);
      if (operation === "UPDATE" && current.snapshot.key !== content.key) {
        throw new AIRateLimitPolicyError("AI_RATE_LIMIT_POLICY_INVALID", "Rate Limit Policy key is immutable after creation.");
      }
      const proposedSnapshot = snapshotFromContent(content);
      validateChangeSnapshot(proposedSnapshot);
      const changedPaths = deriveChangedPaths(current.snapshot, proposedSnapshot);
      if (!changedPaths.length) throw new AIRateLimitPolicyError("AI_RATE_LIMIT_POLICY_INVALID", "The Rate Limit Policy proposal does not change any fields.");
      return { current, proposedSnapshot, changedPaths };
    } catch (error) {
      throw mapPolicyError(error);
    }
  }

  validateSnapshot(snapshot: ChangeSnapshot): void {
    try {
      validateChangeSnapshot(snapshot);
      normalizeAIRateLimitPolicyContent(snapshot);
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
    const after = normalizeAIRateLimitPolicyContent(proposed);
    const previous = operation === "CREATE" && Object.keys(before).length === 0 ? null : normalizeAIRateLimitPolicyContent(before);
    if (previous && previous.key !== after.key) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "Rate Limit Policy key is immutable after creation.");
    const changedPaths = deriveChangedPaths(previous ? snapshotFromContent(previous) : {}, snapshotFromContent(after));
    return {
      resourceLabel: after.displayName,
      resourceSubtitle: operation === "CREATE" ? "New governed Rate Limit Policy" : `Rate Limit Policy · ${resourceId}`,
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
    if (actor.actorRole !== "OWNER") throw new ChangeManagementError("CHANGE_AUTHORIZATION_FAILED", "Only OWNER may publish Rate Limit Policies.");
    assertUuid(resourceId, "resourceId");
    const content = normalizeAIRateLimitPolicyContent(value);
    const repository = new SQLiteAIRateLimitPolicyRepository(database);
    const current = operation === "UPDATE" ? repository.getCurrentRevision(resourceId) : null;
    if (operation === "UPDATE") {
      if (!current) throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Rate Limit Policy was not found.");
      if (current.key !== content.key) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "Rate Limit Policy key is immutable after creation.");
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
    const repository = new SQLiteAIRateLimitPolicyRepository(database);
    for (const policy of repository.list()) {
      if (!repository.getCurrentRevision(policy.id)) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "A Rate Limit Policy current revision is missing.");
    }
  }

  private emptyCreateState(repository: SQLiteAIRateLimitPolicyRepository, resourceId: string): ResourceState {
    if (repository.getById(resourceId)) throw new ChangeManagementError("CHANGE_CONFLICT", "The Rate Limit Policy identifier is already in use.");
    return { resourceId, revision: 0, snapshot: {} };
  }
}
function snapshotFromContent(content: AIRateLimitPolicy | AIRateLimitPolicyContent): ChangeSnapshot {
  return structuredClone({
    key: content.key,
    displayName: content.displayName,
    windowMs: content.windowMs,
    maxRequests: content.maxRequests,
    maxConcurrentRequests: content.maxConcurrentRequests,
    enabled: content.enabled,
  }) as ChangeSnapshot;
}

function assertUuid(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", `${field} must be a stable UUID.`);
}

function mapPolicyError(error: unknown): Error {
  if (error instanceof ChangeManagementError) return error;
  if (error instanceof AIRateLimitPolicyError) {
    return new ChangeManagementError(
      error.code === "AI_RATE_LIMIT_POLICY_CONFLICT" ? "CHANGE_CONFLICT" : "CHANGE_VALIDATION_FAILED",
      error.message,
      error,
    );
  }
  return error instanceof Error
    ? new ChangeManagementError("CHANGE_PUBLICATION_FAILED", "The Rate Limit Policy operation failed.", error)
    : new ChangeManagementError("CHANGE_PUBLICATION_FAILED", "The Rate Limit Policy operation failed.");
}
