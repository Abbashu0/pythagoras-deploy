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
import { AIPolicyError } from "./errors";
import {
  AI_INSTRUCTION_POLICY_RESOURCE_TYPE,
  type AIInstructionPolicy,
  type AIInstructionPolicyContent,
} from "./instruction-contracts";
import { SQLiteAIInstructionPolicyRepository } from "./instruction-repository";
import { normalizeAIInstructionPolicyContent } from "./instruction-validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FIELD_LABELS: Record<string, string> = {
  key: "Instruction Policy key",
  scope: "Scope",
  subjectKey: "Subject",
  displayName: "Display name",
  instructions: "Instructions",
  enabled: "Enabled state",
};

export class AIInstructionPolicyChangeAdapter implements ChangeResourceAdapter {
  readonly resourceType = AI_INSTRUCTION_POLICY_RESOURCE_TYPE;
  readonly areaLabel = "AI / Instruction Policies";
  readonly mergeStrategy = "THREE_WAY" as const;

  loadCurrent(database: ContentDatabase, resourceId: string): ResourceState {
    assertUuid(resourceId, "resourceId");
    const policy = new SQLiteAIInstructionPolicyRepository(database).getById(resourceId);
    if (!policy) throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Instruction Policy was not found.");
    return { resourceId: policy.id, revision: policy.currentRevision, snapshot: snapshotFromContent(policy) };
  }

  captureProposal(database: ContentDatabase, resourceId: string, desired: unknown, operation: ChangeOperation = "UPDATE") {
    assertUuid(resourceId, "resourceId");
    const repository = new SQLiteAIInstructionPolicyRepository(database);
    const current = operation === "CREATE" ? this.emptyCreateState(repository, resourceId) : this.loadCurrent(database, resourceId);
    try {
      const content = normalizeAIInstructionPolicyContent(desired);
      assertSubjectExists(database, content);
      if (operation === "CREATE" && repository.getByScope(content.scope, content.subjectKey)) {
        throw new AIPolicyError("AI_POLICY_SCOPE_CONFLICT", "An Instruction Policy already exists for this scope.");
      }
      if (operation === "UPDATE") assertStableIdentity(current.snapshot, content);
      const proposedSnapshot = snapshotFromContent(content);
      validateChangeSnapshot(proposedSnapshot);
      const changedPaths = deriveChangedPaths(current.snapshot, proposedSnapshot);
      if (!changedPaths.length) throw new AIPolicyError("AI_POLICY_INVALID", "The Instruction Policy proposal does not change any fields.");
      return { current, proposedSnapshot, changedPaths };
    } catch (error) {
      throw mapPolicyError(error);
    }
  }

  validateSnapshot(snapshot: ChangeSnapshot): void {
    try {
      validateChangeSnapshot(snapshot);
      normalizeAIInstructionPolicyContent(snapshot);
    } catch (error) {
      throw mapPolicyError(error);
    }
  }

  describe(resourceId: string, before: ChangeSnapshot, proposed: ChangeSnapshot, operation: ChangeOperation = "UPDATE"): ChangePresentation {
    const after = normalizeAIInstructionPolicyContent(proposed);
    const previous = operation === "CREATE" && Object.keys(before).length === 0 ? null : normalizeAIInstructionPolicyContent(before);
    if (previous) assertStableIdentity(previous, after);
    const changedPaths = deriveChangedPaths(previous ? snapshotFromContent(previous) : {}, snapshotFromContent(after));
    return {
      resourceLabel: after.displayName,
      resourceSubtitle: operation === "CREATE" ? "New governed Instruction Policy" : `Instruction Policy · ${resourceId}`,
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
    if (actor.actorRole !== "OWNER") throw new ChangeManagementError("CHANGE_AUTHORIZATION_FAILED", "Only OWNER may publish Instruction Policies.");
    assertUuid(resourceId, "resourceId");
    const content = normalizeAIInstructionPolicyContent(value);
    assertSubjectExists(database, content);
    const repository = new SQLiteAIInstructionPolicyRepository(database);
    const current = operation === "UPDATE" ? repository.getById(resourceId) : null;
    if (operation === "UPDATE") {
      if (!current) throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Instruction Policy was not found.");
      assertStableIdentity(current, content);
    }
    try {
      const revision = operation === "CREATE"
        ? repository.create({ id: resourceId, content, actor, now: Date.now() })
        : repository.appendRevision({ id: resourceId, expectedRevision, content, actor, now: Date.now() });
      const policy = repository.getById(resourceId);
      if (!policy) throw new AIPolicyError("AI_POLICY_INVALID", "The published Instruction Policy could not be read.");
      return { resourceId, revision: revision.revision, snapshot: snapshotFromContent(policy) };
    } catch (error) {
      throw mapPolicyError(error);
    }
  }

  validatePublication(database: ContentDatabase): void {
    const repository = new SQLiteAIInstructionPolicyRepository(database);
    for (const policy of repository.list()) {
      if (!repository.getCurrentRevision(policy.id)) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "An Instruction Policy current revision is missing.");
    }
  }

  private emptyCreateState(repository: SQLiteAIInstructionPolicyRepository, resourceId: string): ResourceState {
    if (repository.getById(resourceId)) throw new ChangeManagementError("CHANGE_CONFLICT", "The Instruction Policy identifier is already in use.");
    return { resourceId, revision: 0, snapshot: {} };
  }
}

function snapshotFromContent(content: AIInstructionPolicy | AIInstructionPolicyContent): ChangeSnapshot {
  return structuredClone({
    key: content.key,
    scope: content.scope,
    subjectKey: content.subjectKey,
    displayName: content.displayName,
    instructions: content.instructions,
    enabled: content.enabled,
    ...(content.authoring ? { authoring: content.authoring } : {}),
  }) as unknown as ChangeSnapshot;
}

function assertStableIdentity(current: Pick<AIInstructionPolicyContent, "key" | "scope" | "subjectKey"> | ChangeSnapshot, next: AIInstructionPolicyContent): void {
  if (current.key !== next.key || current.scope !== next.scope || current.subjectKey !== next.subjectKey) {
    throw new AIPolicyError("AI_POLICY_INVALID", "Instruction Policy key, scope, and subject are immutable after creation.");
  }
}

function assertSubjectExists(database: ContentDatabase, content: AIInstructionPolicyContent): void {
  if (content.scope === "GLOBAL") return;
  const exists = database.db.select({ subjectKey: canonicalMaterials.subjectKey }).from(canonicalMaterials)
    .where(eq(canonicalMaterials.subjectKey, content.subjectKey!)).get();
  if (!exists) throw new AIPolicyError("AI_POLICY_SUBJECT_MISMATCH", "The Instruction Policy subject is not a canonical Material.");
}

function assertUuid(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", `${field} must be a stable UUID.`);
}

function mapPolicyError(error: unknown): Error {
  if (error instanceof ChangeManagementError) return error;
  if (error instanceof AIPolicyError) {
    return new ChangeManagementError(
      error.code === "AI_POLICY_CONFLICT" ? "CHANGE_CONFLICT" : "CHANGE_VALIDATION_FAILED",
      error.message,
      error,
    );
  }
  return error instanceof Error
    ? new ChangeManagementError("CHANGE_PUBLICATION_FAILED", "The Instruction Policy operation failed.", error)
    : new ChangeManagementError("CHANGE_PUBLICATION_FAILED", "The Instruction Policy operation failed.");
}
