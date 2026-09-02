import { and, asc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { AdminActor } from "../../admin-auth/contracts";
import type { ContentDatabase } from "../../content/database";
import { aiKnowledgeSources, aiKnowledgeSourceRevisions, type AIKnowledgeSourceRevisionRow } from "../../content/schema";
import type { AIKnowledgeSource, AIKnowledgeSourceContent, AIKnowledgeSourceRepository, AIKnowledgeSourceRevision } from "./contracts";
import { AIKnowledgeError } from "./errors";
import { normalizeAIKnowledgeSourceContent } from "./validation";

export class SQLiteAIKnowledgeSourceRepository implements AIKnowledgeSourceRepository {
  constructor(private readonly database: ContentDatabase) {}

  getById(id: string): AIKnowledgeSource | null {
    const row = this.database.db.select().from(aiKnowledgeSources).where(eq(aiKnowledgeSources.id, id)).get();
    if (!row) return null;
    const revision = this.getRevision(id, row.currentRevision);
    if (!revision) throw new AIKnowledgeError("AI_KNOWLEDGE_INVALID", "The current Knowledge Source revision is missing.");
    return {
      ...revision,
      id: row.id,
      currentRevision: row.currentRevision,
      currentRevisionId: revision.revisionId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
    };
  }

  getByKey(key: string): AIKnowledgeSource | null {
    const row = this.database.db.select().from(aiKnowledgeSources).where(eq(aiKnowledgeSources.key, key)).get();
    return row ? this.getById(row.id) : null;
  }

  getRevision(id: string, revision: number): AIKnowledgeSourceRevision | null {
    const row = this.database.db.select().from(aiKnowledgeSourceRevisions).where(and(
      eq(aiKnowledgeSourceRevisions.sourceId, id),
      eq(aiKnowledgeSourceRevisions.revision, revision),
    )).get();
    return row ? this.toRevision(row) : null;
  }

  getCurrentRevision(id: string): AIKnowledgeSourceRevision | null {
    const row = this.database.db.select({ currentRevision: aiKnowledgeSources.currentRevision })
      .from(aiKnowledgeSources).where(eq(aiKnowledgeSources.id, id)).get();
    return row ? this.getRevision(id, row.currentRevision) : null;
  }

  listRevisions(id: string): AIKnowledgeSourceRevision[] {
    return this.database.db.select().from(aiKnowledgeSourceRevisions)
      .where(eq(aiKnowledgeSourceRevisions.sourceId, id))
      .orderBy(asc(aiKnowledgeSourceRevisions.revision))
      .all()
      .map((row) => this.toRevision(row));
  }

  list(): AIKnowledgeSource[] {
    return this.database.db.select().from(aiKnowledgeSources).orderBy(asc(aiKnowledgeSources.key)).all()
      .map((row) => this.getById(row.id))
      .filter((source): source is AIKnowledgeSource => source !== null);
  }

  create(input: { id: string; content: AIKnowledgeSourceContent; actor: AdminActor; now: number }): AIKnowledgeSourceRevision {
    const content = normalizeAIKnowledgeSourceContent(input.content);
    if (this.getById(input.id) || this.getByKey(content.key)) {
      throw new AIKnowledgeError("AI_KNOWLEDGE_SOURCE_CONFLICT", "The Knowledge Source identity is already in use.");
    }
    try {
      return this.runAtomic(() => {
        this.database.db.insert(aiKnowledgeSources).values({
          id: input.id,
          key: content.key,
          subjectKey: content.subjectKey,
          currentRevision: 1,
          createdAt: input.now,
          updatedAt: input.now,
          createdBy: input.actor.actorUserId,
          updatedBy: input.actor.actorUserId,
        }).run();
        this.insertRevision(input.id, 1, content, input.actor, input.now);
        const revision = this.getRevision(input.id, 1);
        if (!revision) throw new AIKnowledgeError("AI_KNOWLEDGE_INVALID", "The new Knowledge Source revision could not be read.");
        return revision;
      });
    } catch (error) {
      if (error instanceof AIKnowledgeError) throw error;
      throw new AIKnowledgeError("AI_KNOWLEDGE_SOURCE_CONFLICT", "The Knowledge Source could not be created.", {}, { cause: error });
    }
  }

  appendRevision(input: { id: string; expectedRevision: number; content: AIKnowledgeSourceContent; actor: AdminActor; now: number }): AIKnowledgeSourceRevision {
    const current = this.getById(input.id);
    if (!current) throw new AIKnowledgeError("AI_KNOWLEDGE_SOURCE_NOT_FOUND", "The Knowledge Source was not found.");
    if (current.currentRevision !== input.expectedRevision) throw new AIKnowledgeError("AI_KNOWLEDGE_SOURCE_CONFLICT", "The Knowledge Source changed before publication.");
    const content = normalizeAIKnowledgeSourceContent(input.content);
    if (content.key !== current.key || content.subjectKey !== current.subjectKey) throw new AIKnowledgeError("AI_KNOWLEDGE_SOURCE_CONFLICT", "Knowledge Source key and subject are immutable after creation.");
    const nextRevision = input.expectedRevision + 1;
    try {
      return this.runAtomic(() => {
        this.insertRevision(input.id, nextRevision, content, input.actor, input.now);
        const updated = this.database.db.update(aiKnowledgeSources).set({
          currentRevision: nextRevision,
          updatedAt: input.now,
          updatedBy: input.actor.actorUserId,
        }).where(and(eq(aiKnowledgeSources.id, input.id), eq(aiKnowledgeSources.currentRevision, input.expectedRevision))).returning({ currentRevision: aiKnowledgeSources.currentRevision }).get();
        if (!updated) throw new AIKnowledgeError("AI_KNOWLEDGE_SOURCE_CONFLICT", "The Knowledge Source changed before publication.");
        const revision = this.getRevision(input.id, nextRevision);
        if (!revision) throw new AIKnowledgeError("AI_KNOWLEDGE_INVALID", "The appended Knowledge Source revision could not be read.");
        return revision;
      });
    } catch (error) {
      if (error instanceof AIKnowledgeError) throw error;
      throw new AIKnowledgeError("AI_KNOWLEDGE_SOURCE_CONFLICT", "The Knowledge Source revision could not be appended.", {}, { cause: error });
    }
  }

  private insertRevision(sourceId: string, revision: number, content: AIKnowledgeSourceContent, actor: AdminActor, now: number): void {
    this.database.db.insert(aiKnowledgeSourceRevisions).values({
      id: uuidv7(),
      sourceId,
      revision,
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
      createdAt: now,
      createdBy: actor.actorUserId,
    }).run();
  }

  private runAtomic<T>(operation: () => T): T {
    if (this.database.client.inTransaction) return operation();
    return this.database.client.transaction(operation).immediate();
  }

  private toRevision(row: AIKnowledgeSourceRevisionRow): AIKnowledgeSourceRevision {
    const source = this.database.db.select({ key: aiKnowledgeSources.key, subjectKey: aiKnowledgeSources.subjectKey })
      .from(aiKnowledgeSources).where(eq(aiKnowledgeSources.id, row.sourceId)).get();
    if (!source) throw new AIKnowledgeError("AI_KNOWLEDGE_INVALID", "The Knowledge Source identity is missing.");
    return {
      sourceId: row.sourceId,
      revisionId: row.id,
      revision: row.revision,
      key: source.key,
      subjectKey: source.subjectKey,
      sourceType: row.sourceType,
      displayName: row.displayName,
      language: row.language,
      edition: row.edition,
      authorityName: row.authorityName,
      authorityType: row.authorityType,
      trustTier: row.trustTier,
      rightsStatus: row.rightsStatus,
      rightsBasis: row.rightsBasis,
      licenseName: row.licenseName,
      attribution: row.attribution,
      rightsNotes: row.rightsNotes,
      sourceUrl: row.sourceUrl,
      sourceAssetId: row.sourceAssetId,
      enabled: row.enabled,
      preparationMethod: row.preparationMethod,
      producerKey: row.producerKey,
      producerRevision: row.producerRevision,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
    };
  }
}
