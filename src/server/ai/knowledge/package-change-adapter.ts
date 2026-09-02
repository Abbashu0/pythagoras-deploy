import { eq } from "drizzle-orm";
import type { AdminActor } from "../../admin-auth/contracts";
import type { ChangeOperation, ChangePresentation, ChangeResourceAdapter, ChangeSnapshot, ResourceState } from "../../change-management/contracts";
import { ChangeManagementError } from "../../change-management/errors";
import { deriveChangedPaths, validateChangeSnapshot } from "../../change-management/snapshot";
import type { ContentDatabase } from "../../content/database";
import { canonicalMaterials } from "../../content/schema";
import { AIKnowledgeError } from "./errors";
import { AI_KNOWLEDGE_PACKAGE_RESOURCE_TYPE, type AIKnowledgePackage, type AIKnowledgePackageArtifactStore, type AIKnowledgePackageChangeContent } from "./contracts";
import { LocalAIKnowledgePackageArtifactStore } from "./artifact-store";
import { materializeAIKnowledgePackage } from "./materializer";
import { SQLiteAIKnowledgePackageRepository } from "./package-repository";
import { normalizeAIKnowledgePackageChangeContent } from "./validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FIELD_LABELS: Record<string, string> = {
  key: "Knowledge Package key",
  subjectKey: "Subject",
  title: "Title",
  language: "Language",
  contentRevision: "Content revision",
  sourceId: "Pinned Source",
  sourceRevision: "Pinned Source revision",
  artifactRef: "Package artifact",
  artifactSha256: "Package artifact hash",
  artifactByteSize: "Package artifact size",
};

export class AIKnowledgePackageChangeAdapter implements ChangeResourceAdapter {
  readonly resourceType = AI_KNOWLEDGE_PACKAGE_RESOURCE_TYPE;
  readonly areaLabel = "AI / Knowledge Packages";
  readonly mergeStrategy = "THREE_WAY" as const;

  constructor(private readonly artifactStoreFactory: (database: ContentDatabase) => AIKnowledgePackageArtifactStore = (database) => new LocalAIKnowledgePackageArtifactStore(database)) {}

  loadCurrent(database: ContentDatabase, resourceId: string): ResourceState {
    assertUuid(resourceId, "resourceId");
    const aggregate = new SQLiteAIKnowledgePackageRepository(database).getById(resourceId);
    if (!aggregate) throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Knowledge Package was not found.");
    return { resourceId, revision: aggregate.package.currentRevision, snapshot: snapshotFromContent(aggregate.package) };
  }

  captureProposal(database: ContentDatabase, resourceId: string, desired: unknown, operation: ChangeOperation = "UPDATE") {
    assertUuid(resourceId, "resourceId");
    const repository = new SQLiteAIKnowledgePackageRepository(database);
    const current = operation === "CREATE" ? this.emptyCreateState(repository, resourceId) : this.loadCurrent(database, resourceId);
    try {
      const content = normalizeAIKnowledgePackageChangeContent(desired);
      assertSubjectExists(database, content.subjectKey);
      if (operation === "CREATE" && repository.getByKey(content.key)) throw new AIKnowledgeError("AI_KNOWLEDGE_PACKAGE_CONFLICT", "The Knowledge Package key is already in use.");
      if (operation === "UPDATE" && (current.snapshot.key !== content.key || current.snapshot.subjectKey !== content.subjectKey)) throw new AIKnowledgeError("AI_KNOWLEDGE_PACKAGE_CONFLICT", "Knowledge Package key and subject are immutable after creation.");
      if (operation === "UPDATE" && typeof current.snapshot.contentRevision === "number" && content.contentRevision <= current.snapshot.contentRevision) throw new AIKnowledgeError("AI_KNOWLEDGE_PACKAGE_CONFLICT", "Knowledge Package contentRevision must increase for an update.");
      const proposedSnapshot = snapshotFromContent(content);
      validateChangeSnapshot(proposedSnapshot);
      const changedPaths = deriveChangedPaths(current.snapshot, proposedSnapshot);
      if (!changedPaths.length) throw new AIKnowledgeError("AI_KNOWLEDGE_INVALID", "The Knowledge Package proposal does not change any fields.");
      return { current, proposedSnapshot, changedPaths };
    } catch (error) { throw mapKnowledgeError(error); }
  }

  validateSnapshot(snapshot: ChangeSnapshot): void {
    try { validateChangeSnapshot(snapshot); normalizeAIKnowledgePackageChangeContent(snapshot); }
    catch (error) { throw mapKnowledgeError(error); }
  }

  describe(resourceId: string, before: ChangeSnapshot, proposed: ChangeSnapshot, operation: ChangeOperation = "UPDATE"): ChangePresentation {
    const after = normalizeAIKnowledgePackageChangeContent(proposed);
    const previous = operation === "CREATE" && Object.keys(before).length === 0 ? null : normalizeAIKnowledgePackageChangeContent(before);
    if (previous && (previous.key !== after.key || previous.subjectKey !== after.subjectKey)) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "Knowledge Package key and subject are immutable after creation.");
    const changedPaths = deriveChangedPaths(previous ? snapshotFromContent(previous) : {}, snapshotFromContent(after));
    return {
      resourceLabel: after.title,
      resourceSubtitle: operation === "CREATE" ? "New governed Knowledge Package" : `Knowledge Package · ${resourceId}`,
      changeSummary: `${changedPaths.length} changed field${changedPaths.length === 1 ? "" : "s"}`,
      areaLabel: this.areaLabel,
      fieldDiffs: changedPaths.map((path) => ({ path, label: FIELD_LABELS[path] ?? path, before: previous ? snapshotFromContent(previous)[path] : undefined, after: snapshotFromContent(after)[path] })),
    };
  }

  apply(database: ContentDatabase, resourceId: string, value: ChangeSnapshot, expectedRevision: number, actor: AdminActor, operation: ChangeOperation = "UPDATE"): ResourceState {
    if (actor.actorRole !== "OWNER") throw new ChangeManagementError("CHANGE_AUTHORIZATION_FAILED", "Only OWNER may publish Knowledge Packages.");
    assertUuid(resourceId, "resourceId");
    const content = normalizeAIKnowledgePackageChangeContent(value);
    assertSubjectExists(database, content.subjectKey);
    try {
      const artifact = this.artifactStoreFactory(database).read({ artifactRef: content.artifactRef, sha256: content.artifactSha256 });
      const serializedSize = Buffer.byteLength(JSON.stringify(artifact), "utf8");
      if (serializedSize !== content.artifactByteSize) throw new AIKnowledgeError("AI_KNOWLEDGE_ARTIFACT_INVALID", "Knowledge Package artifact size does not match its governed metadata.");
      if (artifact.package.id !== resourceId || artifact.package.key !== content.key || artifact.package.subjectKey !== content.subjectKey || artifact.package.title !== content.title || artifact.package.language !== content.language || artifact.package.contentRevision !== content.contentRevision || artifact.source.id !== content.sourceId || artifact.source.revision !== content.sourceRevision) {
        throw new AIKnowledgeError("AI_KNOWLEDGE_ARTIFACT_INVALID", "Knowledge Package artifact metadata does not match its governed proposal.");
      }
      const materialized = materializeAIKnowledgePackage(database, artifact);
      const repository = new SQLiteAIKnowledgePackageRepository(database);
      const revision = operation === "CREATE"
        ? repository.create({ id: resourceId, content, documents: materialized.documents, assets: materialized.assets, actor, now: Date.now() })
        : repository.appendRevision({ id: resourceId, expectedRevision, content, documents: materialized.documents, assets: materialized.assets, actor, now: Date.now() });
      return { resourceId, revision: revision.revision, snapshot: snapshotFromContent(repository.getById(resourceId)!.package) };
    } catch (error) { throw mapKnowledgeError(error); }
  }

  validatePublication(database: ContentDatabase): void {
    const repository = new SQLiteAIKnowledgePackageRepository(database);
    for (const item of repository.list()) {
      const aggregate = repository.getById(item.id);
      if (!aggregate || aggregate.package.currentRevision !== item.currentRevision) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "A Knowledge Package current revision is missing.");
    }
  }

  private emptyCreateState(repository: SQLiteAIKnowledgePackageRepository, resourceId: string): ResourceState {
    if (repository.getById(resourceId)) throw new ChangeManagementError("CHANGE_CONFLICT", "The Knowledge Package identifier is already in use.");
    return { resourceId, revision: 0, snapshot: {} };
  }
}

export function snapshotFromPackageContent(content: AIKnowledgePackage | AIKnowledgePackageChangeContent): ChangeSnapshot { return snapshotFromContent(content); }

function snapshotFromContent(content: AIKnowledgePackage | AIKnowledgePackageChangeContent): ChangeSnapshot {
  return structuredClone({
    key: content.key,
    subjectKey: content.subjectKey,
    title: content.title,
    language: content.language,
    contentRevision: content.contentRevision,
    sourceId: content.sourceId,
    sourceRevision: content.sourceRevision,
    artifactRef: content.artifactRef,
    artifactSha256: content.artifactSha256,
    artifactByteSize: content.artifactByteSize,
  }) as ChangeSnapshot;
}

function assertSubjectExists(database: ContentDatabase, subjectKey: string): void {
  if (!database.db.select({ subjectKey: canonicalMaterials.subjectKey }).from(canonicalMaterials).where(eq(canonicalMaterials.subjectKey, subjectKey)).get()) throw new AIKnowledgeError("AI_KNOWLEDGE_INVALID", "The Knowledge Package subject is not canonical.");
}

function assertUuid(value: unknown, field: string): asserts value is string { if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", `${field} must be a stable UUID.`); }

function mapKnowledgeError(error: unknown): Error {
  if (error instanceof ChangeManagementError) return error;
  if (error instanceof AIKnowledgeError) return new ChangeManagementError(error.code.endsWith("CONFLICT") ? "CHANGE_CONFLICT" : "CHANGE_VALIDATION_FAILED", error.message, error);
  return error instanceof Error ? new ChangeManagementError("CHANGE_PUBLICATION_FAILED", "The Knowledge Package operation failed.", error) : new ChangeManagementError("CHANGE_PUBLICATION_FAILED", "The Knowledge Package operation failed.");
}
