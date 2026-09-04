import { eq } from "drizzle-orm";

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
import { canonicalMaterials } from "../../content/schema";
import { AIMemoryError } from "./contracts";
import {
  AI_MEMORY_POLICY_RESOURCE_TYPE,
  type AIMemoryPolicy,
  type AIMemoryPolicyContent,
} from "./contracts";
import { SQLiteAIMemoryPolicyRepository } from "./policy-repository";
import { normalizeAIMemoryPolicyContent } from "./policy-validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FIELD_LABELS: Record<string, string> = {
  key: "Memory Policy key",
  subjectKey: "Subject",
  displayName: "Display name",
  enabled: "Enabled state",
  candidateReviewRequired: "Candidate review requirement",
  retentionDays: "Retention days",
  maxSelectedMemories: "Maximum selected memories",
};

export class AIMemoryPolicyChangeAdapter implements ChangeResourceAdapter {
  readonly resourceType = AI_MEMORY_POLICY_RESOURCE_TYPE;
  readonly areaLabel = "AI / Memory Policies";
  readonly mergeStrategy = "THREE_WAY" as const;

  loadCurrent(database: ContentDatabase, resourceId: string): ResourceState {
    assertUuid(resourceId, "resourceId");
    const policy = new SQLiteAIMemoryPolicyRepository(database).getById(resourceId);
    if (!policy) throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Memory Policy was not found.");
    return { resourceId: policy.id, revision: policy.currentRevision, snapshot: snapshotFromContent(policy) };
  }

  captureProposal(database: ContentDatabase, resourceId: string, desired: unknown, operation: ChangeOperation = "UPDATE") {
    assertUuid(resourceId, "resourceId");
    const repository = new SQLiteAIMemoryPolicyRepository(database);
    const current = operation === "CREATE" ? this.emptyCreateState(repository, resourceId) : this.loadCurrent(database, resourceId);
    try {
      const content = normalizeAIMemoryPolicyContent(desired);
      assertSubjectExists(database, content.subjectKey);
      if (operation === "CREATE" && repository.getBySubjectKey(content.subjectKey)) throw new AIMemoryError("AI_MEMORY_SCOPE_MISMATCH", "A Memory Policy already exists for this subject.");
      if (operation === "UPDATE" && (current.snapshot.key !== content.key || current.snapshot.subjectKey !== content.subjectKey)) throw new AIMemoryError("AI_MEMORY_SCOPE_MISMATCH", "Memory Policy key and subject are immutable after creation.");
      const proposedSnapshot = snapshotFromContent(content);
      validateChangeSnapshot(proposedSnapshot);
      const changedPaths = deriveChangedPaths(current.snapshot, proposedSnapshot);
      if (!changedPaths.length) throw new AIMemoryError("AI_MEMORY_INVALID", "The Memory Policy proposal does not change any fields.");
      return { current, proposedSnapshot, changedPaths };
    } catch (error) {
      throw mapMemoryError(error);
    }
  }

  validateSnapshot(snapshot: ChangeSnapshot): void {
    try {
      validateChangeSnapshot(snapshot);
      const content = normalizeAIMemoryPolicyContent(snapshot);
      if (!content.subjectKey) throw new AIMemoryError("AI_MEMORY_SCOPE_MISMATCH", "Memory Policy subject is required.");
    } catch (error) {
      throw mapMemoryError(error);
    }
  }

  describe(resourceId: string, before: ChangeSnapshot, proposed: ChangeSnapshot, operation: ChangeOperation = "UPDATE"): ChangePresentation {
    const after = normalizeAIMemoryPolicyContent(proposed);
    const previous = operation === "CREATE" && Object.keys(before).length === 0 ? null : normalizeAIMemoryPolicyContent(before);
    if (previous && (previous.key !== after.key || previous.subjectKey !== after.subjectKey)) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "Memory Policy key and subject are immutable after creation.");
    const changedPaths = deriveChangedPaths(previous ? snapshotFromContent(previous) : {}, snapshotFromContent(after));
    return {
      resourceLabel: after.displayName,
      resourceSubtitle: operation === "CREATE" ? "New governed Memory Policy" : `Memory Policy · ${resourceId}`,
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
    if (actor.actorRole !== "OWNER") throw new ChangeManagementError("CHANGE_AUTHORIZATION_FAILED", "Only OWNER may publish Memory Policies.");
    assertUuid(resourceId, "resourceId");
    const content = normalizeAIMemoryPolicyContent(value);
    assertSubjectExists(database, content.subjectKey);
    const repository = new SQLiteAIMemoryPolicyRepository(database);
    const current = operation === "UPDATE" ? repository.getById(resourceId) : null;
    if (operation === "UPDATE") {
      if (!current) throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Memory Policy was not found.");
      if (current.key !== content.key || current.subjectKey !== content.subjectKey) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "Memory Policy key and subject are immutable after creation.");
    }
    try {
      const revision = operation === "CREATE"
        ? repository.create({ id: resourceId, content, actor, now: Date.now() })
        : repository.appendRevision({ id: resourceId, expectedRevision, content, actor, now: Date.now() });
      const policy = repository.getById(resourceId);
      if (!policy) throw new AIMemoryError("AI_MEMORY_INVALID", "The published Memory Policy could not be read.");
      return { resourceId, revision: revision.revision, snapshot: snapshotFromContent(policy) };
    } catch (error) {
      throw mapMemoryError(error);
    }
  }

  validatePublication(database: ContentDatabase): void {
    const repository = new SQLiteAIMemoryPolicyRepository(database);
    for (const policy of repository.list()) {
      if (!repository.getCurrentRevision(policy.id)) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "A Memory Policy current revision is missing.");
    }
  }

  private emptyCreateState(repository: SQLiteAIMemoryPolicyRepository, resourceId: string): ResourceState {
    if (repository.getById(resourceId)) throw new ChangeManagementError("CHANGE_CONFLICT", "The Memory Policy identifier is already in use.");
    return { resourceId, revision: 0, snapshot: {} };
  }
}

function snapshotFromContent(content: AIMemoryPolicy | AIMemoryPolicyContent): ChangeSnapshot {
  return structuredClone({
    key: content.key,
    subjectKey: content.subjectKey,
    displayName: content.displayName,
    enabled: content.enabled,
    candidateReviewRequired: content.candidateReviewRequired,
    retentionDays: content.retentionDays,
    maxSelectedMemories: content.maxSelectedMemories,
  }) as ChangeSnapshot;
}

function assertSubjectExists(database: ContentDatabase, subjectKey: string): void {
  const exists = database.db.select({ subjectKey: canonicalMaterials.subjectKey }).from(canonicalMaterials)
    .where(eq(canonicalMaterials.subjectKey, subjectKey)).get();
  if (!exists) throw new AIMemoryError("AI_MEMORY_SCOPE_MISMATCH", "The Memory Policy subject is not canonical.");
}

function assertUuid(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", `${field} must be a stable UUID.`);
}

function mapMemoryError(error: unknown): Error {
  if (error instanceof ChangeManagementError) return error;
  if (error instanceof AIMemoryError) {
    return new ChangeManagementError(
      error.code === "AI_MEMORY_LIFECYCLE_CONFLICT" ? "CHANGE_CONFLICT" : "CHANGE_VALIDATION_FAILED",
      error.message,
      error,
    );
  }
  return error instanceof Error
    ? new ChangeManagementError("CHANGE_PUBLICATION_FAILED", "The Memory Policy operation failed.", error)
    : new ChangeManagementError("CHANGE_PUBLICATION_FAILED", "The Memory Policy operation failed.");
}
