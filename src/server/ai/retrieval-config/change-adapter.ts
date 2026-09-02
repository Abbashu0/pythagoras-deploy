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
import { SQLiteAIModelConfigRepository } from "../model-registry";
import { AI_RETRIEVAL_CONFIG_RESOURCE_TYPE, type AIRetrievalConfig, type AIRetrievalConfigContent } from "./contracts";
import { AIRetrievalConfigError } from "./errors";
import { SQLiteAIRetrievalConfigRepository } from "./sqlite-repository";
import { normalizeAIRetrievalConfigContent } from "./validation";
import { AI_RETRIEVAL_FUSION_ALGORITHM_KEY, AI_RETRIEVAL_FUSION_ALGORITHM_REVISION } from "./contracts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FIELD_LABELS: Record<string, string> = {
  key: "Retrieval Config key",
  subjectKey: "Subject",
  displayName: "Display name",
  enabled: "Enabled state",
  embeddingModelConfigId: "Embedding Model",
  rerankModelConfigId: "Rerank Model",
  lexicalCandidateLimit: "Lexical candidate limit",
  semanticCandidateLimit: "Semantic candidate limit",
  fusionCandidateLimit: "Fusion candidate limit",
  rerankCandidateLimit: "Rerank candidate limit",
  evidenceItemLimit: "Evidence item limit",
  rrfConstant: "RRF constant",
  lexicalWeightUnits: "Lexical weight",
  semanticWeightUnits: "Semantic weight",
  minimumFusedScoreUnits: "Minimum fused score",
  minimumEvidenceItemCount: "Minimum evidence item count",
  maximumEvidencePackBytes: "Maximum EvidencePack bytes",
  maxEvidenceChunksPerSourceItem: "Maximum chunks per source item",
  allowedTrustTiers: "Allowed trust tiers",
  semanticFailureBehavior: "Semantic failure behavior",
  rerankerFailureBehavior: "Reranker failure behavior",
  fusionAlgorithmKey: "Fusion algorithm",
  fusionAlgorithmRevision: "Fusion algorithm revision",
};

export class AIRetrievalConfigChangeAdapter implements ChangeResourceAdapter {
  readonly resourceType = AI_RETRIEVAL_CONFIG_RESOURCE_TYPE;
  readonly areaLabel = "AI / Retrieval Configuration";
  readonly mergeStrategy = "THREE_WAY" as const;

  loadCurrent(database: ContentDatabase, resourceId: string): ResourceState {
    assertUuid(resourceId, "resourceId");
    const config = new SQLiteAIRetrievalConfigRepository(database).getById(resourceId);
    if (!config) throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Retrieval Config was not found.");
    return { resourceId: config.id, revision: config.currentRevision, snapshot: snapshotFromContent(config) };
  }

  captureProposal(database: ContentDatabase, resourceId: string, desired: unknown, operation: ChangeOperation = "UPDATE") {
    assertUuid(resourceId, "resourceId");
    const repository = new SQLiteAIRetrievalConfigRepository(database);
    const current = operation === "CREATE" ? this.emptyCreateState(repository, resourceId) : this.loadCurrent(database, resourceId);
    try {
      const content = normalizeAIRetrievalConfigContent(desired);
      assertModelsAndSubject(database, content);
      if (operation === "UPDATE" && (current.snapshot.key !== content.key || current.snapshot.subjectKey !== content.subjectKey)) throw new AIRetrievalConfigError("AI_RETRIEVAL_CONFIG_CONFLICT", "Retrieval Config key and subject are immutable after creation.");
      const proposedSnapshot = snapshotFromContent(content);
      validateChangeSnapshot(proposedSnapshot);
      const changedPaths = deriveChangedPaths(current.snapshot, proposedSnapshot);
      if (!changedPaths.length) throw new AIRetrievalConfigError("AI_RETRIEVAL_CONFIG_INVALID", "The Retrieval Config proposal does not change any fields.");
      return { current, proposedSnapshot, changedPaths };
    } catch (error) {
      throw mapRetrievalConfigError(error);
    }
  }

  validateSnapshot(snapshot: ChangeSnapshot): void {
    try {
      validateChangeSnapshot(snapshot);
      normalizeAIRetrievalConfigContent(snapshot);
      if (("fusionAlgorithmKey" in snapshot && snapshot.fusionAlgorithmKey !== AI_RETRIEVAL_FUSION_ALGORITHM_KEY) || ("fusionAlgorithmRevision" in snapshot && snapshot.fusionAlgorithmRevision !== AI_RETRIEVAL_FUSION_ALGORITHM_REVISION)) throw new AIRetrievalConfigError("AI_RETRIEVAL_CONFIG_INVALID", "The Retrieval Config fusion algorithm is server-owned.");
    } catch (error) {
      throw mapRetrievalConfigError(error);
    }
  }

  describe(resourceId: string, before: ChangeSnapshot, proposed: ChangeSnapshot, operation: ChangeOperation = "UPDATE"): ChangePresentation {
    const after = normalizeAIRetrievalConfigContent(proposed);
    const previous = operation === "CREATE" && Object.keys(before).length === 0 ? null : normalizeAIRetrievalConfigContent(before);
    if (previous && (previous.key !== after.key || previous.subjectKey !== after.subjectKey)) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "Retrieval Config key and subject are immutable after creation.");
    const changedPaths = deriveChangedPaths(previous ? snapshotFromContent(previous) : {}, snapshotFromContent(after));
    return {
      resourceLabel: after.displayName,
      resourceSubtitle: operation === "CREATE" ? "New governed Retrieval Config" : `Retrieval Config Â· ${resourceId}`,
      changeSummary: `${changedPaths.length} changed field${changedPaths.length === 1 ? "" : "s"}`,
      areaLabel: this.areaLabel,
      fieldDiffs: changedPaths.map((path) => ({ path, label: FIELD_LABELS[path] ?? path, before: previous ? snapshotFromContent(previous)[path] : undefined, after: snapshotFromContent(after)[path] })),
    };
  }

  apply(database: ContentDatabase, resourceId: string, value: ChangeSnapshot, expectedRevision: number, actor: AdminActor, operation: ChangeOperation = "UPDATE"): ResourceState {
    if (actor.actorRole !== "OWNER") throw new ChangeManagementError("CHANGE_AUTHORIZATION_FAILED", "Only OWNER may publish Retrieval Configs.");
    assertUuid(resourceId, "resourceId");
    const content = normalizeAIRetrievalConfigContent(value);
    assertModelsAndSubject(database, content);
    const repository = new SQLiteAIRetrievalConfigRepository(database);
    const current = operation === "UPDATE" ? repository.getById(resourceId) : null;
    if (operation === "UPDATE") {
      if (!current) throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Retrieval Config was not found.");
      if (current.key !== content.key || current.subjectKey !== content.subjectKey) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "Retrieval Config key and subject are immutable after creation.");
    }
    try {
      const revision = operation === "CREATE"
        ? repository.create({ id: resourceId, content, actor, now: Date.now() })
        : repository.appendRevision({ id: resourceId, expectedRevision, content, actor, now: Date.now() });
      const config = repository.getById(resourceId);
      if (!config) throw new AIRetrievalConfigError("AI_RETRIEVAL_CONFIG_INVALID", "The published Retrieval Config could not be read.");
      return { resourceId, revision: revision.revision, snapshot: snapshotFromContent(config) };
    } catch (error) {
      throw mapRetrievalConfigError(error);
    }
  }

  validatePublication(database: ContentDatabase): void {
    const repository = new SQLiteAIRetrievalConfigRepository(database);
    for (const config of repository.list()) {
      if (!repository.getCurrentRevision(config.id)) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "A Retrieval Config current revision is missing.");
      assertModelsAndSubject(database, config);
    }
  }

  private emptyCreateState(repository: SQLiteAIRetrievalConfigRepository, resourceId: string): ResourceState {
    if (repository.getById(resourceId)) throw new ChangeManagementError("CHANGE_CONFLICT", "The Retrieval Config identifier is already in use.");
    return { resourceId, revision: 0, snapshot: {} };
  }
}

function snapshotFromContent(content: AIRetrievalConfig | AIRetrievalConfigContent): ChangeSnapshot {
  const fusionAlgorithmKey = "fusionAlgorithmKey" in content ? content.fusionAlgorithmKey : AI_RETRIEVAL_FUSION_ALGORITHM_KEY;
  const fusionAlgorithmRevision = "fusionAlgorithmRevision" in content ? content.fusionAlgorithmRevision : AI_RETRIEVAL_FUSION_ALGORITHM_REVISION;
  return structuredClone({
    key: content.key,
    subjectKey: content.subjectKey,
    displayName: content.displayName,
    enabled: content.enabled,
    embeddingModelConfigId: content.embeddingModelConfigId,
    rerankModelConfigId: content.rerankModelConfigId,
    lexicalCandidateLimit: content.lexicalCandidateLimit,
    semanticCandidateLimit: content.semanticCandidateLimit,
    fusionCandidateLimit: content.fusionCandidateLimit,
    rerankCandidateLimit: content.rerankCandidateLimit,
    evidenceItemLimit: content.evidenceItemLimit,
    rrfConstant: content.rrfConstant,
    lexicalWeightUnits: content.lexicalWeightUnits,
    semanticWeightUnits: content.semanticWeightUnits,
    minimumFusedScoreUnits: content.minimumFusedScoreUnits,
    minimumEvidenceItemCount: content.minimumEvidenceItemCount,
    maximumEvidencePackBytes: content.maximumEvidencePackBytes,
    maxEvidenceChunksPerSourceItem: content.maxEvidenceChunksPerSourceItem,
    allowedTrustTiers: [...content.allowedTrustTiers],
    semanticFailureBehavior: content.semanticFailureBehavior,
    rerankerFailureBehavior: content.rerankerFailureBehavior,
    fusionAlgorithmKey,
    fusionAlgorithmRevision,
  }) as ChangeSnapshot;
}

function assertModelsAndSubject(database: ContentDatabase, content: AIRetrievalConfigContent | AIRetrievalConfig): void {
  assertModelsAndSubjectFromContent(database, content);
}

function assertModelsAndSubjectFromContent(database: ContentDatabase, content: AIRetrievalConfigContent): void {
  if (!database.db.select({ subjectKey: canonicalMaterials.subjectKey }).from(canonicalMaterials).where(eq(canonicalMaterials.subjectKey, content.subjectKey)).get()) throw new AIRetrievalConfigError("AI_RETRIEVAL_CONFIG_SUBJECT_MISMATCH", "The Retrieval Config subject is not canonical.");
  const models = new SQLiteAIModelConfigRepository(database);
  const embedding = models.getById(content.embeddingModelConfigId);
  if (!embedding || embedding.capability !== "EMBEDDING") throw new AIRetrievalConfigError("AI_RETRIEVAL_CONFIG_MODEL_INVALID", "The Retrieval Config embedding model must declare EMBEDDING capability.");
  if (content.rerankModelConfigId !== null) {
    const reranker = models.getById(content.rerankModelConfigId);
    if (!reranker || reranker.capability !== "RERANK") throw new AIRetrievalConfigError("AI_RETRIEVAL_CONFIG_MODEL_INVALID", "The Retrieval Config reranker must declare RERANK capability.");
  }
}

function assertUuid(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", `${field} must be a stable UUID.`);
}

function mapRetrievalConfigError(error: unknown): Error {
  if (error instanceof ChangeManagementError) return error;
  if (error instanceof AIRetrievalConfigError) {
    return new ChangeManagementError(error.code === "AI_RETRIEVAL_CONFIG_CONFLICT" ? "CHANGE_CONFLICT" : "CHANGE_VALIDATION_FAILED", error.message, error);
  }
  return error instanceof Error ? new ChangeManagementError("CHANGE_PUBLICATION_FAILED", "The Retrieval Config operation failed.", error) : new ChangeManagementError("CHANGE_PUBLICATION_FAILED", "The Retrieval Config operation failed.");
}
