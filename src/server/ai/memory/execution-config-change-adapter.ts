import { eq } from "drizzle-orm";

import type { AdminActor } from "../../admin-auth/contracts";
import type { ChangeOperation, ChangePresentation, ChangeResourceAdapter, ChangeSnapshot, ResourceState } from "../../change-management/contracts";
import { ChangeManagementError } from "../../change-management/errors";
import { deriveChangedPaths, validateChangeSnapshot } from "../../change-management/snapshot";
import type { ContentDatabase } from "../../content/database";
import { canonicalMaterials } from "../../content/schema";
import { SQLiteAIProviderConfigRepository } from "../configuration";
import { SQLiteAIBudgetPolicyRepository } from "../budget";
import { SQLiteAIModelConfigRepository } from "../model-registry";
import { SQLiteAIRateLimitPolicyRepository } from "../rate-limits";
import { AIMemoryExecutionConfigError } from "./execution-config-errors";
import { AI_MEMORY_EXECUTION_CONFIG_RESOURCE_TYPE, type AIMemoryExecutionConfig, type AIMemoryExecutionConfigContent } from "./execution-contracts";
import { SQLiteAIMemoryExecutionConfigRepository } from "./execution-config-repository";
import { normalizeAIMemoryExecutionConfigContent } from "./execution-config-validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const FIELD_LABELS: Record<string, string> = {
  key: "Execution Config key",
  subjectKey: "Subject",
  displayName: "Display name",
  enabled: "Enabled state",
  generationModelConfigId: "Generation Model",
  generationModelConfigRevision: "Generation Model revision",
  generationProviderConfigId: "Generation Provider",
  generationProviderConfigRevision: "Generation Provider revision",
  budgetPolicyId: "Budget Policy",
  budgetPolicyRevision: "Budget Policy revision",
  rateLimitPolicyId: "Rate Limit Policy",
  rateLimitPolicyRevision: "Rate Limit Policy revision",
  timeoutMs: "Timeout",
  extractionMaxOutputTokens: "Extraction output limit",
  compactionMaxOutputTokens: "Compaction output limit",
  maxExtractionCandidates: "Maximum candidates",
  autoApprovalMinConfidenceUnits: "Automatic approval confidence",
  compactionTriggerMessageCount: "Compaction trigger",
  compactionRetainRecentMessageCount: "Compaction retained messages",
};

export class AIMemoryExecutionConfigChangeAdapter implements ChangeResourceAdapter {
  readonly resourceType = AI_MEMORY_EXECUTION_CONFIG_RESOURCE_TYPE;
  readonly areaLabel = "AI / Memory Execution Configuration";
  readonly mergeStrategy = "THREE_WAY" as const;

  loadCurrent(database: ContentDatabase, resourceId: string): ResourceState {
    assertUuid(resourceId, "resourceId");
    const config = new SQLiteAIMemoryExecutionConfigRepository(database).getById(resourceId);
    if (!config) throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Memory Execution Config was not found.");
    return { resourceId: config.id, revision: config.currentRevision, snapshot: snapshotFromContent(config) };
  }

  captureProposal(database: ContentDatabase, resourceId: string, desired: unknown, operation: ChangeOperation = "UPDATE") {
    assertUuid(resourceId, "resourceId");
    const repository = new SQLiteAIMemoryExecutionConfigRepository(database);
    const current = operation === "CREATE" ? this.emptyCreateState(repository, resourceId) : this.loadCurrent(database, resourceId);
    try {
      const content = normalizeAIMemoryExecutionConfigContent(desired);
      assertDependencies(database, content);
      if (operation === "CREATE" && repository.getBySubjectKey(content.subjectKey)) throw new AIMemoryExecutionConfigError("AI_MEMORY_EXECUTION_CONFIG_CONFLICT", "A Memory Execution Config already exists for this subject.");
      if (operation === "UPDATE" && (current.snapshot.key !== content.key || current.snapshot.subjectKey !== content.subjectKey)) throw new AIMemoryExecutionConfigError("AI_MEMORY_EXECUTION_CONFIG_CONFLICT", "Execution Config key and subject are immutable after creation.");
      const proposedSnapshot = snapshotFromContent(content);
      validateChangeSnapshot(proposedSnapshot);
      const changedPaths = deriveChangedPaths(current.snapshot, proposedSnapshot);
      if (!changedPaths.length) throw new AIMemoryExecutionConfigError("AI_MEMORY_EXECUTION_CONFIG_INVALID", "The Memory Execution Config proposal does not change any fields.");
      return { current, proposedSnapshot, changedPaths };
    } catch (error) {
      throw mapError(error);
    }
  }

  validateSnapshot(snapshot: ChangeSnapshot): void {
    try {
      validateChangeSnapshot(snapshot);
      assertDependenciesFromContentShape(normalizeAIMemoryExecutionConfigContent(snapshot));
    } catch (error) {
      throw mapError(error);
    }
  }

  describe(resourceId: string, before: ChangeSnapshot, proposed: ChangeSnapshot, operation: ChangeOperation = "UPDATE"): ChangePresentation {
    const after = normalizeAIMemoryExecutionConfigContent(proposed);
    const previous = operation === "CREATE" && Object.keys(before).length === 0 ? null : normalizeAIMemoryExecutionConfigContent(before);
    if (previous && (previous.key !== after.key || previous.subjectKey !== after.subjectKey)) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "Execution Config key and subject are immutable after creation.");
    const changedPaths = deriveChangedPaths(previous ? snapshotFromContent(previous) : {}, snapshotFromContent(after));
    return {
      resourceLabel: after.displayName,
      resourceSubtitle: operation === "CREATE" ? "New governed Memory Execution Config" : `Memory Execution Config · ${resourceId}`,
      changeSummary: `${changedPaths.length} changed field${changedPaths.length === 1 ? "" : "s"}`,
      areaLabel: this.areaLabel,
      fieldDiffs: changedPaths.map((path) => ({ path, label: FIELD_LABELS[path] ?? path, before: previous ? snapshotFromContent(previous)[path] : undefined, after: snapshotFromContent(after)[path] })),
    };
  }

  apply(database: ContentDatabase, resourceId: string, value: ChangeSnapshot, expectedRevision: number, actor: AdminActor, operation: ChangeOperation = "UPDATE"): ResourceState {
    if (actor.actorRole !== "OWNER") throw new ChangeManagementError("CHANGE_AUTHORIZATION_FAILED", "Only OWNER may publish Memory Execution Configs.");
    assertUuid(resourceId, "resourceId");
    let content: AIMemoryExecutionConfigContent;
    try {
      content = normalizeAIMemoryExecutionConfigContent(value);
      assertDependencies(database, content);
    } catch (error) {
      throw mapError(error);
    }
    const repository = new SQLiteAIMemoryExecutionConfigRepository(database);
    const current = operation === "UPDATE" ? repository.getById(resourceId) : null;
    if (operation === "UPDATE") {
      if (!current) throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Memory Execution Config was not found.");
      if (current.key !== content.key || current.subjectKey !== content.subjectKey) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "Execution Config key and subject are immutable after creation.");
    }
    try {
      const revision = operation === "CREATE"
        ? repository.create({ id: resourceId, content, actor, now: Date.now() })
        : repository.appendRevision({ id: resourceId, expectedRevision, content, actor, now: Date.now() });
      const config = repository.getById(resourceId);
      if (!config) throw new AIMemoryExecutionConfigError("AI_MEMORY_EXECUTION_CONFIG_INVALID", "The published Memory Execution Config could not be read.");
      return { resourceId, revision: revision.revision, snapshot: snapshotFromContent(config) };
    } catch (error) {
      throw mapError(error);
    }
  }

  validatePublication(database: ContentDatabase): void {
    for (const config of new SQLiteAIMemoryExecutionConfigRepository(database).list()) assertDependencies(database, contentFromConfig(config));
  }

  private emptyCreateState(repository: SQLiteAIMemoryExecutionConfigRepository, resourceId: string): ResourceState {
    if (repository.getById(resourceId)) throw new ChangeManagementError("CHANGE_CONFLICT", "The Memory Execution Config identifier is already in use.");
    return { resourceId, revision: 0, snapshot: {} };
  }
}

function snapshotFromContent(content: AIMemoryExecutionConfig | AIMemoryExecutionConfigContent): ChangeSnapshot {
  return structuredClone({
    key: content.key,
    subjectKey: content.subjectKey,
    displayName: content.displayName,
    enabled: content.enabled,
    generationModelConfigId: content.generationModelConfigId,
    generationModelConfigRevision: content.generationModelConfigRevision,
    generationProviderConfigId: content.generationProviderConfigId,
    generationProviderConfigRevision: content.generationProviderConfigRevision,
    budgetPolicyId: content.budgetPolicyId,
    budgetPolicyRevision: content.budgetPolicyRevision,
    rateLimitPolicyId: content.rateLimitPolicyId,
    rateLimitPolicyRevision: content.rateLimitPolicyRevision,
    timeoutMs: content.timeoutMs,
    extractionMaxOutputTokens: content.extractionMaxOutputTokens,
    compactionMaxOutputTokens: content.compactionMaxOutputTokens,
    maxExtractionCandidates: content.maxExtractionCandidates,
    autoApprovalMinConfidenceUnits: content.autoApprovalMinConfidenceUnits,
    compactionTriggerMessageCount: content.compactionTriggerMessageCount,
    compactionRetainRecentMessageCount: content.compactionRetainRecentMessageCount,
  }) as ChangeSnapshot;
}

function contentFromConfig(config: AIMemoryExecutionConfig): AIMemoryExecutionConfigContent {
  return snapshotToContent(snapshotFromContent(config));
}

function snapshotToContent(value: ChangeSnapshot): AIMemoryExecutionConfigContent {
  return normalizeAIMemoryExecutionConfigContent(value);
}

function assertDependencies(database: ContentDatabase, content: AIMemoryExecutionConfigContent): void {
  assertSubject(database, content.subjectKey);
  const model = new SQLiteAIModelConfigRepository(database).getById(content.generationModelConfigId);
  const provider = model ? new SQLiteAIProviderConfigRepository(database).getById(content.generationProviderConfigId) : null;
  if (!model || model.revision !== content.generationModelConfigRevision || model.capability !== "GENERATION" || !model.enabled || !model.supportsStreaming || !model.supportsStructuredOutput || model.maxOutputTokens === null || content.extractionMaxOutputTokens > model.maxOutputTokens || content.compactionMaxOutputTokens > model.maxOutputTokens || model.providerConfigId !== content.generationProviderConfigId || !provider || provider.revision !== content.generationProviderConfigRevision || !provider.enabled || !provider.credentialRef) throw new AIMemoryExecutionConfigError("AI_MEMORY_EXECUTION_CONFIG_DEPENDENCY_INVALID", "The pinned Generation Model and Provider are not executable.");
  const budget = new SQLiteAIBudgetPolicyRepository(database).getRevision(content.budgetPolicyId, content.budgetPolicyRevision);
  if (!budget || !budget.enabled || budget.costCenter !== "STUDENT_GENERATION") throw new AIMemoryExecutionConfigError("AI_MEMORY_EXECUTION_CONFIG_DEPENDENCY_INVALID", "The pinned Budget Policy is not an enabled Student Generation policy.");
  const rate = new SQLiteAIRateLimitPolicyRepository(database).getRevision(content.rateLimitPolicyId, content.rateLimitPolicyRevision);
  if (!rate || !rate.enabled) throw new AIMemoryExecutionConfigError("AI_MEMORY_EXECUTION_CONFIG_DEPENDENCY_INVALID", "The pinned Rate Limit Policy is not enabled.");
}

function assertDependenciesFromContentShape(content: AIMemoryExecutionConfigContent): void {
  if (!content.subjectKey) throw new AIMemoryExecutionConfigError("AI_MEMORY_EXECUTION_CONFIG_SUBJECT_MISMATCH", "The Memory Execution Config subject is required.");
}

function assertSubject(database: ContentDatabase, subjectKey: string): void {
  if (!database.db.select({ subjectKey: canonicalMaterials.subjectKey }).from(canonicalMaterials).where(eq(canonicalMaterials.subjectKey, subjectKey)).get()) throw new AIMemoryExecutionConfigError("AI_MEMORY_EXECUTION_CONFIG_SUBJECT_MISMATCH", "The Memory Execution Config subject is not canonical.");
}

function assertUuid(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", `${field} must be a stable UUID.`);
}

function mapError(error: unknown): Error {
  if (error instanceof ChangeManagementError) return error;
  if (error instanceof AIMemoryExecutionConfigError) {
    const code = error.code === "AI_MEMORY_EXECUTION_CONFIG_CONFLICT" ? "CHANGE_CONFLICT" : error.code === "AI_MEMORY_EXECUTION_CONFIG_NOT_FOUND" ? "CHANGE_NOT_FOUND" : "CHANGE_VALIDATION_FAILED";
    return new ChangeManagementError(code, error.message, error);
  }
  return error instanceof Error ? new ChangeManagementError("CHANGE_PUBLICATION_FAILED", "The Memory Execution Config operation failed.", error) : new ChangeManagementError("CHANGE_PUBLICATION_FAILED", "The Memory Execution Config operation failed.");
}
