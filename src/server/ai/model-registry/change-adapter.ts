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
import { SQLiteAIProviderConfigRepository } from "../configuration/sqlite-repository";
import {
  AI_MODEL_CONFIG_RESOURCE_TYPE,
  type AIModelConfig,
  type AIModelConfigContent,
} from "./contracts";
import { AIModelConfigError } from "./errors";
import { SQLiteAIModelConfigRepository } from "./sqlite-repository";
import { normalizeAIModelConfigContent } from "./validation";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const FIELD_LABELS: Record<string, string> = {
  key: "Model key",
  displayName: "Display name",
  providerConfigId: "Provider configuration",
  providerModelId: "Provider model identifier",
  capability: "Capability",
  adapterKey: "Adapter key",
  enabled: "Enabled state",
  contextWindowTokens: "Context window",
  maxOutputTokens: "Maximum output",
  embeddingDimensions: "Embedding dimensions",
  supportsStreaming: "Streaming support",
  supportsReasoning: "Reasoning support",
  supportsStructuredOutput: "Structured output support",
  inputModalities: "Input modalities",
  outputModalities: "Output modalities",
};

export class AIModelConfigChangeAdapter implements ChangeResourceAdapter {
  readonly resourceType = AI_MODEL_CONFIG_RESOURCE_TYPE;
  readonly areaLabel = "AI / Model registry";
  readonly mergeStrategy = "THREE_WAY" as const;

  loadCurrent(database: ContentDatabase, resourceId: string): ResourceState {
    assertUuid(resourceId, "resourceId");
    const config = new SQLiteAIModelConfigRepository(database).getById(resourceId);
    if (!config) {
      throw new ChangeManagementError(
        "CHANGE_NOT_FOUND",
        "The AI Model configuration was not found.",
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
    const repository = new SQLiteAIModelConfigRepository(database);
    const current = operation === "CREATE"
      ? this.emptyCreateState(repository, resourceId)
      : this.loadCurrent(database, resourceId);
    try {
      const content = normalizeAIModelConfigContent(desired);
      if (operation === "UPDATE" && current.snapshot.key !== content.key) {
        throw new AIModelConfigError(
          "AI_MODEL_CONFIG_INVALID",
          "Model key is immutable after creation.",
        );
      }
      const proposedSnapshot = snapshotFromContent(content);
      validateChangeSnapshot(proposedSnapshot);
      const changedPaths = deriveChangedPaths(current.snapshot, proposedSnapshot);
      if (!changedPaths.length) {
        throw new AIModelConfigError(
          "AI_MODEL_CONFIG_INVALID",
          "The AI Model proposal does not change any fields.",
        );
      }
      return { current, proposedSnapshot, changedPaths };
    } catch (error) {
      throw mapModelError(error);
    }
  }

  validateSnapshot(snapshot: ChangeSnapshot): void {
    try {
      validateChangeSnapshot(snapshot);
      normalizeAIModelConfigContent(snapshot);
    } catch (error) {
      throw mapModelError(error);
    }
  }

  describe(
    resourceId: string,
    before: ChangeSnapshot,
    proposed: ChangeSnapshot,
    operation: ChangeOperation = "UPDATE",
  ): ChangePresentation {
    const after = normalizeAIModelConfigContent(proposed);
    const previous = operation === "CREATE" && Object.keys(before).length === 0
      ? null
      : normalizeAIModelConfigContent(before);
    if (previous && previous.key !== after.key) {
      throw new ChangeManagementError(
        "CHANGE_VALIDATION_FAILED",
        "Model key is immutable after creation.",
      );
    }
    const changedPaths = deriveChangedPaths(
      previous ? snapshotFromContent(previous) : {},
      snapshotFromContent(after),
    );
    return {
      resourceLabel: after.displayName,
      resourceSubtitle: operation === "CREATE"
        ? "New governed Model configuration"
        : `Model configuration · ${resourceId}`,
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
        "Only OWNER may publish AI Model configuration.",
      );
    }
    assertUuid(resourceId, "resourceId");
    const content = normalizeAIModelConfigContent(value);
    const providers = new SQLiteAIProviderConfigRepository(database);
    if (!providers.getById(content.providerConfigId)) {
      throw new ChangeManagementError(
        "CHANGE_VALIDATION_FAILED",
        "The referenced AI Provider configuration was not found.",
      );
    }
    const repository = new SQLiteAIModelConfigRepository(database);
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
      throw mapModelError(error);
    }
  }

  validatePublication(database: ContentDatabase): void {
    const providers = new SQLiteAIProviderConfigRepository(database);
    for (const model of new SQLiteAIModelConfigRepository(database).list()) {
      if (!providers.getById(model.providerConfigId)) {
        throw new ChangeManagementError(
          "CHANGE_VALIDATION_FAILED",
          "An AI Model configuration references a missing Provider configuration.",
        );
      }
    }
  }

  private emptyCreateState(
    repository: SQLiteAIModelConfigRepository,
    resourceId: string,
  ): ResourceState {
    if (repository.getById(resourceId)) {
      throw new ChangeManagementError(
        "CHANGE_CONFLICT",
        "The AI Model configuration identifier is already in use.",
      );
    }
    return { resourceId, revision: 0, snapshot: {} };
  }

  private updateExisting(
    repository: SQLiteAIModelConfigRepository,
    resourceId: string,
    content: AIModelConfigContent,
    expectedRevision: number,
    actor: AdminActor,
  ): AIModelConfig {
    const current = repository.getById(resourceId);
    if (!current) {
      throw new ChangeManagementError(
        "CHANGE_NOT_FOUND",
        "The AI Model configuration was not found.",
      );
    }
    if (current.key !== content.key) {
      throw new ChangeManagementError(
        "CHANGE_VALIDATION_FAILED",
        "Model key is immutable after creation.",
      );
    }
    return repository.update({
      id: resourceId,
      content,
      expectedRevision,
      actor,
      now: Date.now(),
    });
  }
}

function snapshotFromContent(
  content: AIModelConfig | AIModelConfigContent,
): ChangeSnapshot {
  return structuredClone({
    key: content.key,
    displayName: content.displayName,
    providerConfigId: content.providerConfigId,
    providerModelId: content.providerModelId,
    capability: content.capability,
    adapterKey: content.adapterKey,
    enabled: content.enabled,
    contextWindowTokens: content.contextWindowTokens,
    maxOutputTokens: content.maxOutputTokens,
    embeddingDimensions: content.embeddingDimensions,
    supportsStreaming: content.supportsStreaming,
    supportsReasoning: content.supportsReasoning,
    supportsStructuredOutput: content.supportsStructuredOutput,
    inputModalities: content.inputModalities ?? ["TEXT"],
    outputModalities: content.outputModalities ?? ["TEXT"],
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

function mapModelError(error: unknown): Error {
  if (error instanceof ChangeManagementError) return error;
  if (error instanceof AIModelConfigError) {
    return new ChangeManagementError(
      error.code === "AI_MODEL_CONFIG_CONFLICT"
        ? "CHANGE_CONFLICT"
        : "CHANGE_VALIDATION_FAILED",
      error.message,
      error,
    );
  }
  return error instanceof Error
    ? new ChangeManagementError(
        "CHANGE_PUBLICATION_FAILED",
        "The AI Model configuration operation failed.",
        error,
      )
    : new ChangeManagementError(
        "CHANGE_PUBLICATION_FAILED",
        "The AI Model configuration operation failed.",
      );
}
