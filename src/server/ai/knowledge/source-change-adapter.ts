import { eq } from "drizzle-orm";
import type { AdminActor } from "../../admin-auth/contracts";
import type { ChangeOperation, ChangePresentation, ChangeResourceAdapter, ChangeSnapshot, ResourceState } from "../../change-management/contracts";
import { ChangeManagementError } from "../../change-management/errors";
import { deriveChangedPaths, validateChangeSnapshot } from "../../change-management/snapshot";
import type { ContentDatabase } from "../../content/database";
import { canonicalMaterials } from "../../content/schema";
import { SQLiteAssetRepository } from "../../assets/sqlite-asset-repository";
import { AIKnowledgeError } from "./errors";
import { AI_KNOWLEDGE_SOURCE_RESOURCE_TYPE, type AIKnowledgeSource, type AIKnowledgeSourceContent } from "./contracts";
import { SQLiteAIKnowledgeSourceRepository } from "./source-repository";
import { normalizeAIKnowledgeSourceContent } from "./validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FIELD_LABELS: Record<string, string> = {
  key: "Knowledge Source key",
  subjectKey: "Subject",
  sourceType: "Source type",
  displayName: "Display name",
  language: "Language",
  edition: "Edition",
  authorityName: "Authority",
  authorityType: "Authority type",
  trustTier: "Trust tier",
  rightsStatus: "Rights status",
  rightsBasis: "Rights basis",
  licenseName: "License",
  attribution: "Attribution",
  rightsNotes: "Rights notes",
  sourceUrl: "Source URL",
  sourceAssetId: "Source asset",
  enabled: "Enabled state",
  preparationMethod: "Preparation method",
  producerKey: "Producer key",
  producerRevision: "Producer revision",
};

export class AIKnowledgeSourceChangeAdapter implements ChangeResourceAdapter {
  readonly resourceType = AI_KNOWLEDGE_SOURCE_RESOURCE_TYPE;
  readonly areaLabel = "AI / Knowledge Sources";
  readonly mergeStrategy = "THREE_WAY" as const;

  loadCurrent(database: ContentDatabase, resourceId: string): ResourceState {
    assertUuid(resourceId, "resourceId");
    const source = new SQLiteAIKnowledgeSourceRepository(database).getById(resourceId);
    if (!source) throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Knowledge Source was not found.");
    return { resourceId, revision: source.currentRevision, snapshot: snapshotFromContent(source) };
  }

  captureProposal(database: ContentDatabase, resourceId: string, desired: unknown, operation: ChangeOperation = "UPDATE") {
    assertUuid(resourceId, "resourceId");
    const repository = new SQLiteAIKnowledgeSourceRepository(database);
    const current = operation === "CREATE" ? this.emptyCreateState(repository, resourceId) : this.loadCurrent(database, resourceId);
    try {
      const content = normalizeAIKnowledgeSourceContent(desired);
      assertSubjectExists(database, content.subjectKey);
      if (operation === "CREATE" && repository.getByKey(content.key)) throw new AIKnowledgeError("AI_KNOWLEDGE_SOURCE_CONFLICT", "The Knowledge Source key is already in use.");
      if (operation === "UPDATE" && (current.snapshot.key !== content.key || current.snapshot.subjectKey !== content.subjectKey)) throw new AIKnowledgeError("AI_KNOWLEDGE_SOURCE_CONFLICT", "Knowledge Source key and subject are immutable after creation.");
      const proposedSnapshot = snapshotFromContent(content);
      validateChangeSnapshot(proposedSnapshot);
      const changedPaths = deriveChangedPaths(current.snapshot, proposedSnapshot);
      if (!changedPaths.length) throw new AIKnowledgeError("AI_KNOWLEDGE_INVALID", "The Knowledge Source proposal does not change any fields.");
      return { current, proposedSnapshot, changedPaths };
    } catch (error) {
      throw mapKnowledgeError(error);
    }
  }

  validateSnapshot(snapshot: ChangeSnapshot): void {
    try { validateChangeSnapshot(snapshot); normalizeAIKnowledgeSourceContent(snapshot); }
    catch (error) { throw mapKnowledgeError(error); }
  }

  describe(resourceId: string, before: ChangeSnapshot, proposed: ChangeSnapshot, operation: ChangeOperation = "UPDATE"): ChangePresentation {
    const after = normalizeAIKnowledgeSourceContent(proposed);
    const previous = operation === "CREATE" && Object.keys(before).length === 0 ? null : normalizeAIKnowledgeSourceContent(before);
    if (previous && (previous.key !== after.key || previous.subjectKey !== after.subjectKey)) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "Knowledge Source key and subject are immutable after creation.");
    const changedPaths = deriveChangedPaths(previous ? snapshotFromContent(previous) : {}, snapshotFromContent(after));
    return {
      resourceLabel: after.displayName,
      resourceSubtitle: operation === "CREATE" ? "New governed Knowledge Source" : `Knowledge Source · ${resourceId}`,
      changeSummary: `${changedPaths.length} changed field${changedPaths.length === 1 ? "" : "s"}`,
      areaLabel: this.areaLabel,
      fieldDiffs: changedPaths.map((path) => ({ path, label: FIELD_LABELS[path] ?? path, before: previous ? snapshotFromContent(previous)[path] : undefined, after: snapshotFromContent(after)[path] })),
    };
  }

  apply(database: ContentDatabase, resourceId: string, value: ChangeSnapshot, expectedRevision: number, actor: AdminActor, operation: ChangeOperation = "UPDATE"): ResourceState {
    if (actor.actorRole !== "OWNER") throw new ChangeManagementError("CHANGE_AUTHORIZATION_FAILED", "Only OWNER may publish Knowledge Sources.");
    assertUuid(resourceId, "resourceId");
    const content = normalizeAIKnowledgeSourceContent(value);
    assertSubjectExists(database, content.subjectKey);
    if (content.sourceAssetId && !new SQLiteAssetRepository(database).findById(content.sourceAssetId)) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "The Knowledge Source asset was not found.");
    const repository = new SQLiteAIKnowledgeSourceRepository(database);
    try {
      const revision = operation === "CREATE"
        ? repository.create({ id: resourceId, content, actor, now: Date.now() })
        : repository.appendRevision({ id: resourceId, expectedRevision, content, actor, now: Date.now() });
      const source = repository.getById(resourceId);
      if (!source) throw new AIKnowledgeError("AI_KNOWLEDGE_INVALID", "The published Knowledge Source could not be read.");
      return { resourceId, revision: revision.revision, snapshot: snapshotFromContent(source) };
    } catch (error) { throw mapKnowledgeError(error); }
  }

  validatePublication(database: ContentDatabase): void {
    const repository = new SQLiteAIKnowledgeSourceRepository(database);
    for (const source of repository.list()) if (!repository.getCurrentRevision(source.id)) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "A Knowledge Source current revision is missing.");
  }

  private emptyCreateState(repository: SQLiteAIKnowledgeSourceRepository, resourceId: string): ResourceState {
    if (repository.getById(resourceId)) throw new ChangeManagementError("CHANGE_CONFLICT", "The Knowledge Source identifier is already in use.");
    return { resourceId, revision: 0, snapshot: {} };
  }
}

export function snapshotFromSourceContent(content: AIKnowledgeSource | AIKnowledgeSourceContent): ChangeSnapshot { return snapshotFromContent(content); }

function snapshotFromContent(content: AIKnowledgeSource | AIKnowledgeSourceContent): ChangeSnapshot {
  return structuredClone({
    key: content.key,
    subjectKey: content.subjectKey,
    sourceType: content.sourceType,
    displayName: content.displayName,
    language: content.language,
    edition: content.edition,
    authorityName: content.authorityName,
    authorityType: content.authorityType,
    trustTier: content.trustTier,
    rightsStatus: content.rightsStatus,
    rightsBasis: content.rightsBasis,
    licenseName: content.licenseName,
    attribution: content.attribution,
    rightsNotes: content.rightsNotes,
    sourceUrl: content.sourceUrl,
    sourceAssetId: content.sourceAssetId,
    enabled: content.enabled,
    preparationMethod: content.preparationMethod,
    producerKey: content.producerKey,
    producerRevision: content.producerRevision,
  }) as ChangeSnapshot;
}

function assertSubjectExists(database: ContentDatabase, subjectKey: string): void {
  if (!database.db.select({ subjectKey: canonicalMaterials.subjectKey }).from(canonicalMaterials).where(eq(canonicalMaterials.subjectKey, subjectKey)).get()) throw new AIKnowledgeError("AI_KNOWLEDGE_INVALID", "The Knowledge Source subject is not canonical.");
}

function assertUuid(value: unknown, field: string): asserts value is string { if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", `${field} must be a stable UUID.`); }

function mapKnowledgeError(error: unknown): Error {
  if (error instanceof ChangeManagementError) return error;
  if (error instanceof AIKnowledgeError) return new ChangeManagementError(error.code.endsWith("CONFLICT") ? "CHANGE_CONFLICT" : "CHANGE_VALIDATION_FAILED", error.message, error);
  return error instanceof Error ? new ChangeManagementError("CHANGE_PUBLICATION_FAILED", "The Knowledge Source operation failed.", error) : new ChangeManagementError("CHANGE_PUBLICATION_FAILED", "The Knowledge Source operation failed.");
}
