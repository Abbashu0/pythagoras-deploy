import { eq } from "drizzle-orm";

import type { AdminActor } from "../../../admin-auth/contracts";
import type { ChangeOperation, ChangePresentation, ChangeResourceAdapter, ChangeSnapshot, ResourceState } from "../../../change-management/contracts";
import { ChangeManagementError } from "../../../change-management/errors";
import { deriveChangedPaths, validateChangeSnapshot } from "../../../change-management/snapshot";
import type { ContentDatabase } from "../../../content/database";
import { canonicalMaterials } from "../../../content/schema";
import { SQLiteAIModelConfigRepository } from "../../model-registry";
import { SQLiteAIProviderConfigRepository } from "../../configuration";
import { SQLiteAIContextPolicyRepository } from "../../policy";
import { SQLiteAIRetrievalConfigRepository } from "../../retrieval-config";
import { SQLiteAIBudgetPolicyRepository } from "../../budget";
import { SQLiteAIRateLimitPolicyRepository } from "../../rate-limits";
import { AI_TUTOR_CITATION_PROTOCOL_KEY, AI_TUTOR_CITATION_PROTOCOL_REVISION, AI_TUTOR_CONFIG_RESOURCE_TYPE, AI_TUTOR_GROUNDING_PROTOCOL_KEY, AI_TUTOR_GROUNDING_PROTOCOL_REVISION, type AITutorConfig, type AITutorConfigContent, type AITutorConfigSnapshot } from "./contracts";
import { AITutorConfigError } from "./errors";
import { SQLiteAITutorConfigRepository } from "./sqlite-repository";
import { normalizeAITutorConfigContent, normalizeAITutorConfigSnapshot } from "./validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const FIELD_LABELS: Record<string, string> = {
  key: "Tutor Config key",
  subjectKey: "Subject",
  displayName: "Display name",
  enabled: "Enabled state",
  generationModelConfigId: "Generation Model",
  contextPolicyId: "Context Policy",
  retrievalConfigId: "Retrieval Config",
  budgetPolicyId: "Budget Policy",
  rateLimitPolicyId: "Rate Limit Policy",
  maxOutputTokens: "Maximum output tokens",
  fallbackGenerationModelConfigIds: "Fallback Generation Models",
};

export class AITutorConfigChangeAdapter implements ChangeResourceAdapter {
  readonly resourceType = AI_TUTOR_CONFIG_RESOURCE_TYPE;
  readonly areaLabel = "AI / Tutor Configuration";
  readonly mergeStrategy = "THREE_WAY" as const;

  loadCurrent(database: ContentDatabase, resourceId: string): ResourceState {
    assertUuid(resourceId, "resourceId");
    const config = new SQLiteAITutorConfigRepository(database).getById(resourceId);
    if (!config) throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Tutor Config was not found.");
    return { resourceId: config.id, revision: config.currentRevision, snapshot: snapshotFromContent(config) };
  }

  captureProposal(database: ContentDatabase, resourceId: string, desired: unknown, operation: ChangeOperation = "UPDATE") {
    assertUuid(resourceId, "resourceId");
    const repository = new SQLiteAITutorConfigRepository(database);
    const current = operation === "CREATE" ? this.emptyCreateState(repository, resourceId) : this.loadCurrent(database, resourceId);
    try {
      const content = normalizeAITutorConfigContent(desired);
      assertDependencies(database, content);
      if (operation === "UPDATE" && (current.snapshot.key !== content.key || current.snapshot.subjectKey !== content.subjectKey)) throw new AITutorConfigError("AI_TUTOR_CONFIG_CONFLICT", "Tutor Config key and subject are immutable after creation.");
      const proposedSnapshot = snapshotFromContent(content);
      validateChangeSnapshot(proposedSnapshot);
      const changedPaths = deriveChangedPaths(current.snapshot, proposedSnapshot);
      if (!changedPaths.length) throw new AITutorConfigError("AI_TUTOR_CONFIG_INVALID", "The Tutor Config proposal does not change any fields.");
      return { current, proposedSnapshot, changedPaths };
    } catch (error) {
      throw mapTutorConfigError(error);
    }
  }

  validateSnapshot(snapshot: ChangeSnapshot): void {
    try {
      validateChangeSnapshot(snapshot);
      normalizeAITutorConfigSnapshot(snapshot);
    } catch (error) {
      throw mapTutorConfigError(error);
    }
  }

  describe(resourceId: string, before: ChangeSnapshot, proposed: ChangeSnapshot, operation: ChangeOperation = "UPDATE"): ChangePresentation {
    const after = normalizeAITutorConfigSnapshot(proposed);
    const previous = operation === "CREATE" && Object.keys(before).length === 0 ? null : normalizeAITutorConfigSnapshot(before);
    if (previous && (previous.key !== after.key || previous.subjectKey !== after.subjectKey)) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "Tutor Config key and subject are immutable after creation.");
    const changedPaths = deriveChangedPaths(previous ? snapshotFromContent(previous) : {}, snapshotFromContent(after));
    return {
      resourceLabel: after.displayName,
      resourceSubtitle: operation === "CREATE" ? "New governed Tutor Config" : `Tutor Config · ${resourceId}`,
      changeSummary: `${changedPaths.length} changed field${changedPaths.length === 1 ? "" : "s"}`,
      areaLabel: this.areaLabel,
      fieldDiffs: changedPaths.map((path) => ({ path, label: FIELD_LABELS[path] ?? path, before: previous ? snapshotFromContent(previous)[path] : undefined, after: snapshotFromContent(after)[path] })),
    };
  }

  apply(database: ContentDatabase, resourceId: string, value: ChangeSnapshot, expectedRevision: number, actor: AdminActor, operation: ChangeOperation = "UPDATE"): ResourceState {
    if (actor.actorRole !== "OWNER") throw new ChangeManagementError("CHANGE_AUTHORIZATION_FAILED", "Only OWNER may publish Tutor Configs.");
    assertUuid(resourceId, "resourceId");
    let snapshot: AITutorConfigSnapshot;
    let content: AITutorConfigContent;
    try {
      snapshot = normalizeAITutorConfigSnapshot(value);
      content = contentFromSnapshot(snapshot);
      assertDependencies(database, content);
    } catch (error) {
      throw mapTutorConfigError(error);
    }
    const repository = new SQLiteAITutorConfigRepository(database);
    const current = operation === "UPDATE" ? repository.getById(resourceId) : null;
    if (operation === "UPDATE") {
      if (!current) throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Tutor Config was not found.");
      if (current.key !== content.key || current.subjectKey !== content.subjectKey) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "Tutor Config key and subject are immutable after creation.");
    }
    try {
      const revision = operation === "CREATE"
        ? repository.create({ id: resourceId, content, actor, now: Date.now() })
        : repository.appendRevision({ id: resourceId, expectedRevision, content, actor, now: Date.now() });
      const config = repository.getById(resourceId);
      if (!config) throw new AITutorConfigError("AI_TUTOR_CONFIG_INVALID", "The published Tutor Config could not be read.");
      return { resourceId, revision: revision.revision, snapshot: snapshotFromContent(config) };
    } catch (error) {
      throw mapTutorConfigError(error);
    }
  }

  validatePublication(database: ContentDatabase): void {
    for (const config of new SQLiteAITutorConfigRepository(database).list()) assertDependencies(database, contentFromConfig(config));
  }

  private emptyCreateState(repository: SQLiteAITutorConfigRepository, resourceId: string): ResourceState {
    if (repository.getById(resourceId)) throw new ChangeManagementError("CHANGE_CONFLICT", "The Tutor Config identifier is already in use.");
    return { resourceId, revision: 0, snapshot: {} };
  }
}

function snapshotFromContent(content: AITutorConfig | AITutorConfigContent | AITutorConfigSnapshot): ChangeSnapshot {
  return structuredClone({
    key: content.key,
    subjectKey: content.subjectKey,
    displayName: content.displayName,
    enabled: content.enabled,
    generationModelConfigId: content.generationModelConfigId,
    contextPolicyId: content.contextPolicyId,
    retrievalConfigId: content.retrievalConfigId,
    budgetPolicyId: content.budgetPolicyId,
    rateLimitPolicyId: content.rateLimitPolicyId,
    maxOutputTokens: content.maxOutputTokens,
    fallbackGenerationModelConfigIds: [...(content.fallbackGenerationModelConfigIds ?? [])],
    groundingProtocolKey: "groundingProtocolKey" in content ? content.groundingProtocolKey : AI_TUTOR_GROUNDING_PROTOCOL_KEY,
    groundingProtocolRevision: "groundingProtocolRevision" in content ? content.groundingProtocolRevision : AI_TUTOR_GROUNDING_PROTOCOL_REVISION,
    citationProtocolKey: "citationProtocolKey" in content ? content.citationProtocolKey : AI_TUTOR_CITATION_PROTOCOL_KEY,
    citationProtocolRevision: "citationProtocolRevision" in content ? content.citationProtocolRevision : AI_TUTOR_CITATION_PROTOCOL_REVISION,
  }) as ChangeSnapshot;
}

function contentFromSnapshot(snapshot: AITutorConfigSnapshot): AITutorConfigContent {
  const { groundingProtocolKey: _groundingKey, groundingProtocolRevision: _groundingRevision, citationProtocolKey: _citationKey, citationProtocolRevision: _citationRevision, ...content } = snapshot;
  return content;
}

function contentFromConfig(config: AITutorConfig): AITutorConfigContent {
  return {
    key: config.key,
    subjectKey: config.subjectKey,
    displayName: config.displayName,
    enabled: config.enabled,
    generationModelConfigId: config.generationModelConfigId,
    contextPolicyId: config.contextPolicyId,
    retrievalConfigId: config.retrievalConfigId,
    budgetPolicyId: config.budgetPolicyId,
    rateLimitPolicyId: config.rateLimitPolicyId,
    maxOutputTokens: config.maxOutputTokens,
    fallbackGenerationModelConfigIds: [...config.fallbackGenerationModelConfigIds],
  };
}

function assertDependencies(database: ContentDatabase, content: AITutorConfigContent): void {
  if (!database.db.select({ subjectKey: canonicalMaterials.subjectKey }).from(canonicalMaterials).where(eq(canonicalMaterials.subjectKey, content.subjectKey)).get()) throw new AITutorConfigError("AI_TUTOR_CONFIG_SUBJECT_MISMATCH", "The Tutor Config subject is not canonical.");
  const model = new SQLiteAIModelConfigRepository(database).getById(content.generationModelConfigId);
  if (!model || model.capability !== "GENERATION" || !model.enabled || !model.supportsStreaming || model.contextWindowTokens === null || model.maxOutputTokens === null || content.maxOutputTokens > model.maxOutputTokens) throw new AITutorConfigError("AI_TUTOR_CONFIG_DEPENDENCY_INVALID", "The Tutor Config generation Model is not an enabled streaming model with sufficient limits.");
  const provider = new SQLiteAIProviderConfigRepository(database).getById(model.providerConfigId);
  if (!provider || !provider.enabled || !provider.credentialRef) throw new AITutorConfigError("AI_TUTOR_CONFIG_DEPENDENCY_INVALID", "The Tutor Config generation Provider is not configured for execution.");
  const fallbackIds = content.fallbackGenerationModelConfigIds ?? [];
  if (fallbackIds.includes(content.generationModelConfigId) || new Set(fallbackIds).size !== fallbackIds.length) throw new AITutorConfigError("AI_TUTOR_CONFIG_DEPENDENCY_INVALID", "Tutor fallback Models must be distinct from the primary Model and from each other.");
  for (const fallbackId of fallbackIds) {
    const fallback = new SQLiteAIModelConfigRepository(database).getById(fallbackId);
    if (!fallback || fallback.capability !== "GENERATION" || !fallback.enabled || !fallback.supportsStreaming || fallback.contextWindowTokens === null || fallback.maxOutputTokens === null || content.maxOutputTokens > fallback.maxOutputTokens) throw new AITutorConfigError("AI_TUTOR_CONFIG_DEPENDENCY_INVALID", "A Tutor fallback Model is not an enabled streaming model with sufficient limits.");
    const fallbackProvider = new SQLiteAIProviderConfigRepository(database).getById(fallback.providerConfigId);
    if (!fallbackProvider || !fallbackProvider.enabled || !fallbackProvider.credentialRef) throw new AITutorConfigError("AI_TUTOR_CONFIG_DEPENDENCY_INVALID", "A Tutor fallback Provider is not configured for execution.");
  }
  const context = new SQLiteAIContextPolicyRepository(database).getById(content.contextPolicyId);
  if (!context || !context.enabled) throw new AITutorConfigError("AI_TUTOR_CONFIG_DEPENDENCY_INVALID", "The Tutor Config Context Policy is not enabled.");
  const retrieval = new SQLiteAIRetrievalConfigRepository(database).getById(content.retrievalConfigId);
  if (!retrieval || !retrieval.enabled || retrieval.subjectKey !== content.subjectKey) throw new AITutorConfigError("AI_TUTOR_CONFIG_DEPENDENCY_INVALID", "The Tutor Config Retrieval Config is not enabled for its subject.");
  const budget = new SQLiteAIBudgetPolicyRepository(database).getCurrentRevision(content.budgetPolicyId);
  if (!budget || !budget.enabled || budget.costCenter !== "STUDENT_GENERATION") throw new AITutorConfigError("AI_TUTOR_CONFIG_DEPENDENCY_INVALID", "The Tutor Config Budget Policy is not an enabled Student Generation policy.");
  const rateLimit = new SQLiteAIRateLimitPolicyRepository(database).getCurrentRevision(content.rateLimitPolicyId);
  if (!rateLimit || !rateLimit.enabled) throw new AITutorConfigError("AI_TUTOR_CONFIG_DEPENDENCY_INVALID", "The Tutor Config Rate Limit Policy is not enabled.");
}

function assertUuid(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", `${field} must be a stable UUID.`);
}

function mapTutorConfigError(error: unknown): Error {
  if (error instanceof ChangeManagementError) return error;
  if (error instanceof AITutorConfigError) {
    const code = error.code === "AI_TUTOR_CONFIG_CONFLICT" ? "CHANGE_CONFLICT" : error.code === "AI_TUTOR_CONFIG_NOT_FOUND" ? "CHANGE_NOT_FOUND" : "CHANGE_VALIDATION_FAILED";
    return new ChangeManagementError(code, error.message, error);
  }
  return error instanceof Error ? new ChangeManagementError("CHANGE_PUBLICATION_FAILED", "The Tutor Config operation failed.", error) : new ChangeManagementError("CHANGE_PUBLICATION_FAILED", "The Tutor Config operation failed.");
}
