import { and, asc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { AdminActor } from "../../admin-auth/contracts";
import type { ContentDatabase } from "../../content/database";
import {
  aiKnowledgeDocuments,
  aiKnowledgePackageAssets,
  aiKnowledgePackageRevisions,
  aiKnowledgePackages,
  type AIKnowledgeDocumentRow,
  type AIKnowledgePackageAssetRow,
  type AIKnowledgePackageRevisionRow,
} from "../../content/schema";
import type {
  AIKnowledgeDocumentProvenance,
  AIKnowledgePackage,
  AIKnowledgePackageAggregate,
  AIKnowledgePackageAsset,
  AIKnowledgePackageChangeContent,
  AIKnowledgePackageDocument,
  AIKnowledgePackageProjectionMetadata,
  AIKnowledgePackageRepository,
  AIKnowledgePackageRevision,
} from "./contracts";
import { AIKnowledgeError } from "./errors";
import { SQLiteAIKnowledgeSourceRepository } from "./source-repository";

export class SQLiteAIKnowledgePackageRepository implements AIKnowledgePackageRepository {
  constructor(private readonly database: ContentDatabase) {}

  getById(id: string): AIKnowledgePackageAggregate | null {
    const row = this.database.db.select().from(aiKnowledgePackages).where(eq(aiKnowledgePackages.id, id)).get();
    if (!row) return null;
    return this.getRevision(id, row.currentRevision);
  }

  getByKey(key: string): AIKnowledgePackageAggregate | null {
    const row = this.database.db.select().from(aiKnowledgePackages).where(eq(aiKnowledgePackages.key, key)).get();
    return row ? this.getById(row.id) : null;
  }

  getRevision(id: string, revision: number): AIKnowledgePackageAggregate | null {
    const packageRow = this.database.db.select().from(aiKnowledgePackages).where(eq(aiKnowledgePackages.id, id)).get();
    if (!packageRow) return null;
    const revisionRow = this.database.db.select().from(aiKnowledgePackageRevisions).where(and(
      eq(aiKnowledgePackageRevisions.packageId, id),
      eq(aiKnowledgePackageRevisions.revision, revision),
    )).get();
    if (!revisionRow) return null;
    const currentRevisionRow = packageRow.currentRevision === revision
      ? revisionRow
      : this.database.db.select().from(aiKnowledgePackageRevisions).where(and(
        eq(aiKnowledgePackageRevisions.packageId, id),
        eq(aiKnowledgePackageRevisions.revision, packageRow.currentRevision),
      )).get();
    if (!currentRevisionRow) throw new AIKnowledgeError("AI_KNOWLEDGE_INVALID", "The current Knowledge Package revision is missing.");
    return {
      package: this.toPackage(packageRow, revisionRow, currentRevisionRow),
      revision: this.toRevision(packageRow, revisionRow),
      documents: this.database.db.select().from(aiKnowledgeDocuments)
        .where(eq(aiKnowledgeDocuments.packageRevisionId, revisionRow.id))
        .orderBy(asc(aiKnowledgeDocuments.displayOrder), asc(aiKnowledgeDocuments.documentId))
        .all().map(toDocument),
      assets: this.database.db.select().from(aiKnowledgePackageAssets)
        .where(eq(aiKnowledgePackageAssets.packageRevisionId, revisionRow.id))
        .orderBy(asc(aiKnowledgePackageAssets.assetRef))
        .all().map(toAsset),
    };
  }

  listRevisions(id: string): AIKnowledgePackageRevision[] {
    const packageRow = this.database.db.select().from(aiKnowledgePackages).where(eq(aiKnowledgePackages.id, id)).get();
    if (!packageRow) return [];
    return this.database.db.select().from(aiKnowledgePackageRevisions)
      .where(eq(aiKnowledgePackageRevisions.packageId, id))
      .orderBy(asc(aiKnowledgePackageRevisions.revision))
      .all()
      .map((row) => this.toRevision(packageRow, row));
  }

  list(): AIKnowledgePackage[] {
    return this.database.db.select().from(aiKnowledgePackages).orderBy(asc(aiKnowledgePackages.key)).all()
      .map((row) => this.getById(row.id)?.package)
      .filter((item): item is AIKnowledgePackage => item !== undefined);
  }

  create(input: { id: string; content: AIKnowledgePackageChangeContent; documents: AIKnowledgePackageDocument[]; assets: AIKnowledgePackageAsset[]; actor: AdminActor; now: number }): AIKnowledgePackageRevision {
    if (this.getById(input.id) || this.getByKey(input.content.key)) throw new AIKnowledgeError("AI_KNOWLEDGE_PACKAGE_CONFLICT", "The Knowledge Package identity is already in use.");
    const revisionId = uuidv7();
    try {
      return this.runAtomic(() => {
        this.database.db.insert(aiKnowledgePackages).values({
          id: input.id,
          key: input.content.key,
          subjectKey: input.content.subjectKey,
          currentRevision: 1,
          createdAt: input.now,
          updatedAt: input.now,
          createdBy: input.actor.actorUserId,
          updatedBy: input.actor.actorUserId,
        }).run();
        this.insertRevision(revisionId, input.id, 1, input.content, input.actor, input.now);
        this.insertChildren(revisionId, input.documents, input.assets);
        const aggregate = this.getById(input.id);
        if (!aggregate) throw new AIKnowledgeError("AI_KNOWLEDGE_INVALID", "The new Knowledge Package could not be read.");
        return aggregate.revision;
      });
    } catch (error) {
      if (error instanceof AIKnowledgeError) throw error;
      throw new AIKnowledgeError("AI_KNOWLEDGE_PACKAGE_CONFLICT", "The Knowledge Package could not be created.", {}, { cause: error });
    }
  }

  appendRevision(input: { id: string; expectedRevision: number; content: AIKnowledgePackageChangeContent; documents: AIKnowledgePackageDocument[]; assets: AIKnowledgePackageAsset[]; actor: AdminActor; now: number }): AIKnowledgePackageRevision {
    const current = this.getById(input.id);
    if (!current) throw new AIKnowledgeError("AI_KNOWLEDGE_PACKAGE_NOT_FOUND", "The Knowledge Package was not found.");
    if (current.package.currentRevision !== input.expectedRevision) throw new AIKnowledgeError("AI_KNOWLEDGE_PACKAGE_CONFLICT", "The Knowledge Package changed before publication.");
    if (current.package.key !== input.content.key || current.package.subjectKey !== input.content.subjectKey) throw new AIKnowledgeError("AI_KNOWLEDGE_PACKAGE_CONFLICT", "Knowledge Package key and subject are immutable after creation.");
    if (input.content.contentRevision <= current.package.contentRevision) throw new AIKnowledgeError("AI_KNOWLEDGE_PACKAGE_CONFLICT", "Knowledge Package contentRevision must increase for a new publication.");
    const nextRevision = input.expectedRevision + 1;
    const revisionId = uuidv7();
    try {
      return this.runAtomic(() => {
        this.insertRevision(revisionId, input.id, nextRevision, input.content, input.actor, input.now);
        const updated = this.database.db.update(aiKnowledgePackages).set({
          currentRevision: nextRevision,
          updatedAt: input.now,
          updatedBy: input.actor.actorUserId,
        }).where(and(eq(aiKnowledgePackages.id, input.id), eq(aiKnowledgePackages.currentRevision, input.expectedRevision))).returning({ currentRevision: aiKnowledgePackages.currentRevision }).get();
        if (!updated) throw new AIKnowledgeError("AI_KNOWLEDGE_PACKAGE_CONFLICT", "The Knowledge Package changed before publication.");
        this.insertChildren(revisionId, input.documents, input.assets);
        const aggregate = this.getById(input.id);
        if (!aggregate) throw new AIKnowledgeError("AI_KNOWLEDGE_INVALID", "The appended Knowledge Package could not be read.");
        return aggregate.revision;
      });
    } catch (error) {
      if (error instanceof AIKnowledgeError) throw error;
      throw new AIKnowledgeError("AI_KNOWLEDGE_PACKAGE_CONFLICT", "The Knowledge Package revision could not be appended.", {}, { cause: error });
    }
  }

  listProjectionEligibleKnowledge(subjectKey: string): AIKnowledgePackageAggregate[] {
    const sourceRepository = new SQLiteAIKnowledgeSourceRepository(this.database);
    return this.database.db.select().from(aiKnowledgePackages)
      .where(eq(aiKnowledgePackages.subjectKey, subjectKey))
      .orderBy(asc(aiKnowledgePackages.key))
      .all()
      .map((row) => this.getById(row.id))
      .filter((item): item is AIKnowledgePackageAggregate => {
        if (!item || item.package.subjectKey !== subjectKey) return false;
        const source = sourceRepository.getCurrentRevision(item.revision.sourceId);
        return Boolean(source?.enabled && source.rightsStatus === "CLEARED");
      });
  }

  getProjectionMetadata(packageId: string, subjectKey: string): AIKnowledgePackageProjectionMetadata | null {
    const row = this.database.client.prepare(`
      select p.id as package_id, p.subject_key, p.current_revision as package_revision,
             pr.id as package_revision_id, pr.content_revision as package_content_revision,
             pr.language, pr.source_id, pr.source_revision, pr.artifact_sha256,
             pinned.source_type, pinned.trust_tier,
             current_source.enabled as current_source_enabled,
             current_source.rights_status as current_source_rights_status
      from ai_knowledge_packages p
      join ai_knowledge_package_revisions pr on pr.package_id = p.id and pr.revision = p.current_revision
      join ai_knowledge_source_revisions pinned on pinned.source_id = pr.source_id and pinned.revision = pr.source_revision
      join ai_knowledge_sources source on source.id = pr.source_id
      join ai_knowledge_source_revisions current_source on current_source.source_id = source.id and current_source.revision = source.current_revision
      where p.id = ? and p.subject_key = ?
    `).get(packageId, subjectKey) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      packageId: String(row.package_id),
      subjectKey: String(row.subject_key),
      packageRevisionId: String(row.package_revision_id),
      packageRevision: Number(row.package_revision),
      packageContentRevision: Number(row.package_content_revision),
      language: String(row.language),
      sourceId: String(row.source_id),
      sourceRevision: Number(row.source_revision),
      sourceType: String(row.source_type) as AIKnowledgePackageProjectionMetadata["sourceType"],
      trustTier: String(row.trust_tier) as AIKnowledgePackageProjectionMetadata["trustTier"],
      artifactSha256: String(row.artifact_sha256),
      currentSourceEnabled: Boolean(row.current_source_enabled),
      currentSourceRightsStatus: String(row.current_source_rights_status) as AIKnowledgePackageProjectionMetadata["currentSourceRightsStatus"],
    };
  }

  private insertRevision(revisionId: string, packageId: string, revision: number, content: AIKnowledgePackageChangeContent, actor: AdminActor, now: number): void {
    this.database.db.insert(aiKnowledgePackageRevisions).values({
      id: revisionId,
      packageId,
      revision,
      title: content.title,
      language: content.language,
      contentRevision: content.contentRevision,
      sourceId: content.sourceId,
      sourceRevision: content.sourceRevision,
      artifactRef: content.artifactRef,
      artifactSha256: content.artifactSha256,
      artifactByteSize: content.artifactByteSize,
      createdAt: now,
      createdBy: actor.actorUserId,
    }).run();
  }

  private insertChildren(revisionId: string, documents: AIKnowledgePackageDocument[], assets: AIKnowledgePackageAsset[]): void {
    if (documents.length) this.database.db.insert(aiKnowledgeDocuments).values(documents.map((document) => ({
      packageRevisionId: revisionId,
      documentId: document.documentId,
      displayOrder: document.displayOrder,
      title: document.title,
      provenance: document.provenance as Record<string, unknown> | null,
      content: document.content,
    }))).run();
    if (assets.length) this.database.db.insert(aiKnowledgePackageAssets).values(assets.map((asset) => ({
      packageRevisionId: revisionId,
      assetRef: asset.assetRef,
      expectedSha256: asset.expectedSha256,
      assetId: asset.assetId,
      filename: asset.filename,
      mimeType: asset.mimeType,
      byteSize: asset.byteSize,
      metadata: asset.metadata,
    }))).run();
  }

  private runAtomic<T>(operation: () => T): T {
    if (this.database.client.inTransaction) return operation();
    return this.database.client.transaction(operation).immediate();
  }

  private toRevision(packageRow: typeof aiKnowledgePackages.$inferSelect, row: AIKnowledgePackageRevisionRow): AIKnowledgePackageRevision {
    return {
      packageId: row.packageId,
      revisionId: row.id,
      revision: row.revision,
      key: packageRow.key,
      subjectKey: packageRow.subjectKey,
      title: row.title,
      language: row.language,
      contentRevision: row.contentRevision,
      sourceId: row.sourceId,
      sourceRevision: row.sourceRevision,
      artifactRef: row.artifactRef,
      artifactSha256: row.artifactSha256,
      artifactByteSize: row.artifactByteSize,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
    };
  }

  private toPackage(packageRow: typeof aiKnowledgePackages.$inferSelect, row: AIKnowledgePackageRevisionRow, currentRevisionRow: AIKnowledgePackageRevisionRow): AIKnowledgePackage {
    return {
      ...this.toRevision(packageRow, row),
      id: packageRow.id,
      currentRevision: packageRow.currentRevision,
      currentRevisionId: currentRevisionRow.id,
      updatedAt: packageRow.updatedAt,
      updatedBy: packageRow.updatedBy,
    };
  }
}

function toDocument(row: AIKnowledgeDocumentRow): AIKnowledgePackageDocument {
  return {
    packageRevisionId: row.packageRevisionId,
    documentId: row.documentId,
    displayOrder: row.displayOrder,
    title: row.title,
    provenance: row.provenance as AIKnowledgeDocumentProvenance | null,
    content: row.content,
  };
}

function toAsset(row: AIKnowledgePackageAssetRow): AIKnowledgePackageAsset {
  return {
    packageRevisionId: row.packageRevisionId,
    assetRef: row.assetRef,
    expectedSha256: row.expectedSha256,
    assetId: row.assetId,
    filename: row.filename,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    metadata: row.metadata,
  };
}
