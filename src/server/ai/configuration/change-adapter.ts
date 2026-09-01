import type { AdminActor } from "../../admin-auth/contracts";
import type {
  ChangeOperation,
  ChangePresentation,
  ChangeResourceAdapter,
  ChangeSnapshot,
  ResourceState,
} from "../../change-management/contracts";
import { ChangeManagementError } from "../../change-management/errors";
import {
  deriveChangedPaths,
  validateChangeSnapshot,
} from "../../change-management/snapshot";
import type { ContentDatabase } from "../../content/database";
import { SQLiteAISecretMetadataRepository } from "../secrets/sqlite-repository";
import type { AIProviderConfigContent } from "./contracts";
import {
  AI_PROVIDER_CONFIG_RESOURCE_TYPE,
  type AIProviderConfig,
} from "./contracts";
import { AIProviderConfigError } from "./errors";
import {
  normalizeAIProviderConfigContent,
} from "./validation";
import { SQLiteAIProviderConfigRepository } from "./sqlite-repository";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const FIELD_LABELS: Record<string, string> = {
  key: "Provider key",
  displayName: "Display name",
  baseUrl: "Base URL",
  credentialRef: "Credential reference",
  enabled: "Enabled state",
  retentionPolicy: "Retention policy",
  trainingPolicy: "Training policy",
  zdrSupported: "Zero-data-retention support",
  zdrRequired: "Zero-data-retention requirement",
};

export class AIProviderConfigChangeAdapter implements ChangeResourceAdapter {
  readonly resourceType = AI_PROVIDER_CONFIG_RESOURCE_TYPE;
  readonly areaLabel = "AI / Provider configuration";
  readonly mergeStrategy = "THREE_WAY" as const;

  loadCurrent(database: ContentDatabase, resourceId: string): ResourceState {
    assertUuid(resourceId, "resourceId");
    const config = new SQLiteAIProviderConfigRepository(database).getById(resourceId);
    if (!config) {
      throw new ChangeManagementError(
        "CHANGE_NOT_FOUND",
        "The AI Provider configuration was not found.",
      );
    }
    return {
      resourceId: config.id,
      revision: config.revision,
      snapshot: snapshotFromContent(config),
    };
  }

  captureProposal(
    database: ContentDatabase,
    resourceId: string,
    desired: unknown,
    operation: ChangeOperation = "UPDATE",
  ) {
    assertUuid(resourceId, "resourceId");
    const repository = new SQLiteAIProviderConfigRepository(database);
    const current = operation === "CREATE"
      ? this.emptyCreateState(repository, resourceId)
      : this.loadCurrent(database, resourceId);
    try {
      const content = normalizeAIProviderConfigContent(desired);
      if (operation === "UPDATE" && current.snapshot.key !== content.key) {
        throw new AIProviderConfigError(
          "AI_PROVIDER_CONFIG_INVALID",
          "Provider key is immutable after creation.",
        );
      }
      const proposedSnapshot = snapshotFromContent(content);
      validateChangeSnapshot(proposedSnapshot);
      const changedPaths = deriveChangedPaths(current.snapshot, proposedSnapshot);
      if (!changedPaths.length) {
        throw new AIProviderConfigError(
          "AI_PROVIDER_CONFIG_INVALID",
          "The AI Provider proposal does not change any fields.",
        );
      }
      return { current, proposedSnapshot, changedPaths };
    } catch (error) {
      throw mapConfigError(error);
    }
  }

  validateSnapshot(snapshot: ChangeSnapshot): void {
    try {
      validateChangeSnapshot(snapshot);
      normalizeAIProviderConfigContent(snapshot);
    } catch (error) {
      throw mapConfigError(error);
    }
  }

  describe(
    resourceId: string,
    before: ChangeSnapshot,
    proposed: ChangeSnapshot,
    operation: ChangeOperation = "UPDATE",
  ): ChangePresentation {
    const after = normalizeAIProviderConfigContent(proposed);
    const previous = operation === "CREATE" && Object.keys(before).length === 0
      ? null
      : normalizeAIProviderConfigContent(before);
    if (previous && previous.key !== after.key) {
      throw new ChangeManagementError(
        "CHANGE_VALIDATION_FAILED",
        "Provider key is immutable after creation.",
      );
    }
    const changedPaths = deriveChangedPaths(
      previous ? snapshotFromContent(previous) : {},
      snapshotFromContent(after),
    );
    return {
      resourceLabel: after.displayName,
      resourceSubtitle: operation === "CREATE"
        ? "New governed Provider configuration"
        : `Provider configuration · ${resourceId}`,
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
    if (actor.actorRole !== "OWNER") {
      throw new ChangeManagementError(
        "CHANGE_AUTHORIZATION_FAILED",
        "Only OWNER may publish AI Provider configuration.",
      );
    }
    assertUuid(resourceId, "resourceId");
    const content = normalizeAIProviderConfigContent(value);
    const repository = new SQLiteAIProviderConfigRepository(database);
    if (content.credentialRef) {
      const metadata = new SQLiteAISecretMetadataRepository(database).get(content.credentialRef);
      if (!metadata) {
        throw new ChangeManagementError(
          "CHANGE_VALIDATION_FAILED",
          "The Provider credential reference is not available.",
        );
      }
    }
    try {
      const config = operation === "CREATE"
        ? repository.create({ id: resourceId, content, actor, now: Date.now() })
        : this.updateExisting(repository, resourceId, content, expectedRevision, actor);
      return {
        resourceId: config.id,
        revision: config.revision,
        snapshot: snapshotFromContent(config),
      };
    } catch (error) {
      throw mapConfigError(error);
    }
  }

  validatePublication(database: ContentDatabase): void {
    const configs = new SQLiteAIProviderConfigRepository(database).list();
    const secrets = new SQLiteAISecretMetadataRepository(database);
    for (const config of configs) {
      if (!config.enabled || !config.credentialRef) continue;
      const metadata = secrets.get(config.credentialRef);
      if (!metadata || metadata.status !== "ACTIVE") {
        throw new ChangeManagementError(
          "CHANGE_VALIDATION_FAILED",
          "An enabled AI Provider configuration requires an active credential reference.",
        );
      }
    }
  }

  private emptyCreateState(
    repository: SQLiteAIProviderConfigRepository,
    resourceId: string,
  ): ResourceState {
    if (repository.getById(resourceId)) {
      throw new ChangeManagementError(
        "CHANGE_CONFLICT",
        "The AI Provider configuration identifier is already in use.",
      );
    }
    return { resourceId, revision: 0, snapshot: {} };
  }

  private updateExisting(
    repository: SQLiteAIProviderConfigRepository,
    resourceId: string,
    content: AIProviderConfigContent,
    expectedRevision: number,
    actor: AdminActor,
  ): AIProviderConfig {
    const current = repository.getById(resourceId);
    if (!current) {
      throw new ChangeManagementError(
        "CHANGE_NOT_FOUND",
        "The AI Provider configuration was not found.",
      );
    }
    if (current.key !== content.key) {
      throw new ChangeManagementError(
        "CHANGE_VALIDATION_FAILED",
        "Provider key is immutable after creation.",
      );
    }
    try {
      return repository.update({
        id: resourceId,
        content,
        expectedRevision,
        actor,
        now: Date.now(),
      });
    } catch (error) {
      throw mapConfigError(error);
    }
  }
}

function snapshotFromContent(
  content: AIProviderConfig | AIProviderConfigContent,
): ChangeSnapshot {
  return structuredClone({
    key: content.key,
    displayName: content.displayName,
    baseUrl: content.baseUrl,
    credentialRef: content.credentialRef,
    enabled: content.enabled,
    retentionPolicy: content.retentionPolicy,
    trainingPolicy: content.trainingPolicy,
    zdrSupported: content.zdrSupported,
    zdrRequired: content.zdrRequired,
  }) as ChangeSnapshot;
}

function assertUuid(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new ChangeManagementError(
      "CHANGE_VALIDATION_FAILED",
      `${field} must be a stable UUID.`,
    );
  }
}

function mapConfigError(error: unknown): Error {
  if (error instanceof ChangeManagementError) return error;
  if (error instanceof AIProviderConfigError) {
    return new ChangeManagementError(
      error.code === "AI_PROVIDER_CONFIG_CONFLICT"
        ? "CHANGE_CONFLICT"
        : "CHANGE_VALIDATION_FAILED",
      error.message,
      error,
    );
  }
  return error instanceof Error
    ? new ChangeManagementError(
        "CHANGE_PUBLICATION_FAILED",
        "The AI Provider configuration operation failed.",
        error,
      )
    : new ChangeManagementError(
        "CHANGE_PUBLICATION_FAILED",
        "The AI Provider configuration operation failed.",
      );
}
